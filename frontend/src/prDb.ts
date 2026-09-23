// All per-PR state - reviewed hunks, slices, summary, conversation - lives in
// a single IndexedDB row per PR. The backend never persists any of this; it
// only fetches from GitHub and calls the model, so clearing this one row
// (or the whole database) is the entire "forget this PR" operation.
export interface Slice {
  id: string;
  title: string;
  summary: string;
  hunks: string[];
}

export interface PrSummary {
  what: string;
  why: string;
  how?: string;
}

export type ReplyOutcome = "actioned" | "acknowledged" | "refuted" | "answered" | "mixed";

export interface ThreadReply {
  from: "author" | "reviewer";
  outcome?: ReplyOutcome;
  summary: string;
}

export interface ReviewerConversation {
  reviewer: string;
  verdict?: "approved" | "changes requested" | "commented";
  summary: string;
  replies: ThreadReply[];
}

export interface ConversationSummary {
  prAuthor: string;
  reviewers: ReviewerConversation[];
  authorNotes?: string;
}

// A point in the diff, in GitHub's terms: a deleted line lives on the old
// side, anything else on the new side.
export interface LineRef {
  side: "old" | "new";
  line: number;
}

export interface NoteMessage {
  role: "user" | "assistant";
  text: string;
  at: number;
}

// A thread about lines the reviewer selected within one hunk.
export interface Note {
  id: string;
  path: string;
  hunk: number;
  start: LineRef;
  end: LineRef;
  // The selected lines as they read when the note was made, with +/- markers.
  code: string;
  messages: NoteMessage[];
  createdAt: number;
  // When the reviewer last had the thread open. A reply after this is unread.
  readAt?: number;
}

// A review comment drafted for posting: from one of your threads, or from
// the agent review. Unticked ones are left out of the posted review.
export interface FeedbackItem {
  id: string;
  body: string;
  included: boolean;
  path?: string;
  start?: LineRef;
  end?: LineRef;
  // The threads it was drafted from; only used to go to its lines.
  noteIds?: string[];
  // From the agent review: its reasoning, for deciding whether to keep it.
  // Never posted.
  rationale?: string;
}

export interface FeedbackDraft {
  items: FeedbackItem[];
  draftedAt: number;
  // The threads drafted from, with how many messages each had, so a draft
  // can tell when they've changed since.
  basedOn?: Record<string, number>;
}

export type FeedbackKind = "yours" | "agent";

export interface PrRecord {
  reviewed: Record<string, boolean>;
  slices: Slice[] | null;
  summary: PrSummary | null;
  conversation: ConversationSummary | null;
  notes: Note[];
  feedback: Partial<Record<FeedbackKind, FeedbackDraft>>;
  // Written whenever the PR is opened, so the start page can list saved
  // reviews by title and recency. Absent on records from before that.
  title?: string;
  lastOpenedAt?: number;
}

export interface SavedPr {
  owner: string;
  repo: string;
  number: string;
  record: PrRecord;
}

const DB_NAME = "docent";
const DB_VERSION = 2;
const STORE = "prs";

function emptyRecord(): PrRecord {
  return { reviewed: {}, slices: null, summary: null, conversation: null, notes: [], feedback: {} };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function keyFor(owner: string, repo: string, number: string): string {
  return `${owner}/${repo}/${number}`;
}

// Dev-only: mirror every write to the backend's console so it's visible in
// /tmp/backend.log - IndexedDB itself is invisible to anyone but the browser
// that owns it. One-way, log-only; never read back by the app.
function mirrorToDebugLog(key: string, record: PrRecord) {
  if (!import.meta.env.DEV) return;
  fetch("/api/debug/pr-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, record }),
  }).catch(() => {});
}

async function updateRecord(
  owner: string,
  repo: string,
  number: string,
  mutate: (record: PrRecord) => void,
): Promise<PrRecord> {
  const db = await openDb();
  const key = keyFor(owner, repo, number);
  const record = await new Promise<PrRecord>((resolve, reject) => {
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    const getReq = store.get(key);
    getReq.onsuccess = () => {
      const record: PrRecord = getReq.result ?? emptyRecord();
      mutate(record);
      const putReq = store.put(record, key);
      putReq.onsuccess = () => resolve(record);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
  mirrorToDebugLog(key, record);
  return record;
}

export async function getPrRecord(
  owner: string,
  repo: string,
  number: string,
): Promise<PrRecord> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE)
      .get(keyFor(owner, repo, number));
    req.onsuccess = () => {
      const record: PrRecord = req.result ?? emptyRecord();
      // Records saved before the per-reviewer summary stored a flat list of
      // per-comment cards; drop those so Regenerate writes the new shape.
      if (Array.isArray(record.conversation)) record.conversation = null;
      // Records saved before the rename to "slices" stored them as "ideas";
      // treat those as not generated yet so they regenerate on open.
      record.slices ??= null;
      record.notes ??= [];
      record.feedback ??= {};
      resolve(record);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function setHunksReviewed(
  owner: string,
  repo: string,
  number: string,
  keys: string[],
  reviewed: boolean,
): Promise<Record<string, boolean>> {
  const record = await updateRecord(owner, repo, number, (r) => {
    for (const key of keys) r.reviewed[key] = reviewed;
  });
  return record.reviewed;
}

export async function saveSlices(
  owner: string,
  repo: string,
  number: string,
  slices: Slice[],
): Promise<Slice[]> {
  const record = await updateRecord(owner, repo, number, (r) => {
    r.slices = slices;
  });
  return record.slices ?? [];
}

export async function saveSummary(
  owner: string,
  repo: string,
  number: string,
  summary: PrSummary,
): Promise<PrSummary> {
  const record = await updateRecord(owner, repo, number, (r) => {
    r.summary = summary;
  });
  return record.summary as PrSummary;
}

export async function saveConversation(
  owner: string,
  repo: string,
  number: string,
  conversation: ConversationSummary,
): Promise<ConversationSummary> {
  const record = await updateRecord(owner, repo, number, (r) => {
    r.conversation = conversation;
  });
  return record.conversation ?? conversation;
}

export async function saveNote(owner: string, repo: string, number: string, note: Note): Promise<void> {
  await updateRecord(owner, repo, number, (r) => {
    r.notes = [...(r.notes ?? []).filter((n) => n.id !== note.id), note];
  });
}

// Adds a reply to a note, unless the note was deleted while the reply was
// on its way. Returns the updated note, or null if it's gone.
export async function appendNoteMessage(
  owner: string,
  repo: string,
  number: string,
  id: string,
  message: NoteMessage,
): Promise<Note | null> {
  let updated: Note | null = null;
  await updateRecord(owner, repo, number, (r) => {
    r.notes = (r.notes ?? []).map((n) => {
      if (n.id !== id) return n;
      updated = { ...n, messages: [...n.messages, message] };
      return updated;
    });
  });
  return updated;
}

export async function markNoteRead(
  owner: string,
  repo: string,
  number: string,
  id: string,
  readAt: number,
): Promise<void> {
  await updateRecord(owner, repo, number, (r) => {
    r.notes = (r.notes ?? []).map((n) => (n.id === id ? { ...n, readAt } : n));
  });
}

export async function deleteNote(owner: string, repo: string, number: string, id: string): Promise<void> {
  await updateRecord(owner, repo, number, (r) => {
    r.notes = (r.notes ?? []).filter((n) => n.id !== id);
  });
}

export async function saveFeedback(
  owner: string,
  repo: string,
  number: string,
  kind: FeedbackKind,
  draft: FeedbackDraft,
): Promise<void> {
  await updateRecord(owner, repo, number, (r) => {
    r.feedback = { ...r.feedback, [kind]: draft };
  });
}

export async function markPrOpened(
  owner: string,
  repo: string,
  number: string,
  title: string | undefined,
): Promise<void> {
  await updateRecord(owner, repo, number, (r) => {
    if (title) r.title = title;
    r.lastOpenedAt = Date.now();
  });
}

export async function listSavedPrs(): Promise<SavedPr[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const saved: SavedPr[] = [];
    const req = db.transaction(STORE, "readonly").objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(saved);
        return;
      }
      const [owner, repo, number] = String(cursor.key).split("/");
      if (owner && repo && number) {
        saved.push({ owner, repo, number, record: cursor.value as PrRecord });
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteSavedPr(owner: string, repo: string, number: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).delete(keyFor(owner, repo, number));
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
