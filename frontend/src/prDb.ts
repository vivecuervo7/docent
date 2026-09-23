// All per-PR state - reviewed hunks, slices, summary, threads, feedback, the
// prepared review - is one record per PR, kept by the backend (see its
// store.ts) so an agent working over MCP sees the same state as this page.
// Deleting that record is the entire "forget this PR" operation.
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
  // Why it was drafted or raised, for deciding whether to keep it. Never
  // posted.
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

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

// A comment in the review to post: one or more kept feedback items,
// combined, and editable before posting.
export interface ReviewComment {
  id: string;
  body: string;
  included: boolean;
  // The feedback items it covers.
  from: string[];
  path?: string;
  start?: LineRef;
  end?: LineRef;
}

export interface ReviewDraft {
  preparedAt: number;
  // The feedback items that were ticked when it was prepared.
  basedOn: string[];
  comments: ReviewComment[];
  // Ticked feedback left out, with why - usually that someone already said it.
  dropped: { from: string[]; reason: string }[];
  summary: string;
  event: ReviewEvent;
  posted?: { at: number; url: string };
}

export interface PrRecord {
  reviewed: Record<string, boolean>;
  slices: Slice[] | null;
  summary: PrSummary | null;
  conversation: ConversationSummary | null;
  notes: Note[];
  feedback: Partial<Record<FeedbackKind, FeedbackDraft>>;
  review?: ReviewDraft;
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

function emptyRecord(): PrRecord {
  return { reviewed: {}, slices: null, summary: null, conversation: null, notes: [], feedback: {} };
}

function keyFor(owner: string, repo: string, number: string): string {
  return `${owner}/${repo}/${number}`;
}

function recordUrl(owner: string, repo: string, number: string): string {
  return `/api/prs/${owner}/${repo}/${number}`;
}

// Fills in anything a stored record doesn't have yet, so callers can rely on
// the current shape.
function normalize(stored: Partial<PrRecord> | undefined): PrRecord {
  const record = { ...emptyRecord(), ...stored } as PrRecord;
  // Records saved before the per-reviewer summary stored a flat list of
  // per-comment cards; drop those so they're summarised again.
  if (Array.isArray(record.conversation)) record.conversation = null;
  record.slices ??= null;
  record.notes ??= [];
  record.feedback ??= {};
  return record;
}

async function fetchRecord(owner: string, repo: string, number: string): Promise<{ record: PrRecord; version: number }> {
  const res = await fetch(recordUrl(owner, repo, number));
  if (!res.ok) throw new Error(`Couldn't load the review (${res.status})`);
  const { record, version } = (await res.json()) as { record: Partial<PrRecord>; version: number };
  return { record: normalize(record), version };
}

// One save at a time per PR from this page, so its own writes never race.
const saving = new Map<string, Promise<unknown>>();

function oneAtATime<T>(key: string, work: () => Promise<T>): Promise<T> {
  const run = (saving.get(key) ?? Promise.resolve()).then(work, work);
  saving.set(key, run.catch(() => {}));
  return run;
}

// Reads the record, applies the change, and saves it. If something else
// saved first (an agent over MCP, say), the backend refuses and hands back
// the latest copy, and the change is made again on that.
async function updateRecord(
  owner: string,
  repo: string,
  number: string,
  mutate: (record: PrRecord) => void,
): Promise<PrRecord> {
  return oneAtATime(keyFor(owner, repo, number), async () => {
    let { record, version } = await fetchRecord(owner, repo, number);
    for (let attempt = 0; attempt < 5; attempt++) {
      mutate(record);
      const res = await fetch(recordUrl(owner, repo, number), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record, version }),
      });
      if (res.status === 409) {
        const current = (await res.json()) as { record: Partial<PrRecord>; version: number };
        record = normalize(current.record);
        version = current.version;
        continue;
      }
      if (!res.ok) throw new Error(`Couldn't save the review (${res.status})`);
      return record;
    }
    throw new Error("Couldn't save the review: it kept changing underneath.");
  });
}

export async function getPrRecord(owner: string, repo: string, number: string): Promise<PrRecord> {
  return (await fetchRecord(owner, repo, number)).record;
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

export async function saveReviewDraft(
  owner: string,
  repo: string,
  number: string,
  review: ReviewDraft | undefined,
): Promise<void> {
  await updateRecord(owner, repo, number, (r) => {
    r.review = review;
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
  const res = await fetch("/api/prs");
  if (!res.ok) throw new Error(`Couldn't list saved reviews (${res.status})`);
  const { prs } = (await res.json()) as { prs: { owner: string; repo: string; number: string; record: Partial<PrRecord> }[] };
  return prs.map(({ owner, repo, number, record }) => ({ owner, repo, number, record: normalize(record) }));
}

export async function deleteSavedPr(owner: string, repo: string, number: string): Promise<void> {
  const res = await fetch(recordUrl(owner, repo, number), { method: "DELETE" });
  if (!res.ok) throw new Error(`Couldn't delete the review (${res.status})`);
}
