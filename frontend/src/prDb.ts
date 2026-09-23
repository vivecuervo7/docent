// All per-PR state - reviewed hunks, ideas, summary, conversation - lives in
// a single IndexedDB row per PR. The backend never persists any of this; it
// only fetches from GitHub and calls the model, so clearing this one row
// (or the whole database) is the entire "forget this PR" operation.
export interface Idea {
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

export interface ConversationCard {
  author: string;
  kind: string;
  summary: string;
}

export interface PrRecord {
  reviewed: Record<string, boolean>;
  ideas: Idea[] | null;
  summary: PrSummary | null;
  conversation: ConversationCard[] | null;
}

const DB_NAME = "codetour-pr";
const DB_VERSION = 2;
const STORE = "prs";

function emptyRecord(): PrRecord {
  return { reviewed: {}, ideas: null, summary: null, conversation: null };
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
    req.onsuccess = () => resolve(req.result ?? emptyRecord());
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

export async function saveIdeas(
  owner: string,
  repo: string,
  number: string,
  ideas: Idea[],
): Promise<Idea[]> {
  const record = await updateRecord(owner, repo, number, (r) => {
    r.ideas = ideas;
  });
  return record.ideas ?? [];
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
  cards: ConversationCard[],
): Promise<ConversationCard[]> {
  const record = await updateRecord(owner, repo, number, (r) => {
    r.conversation = cards;
  });
  return record.conversation ?? [];
}
