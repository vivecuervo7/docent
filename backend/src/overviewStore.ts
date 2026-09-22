import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.join(import.meta.dirname, "..", "data");

export interface ConversationCard {
  author: string;
  kind: string;
  summary: string;
}

export interface PrSummary {
  what: string;
  why: string;
  how?: string;
}

export interface OverviewState {
  summary?: PrSummary & { generatedAt: string };
  conversation?: { cards: ConversationCard[]; generatedAt: string };
}

function fileFor(owner: string, repo: string, number: string): string {
  return path.join(DATA_DIR, `${owner}-${repo}-${number}.overview.json`);
}

export async function readOverview(
  owner: string,
  repo: string,
  number: string,
): Promise<OverviewState> {
  try {
    const raw = await readFile(fileFor(owner, repo, number), "utf-8");
    return JSON.parse(raw) as OverviewState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

async function writeOverview(
  owner: string,
  repo: string,
  number: string,
  state: OverviewState,
): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(fileFor(owner, repo, number), JSON.stringify(state, null, 2));
}

export async function saveSummary(
  owner: string,
  repo: string,
  number: string,
  summary: PrSummary,
): Promise<OverviewState> {
  const state = await readOverview(owner, repo, number);
  state.summary = { ...summary, generatedAt: new Date().toISOString() };
  await writeOverview(owner, repo, number, state);
  return state;
}

export async function saveConversation(
  owner: string,
  repo: string,
  number: string,
  cards: ConversationCard[],
): Promise<OverviewState> {
  const state = await readOverview(owner, repo, number);
  state.conversation = { cards, generatedAt: new Date().toISOString() };
  await writeOverview(owner, repo, number, state);
  return state;
}
