import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.join(import.meta.dirname, "..", "data");

export interface Idea {
  id: string;
  title: string;
  summary: string;
  hunks: string[];
}

export interface IdeasState {
  generatedAt: string;
  ideas: Idea[];
}

function fileFor(owner: string, repo: string, number: string): string {
  return path.join(DATA_DIR, `${owner}-${repo}-${number}.ideas.json`);
}

export async function readIdeas(
  owner: string,
  repo: string,
  number: string,
): Promise<IdeasState | null> {
  try {
    const raw = await readFile(fileFor(owner, repo, number), "utf-8");
    return JSON.parse(raw) as IdeasState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeIdeas(
  owner: string,
  repo: string,
  number: string,
  ideas: Idea[],
): Promise<IdeasState> {
  const state: IdeasState = { generatedAt: new Date().toISOString(), ideas };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(fileFor(owner, repo, number), JSON.stringify(state, null, 2));
  return state;
}
