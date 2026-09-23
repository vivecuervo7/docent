// Review progress (which hunks are marked reviewed) lives entirely in the
// browser - the backend never sees or persists it.
const DB_NAME = "codetour-pr";
const DB_VERSION = 1;
const REVIEW_STORE = "reviewState";

export type ReviewState = Record<string, boolean>;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(REVIEW_STORE)) {
        req.result.createObjectStore(REVIEW_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function keyFor(owner: string, repo: string, number: string): string {
  return `${owner}/${repo}/${number}`;
}

export async function getReviewState(
  owner: string,
  repo: string,
  number: string,
): Promise<ReviewState> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(REVIEW_STORE, "readonly").objectStore(REVIEW_STORE)
      .get(keyFor(owner, repo, number));
    req.onsuccess = () => resolve(req.result ?? {});
    req.onerror = () => reject(req.error);
  });
}

export async function setHunksReviewed(
  owner: string,
  repo: string,
  number: string,
  keys: string[],
  reviewed: boolean,
): Promise<ReviewState> {
  const db = await openDb();
  const key = keyFor(owner, repo, number);
  return new Promise((resolve, reject) => {
    const store = db.transaction(REVIEW_STORE, "readwrite").objectStore(REVIEW_STORE);
    const getReq = store.get(key);
    getReq.onsuccess = () => {
      const state: ReviewState = getReq.result ?? {};
      for (const k of keys) state[k] = reviewed;
      const putReq = store.put(state, key);
      putReq.onsuccess = () => resolve(state);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}
