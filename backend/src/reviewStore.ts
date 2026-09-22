import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.join(import.meta.dirname, "..", "data");

// Keyed by hunk reference ("filename#hunkIndex", or "filename#file" for
// files with no hunks to address individually). File-level "reviewed" is
// derived from these on the frontend, not stored directly.
export type ReviewState = Record<string, boolean>;

function fileFor(owner: string, repo: string, number: string): string {
  return path.join(DATA_DIR, `${owner}-${repo}-${number}.json`);
}

export async function readReviewState(
  owner: string,
  repo: string,
  number: string,
): Promise<ReviewState> {
  try {
    const raw = await readFile(fileFor(owner, repo, number), "utf-8");
    return JSON.parse(raw) as ReviewState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

export async function setHunksReviewed(
  owner: string,
  repo: string,
  number: string,
  keys: string[],
  reviewed: boolean,
): Promise<ReviewState> {
  const state = await readReviewState(owner, repo, number);
  for (const key of keys) state[key] = reviewed;
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(fileFor(owner, repo, number), JSON.stringify(state, null, 2));
  return state;
}
