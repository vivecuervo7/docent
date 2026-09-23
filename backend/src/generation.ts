import { fetchPrConversation, fetchPrFiles, fetchPrMeta } from "./github.js";
import { MAX_CONCURRENT_GENERATIONS } from "./modelProvider.js";
import { generateConversationSummary, generateSummary } from "./overview.js";
import { generateSlices } from "./slices.js";
import type { ConversationSummary, PrSummary, Slice } from "./types.js";

// Preparing a PR's review runs here rather than in the browser, so it keeps
// going when the tab closes and can be checked in on or stopped. Jobs live in
// memory: they survive as long as this process does. The browser copies each
// result into its own storage as it appears, so nothing here needs to outlast
// a restart.

export type StepName = "slices" | "conversation" | "summary";

export interface StepState {
  status: "pending" | "active" | "done";
  startedAt?: number;
}

export interface Generation {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "stopped";
  steps: Record<StepName, StepState>;
  results: { slices?: Slice[]; conversation?: ConversationSummary; summary?: PrSummary };
  error?: string;
}

export interface Reuse {
  slices?: Slice[];
  conversation?: ConversationSummary;
}

interface Job {
  generation: Generation;
  owner: string;
  repo: string;
  number: string;
  reuse: Reuse;
  controller: AbortController;
}

const jobs = new Map<string, Job>();
const queue: string[] = [];
let running = 0;

function keyFor(owner: string, repo: string, number: string): string {
  return `${owner}/${repo}/${number}`;
}

function isActive(generation: Generation): boolean {
  return generation.status === "queued" || generation.status === "running";
}

export interface ListedGeneration {
  owner: string;
  repo: string;
  number: string;
  generation: Generation;
}

export function listGenerations(): ListedGeneration[] {
  return [...jobs.values()].map(({ owner, repo, number, generation }) => ({
    owner,
    repo,
    number,
    generation,
  }));
}

export function getGeneration(owner: string, repo: string, number: string): Generation | null {
  return jobs.get(keyFor(owner, repo, number))?.generation ?? null;
}

// Attaches to a generation that's already queued or running for this PR;
// otherwise replaces any finished one with a fresh run. Steps with a result
// in `reuse` are treated as already done.
export function startGeneration(owner: string, repo: string, number: string, reuse: Reuse): Generation {
  const key = keyFor(owner, repo, number);
  const existing = jobs.get(key);
  if (existing && isActive(existing.generation)) return existing.generation;

  const generation: Generation = {
    id: `${key}:${Date.now()}`,
    status: "queued",
    steps: {
      slices: { status: reuse.slices ? "done" : "pending" },
      conversation: { status: reuse.conversation ? "done" : "pending" },
      summary: { status: "pending" },
    },
    results: {},
  };
  jobs.set(key, { generation, owner, repo, number, reuse, controller: new AbortController() });
  queue.push(key);
  pump();
  return generation;
}

export function stopGeneration(owner: string, repo: string, number: string): Generation | null {
  const key = keyFor(owner, repo, number);
  const job = jobs.get(key);
  if (!job) return null;
  if (isActive(job.generation)) {
    const index = queue.indexOf(key);
    if (index >= 0) queue.splice(index, 1);
    job.generation.status = "stopped";
    for (const state of Object.values(job.generation.steps)) {
      if (state.status === "active") state.status = "pending";
    }
    job.controller.abort();
  }
  return job.generation;
}

export function dismissGeneration(owner: string, repo: string, number: string): void {
  const key = keyFor(owner, repo, number);
  const job = jobs.get(key);
  if (job && !isActive(job.generation)) jobs.delete(key);
}

function pump() {
  while (running < MAX_CONCURRENT_GENERATIONS && queue.length > 0) {
    const job = jobs.get(queue.shift()!);
    if (!job || job.generation.status !== "queued") continue;
    running++;
    run(job).finally(() => {
      running--;
      pump();
    });
  }
}

async function run(job: Job) {
  const { generation, owner, repo, number, reuse, controller } = job;
  const { signal } = controller;
  generation.status = "running";

  const step = async <T>(name: StepName, work: () => Promise<T>): Promise<T> => {
    generation.steps[name] = { status: "active", startedAt: Date.now() };
    const result = await work();
    generation.steps[name] = { status: "done" };
    return result;
  };

  try {
    const [slices, conversation] = await Promise.all([
      reuse.slices ??
        step("slices", async () => {
          const slices = await generateSlices(await fetchPrFiles(owner, repo, number), signal);
          generation.results.slices = slices;
          return slices;
        }),
      reuse.conversation ??
        step("conversation", async () => {
          const raw = await fetchPrConversation(owner, repo, number);
          const conversation = await generateConversationSummary(raw, signal);
          generation.results.conversation = conversation;
          return conversation;
        }),
    ]);
    await step("summary", async () => {
      const meta = await fetchPrMeta(owner, repo, number);
      generation.results.summary = await generateSummary(meta, slices, conversation, signal);
    });
    generation.status = "done";
  } catch (err) {
    // A stop aborts the in-flight model calls, which surfaces here as an
    // error; the status was already set to "stopped".
    if (generation.status === "running") {
      generation.status = "failed";
      generation.error = (err as Error).message;
      // Stop the step still running alongside the one that failed.
      controller.abort();
    }
  }
}
