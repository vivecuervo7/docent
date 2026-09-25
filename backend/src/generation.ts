import { fetchPrConversation, fetchPrFiles, fetchPrMeta } from "./github.js";
import { maxConcurrentGenerations } from "./config.js";
import { generateConversationSummary, generateSummary } from "./overview.js";
import { generateFileNotes } from "./fileNotes.js";
import { generateSlices } from "./slices.js";
import type { ConversationSummary, FileNote, PrSummary, Slice } from "./types.js";

// Preparing a PR's review runs here rather than in the browser, so it keeps
// going when the tab closes and can be checked in on or stopped. Jobs live in
// memory: they survive as long as this process does. The browser copies each
// result into the saved review as it appears, so nothing here needs to outlast
// a restart.

export type StepName = "slices" | "conversation" | "summary" | "notes";

export interface StepState {
  status: "pending" | "active" | "done";
  startedAt?: number;
}

export interface Generation {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "stopped";
  // The model it runs with, when the review has its own.
  model?: string;
  steps: Record<StepName, StepState>;
  results: {
    slices?: Slice[];
    conversation?: ConversationSummary;
    summary?: PrSummary;
    fileNotes?: Record<string, FileNote[]>;
  };
  error?: string;
}

export interface Reuse {
  slices?: Slice[];
  conversation?: ConversationSummary;
  // Only reused along with the slices they were written for.
  fileNotes?: Record<string, FileNote[]>;
}

interface Job {
  generation: Generation;
  owner: string;
  repo: string;
  number: string;
  reuse: Reuse;
  // The review's own model; the picked one when it has none.
  model?: string;
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
export function startGeneration(owner: string, repo: string, number: string, reuse: Reuse, model?: string): Generation {
  const key = keyFor(owner, repo, number);
  const existing = jobs.get(key);
  if (existing && isActive(existing.generation)) return existing.generation;

  const generation: Generation = {
    id: `${key}:${Date.now()}`,
    status: "queued",
    model,
    steps: {
      slices: { status: reuse.slices ? "done" : "pending" },
      conversation: { status: reuse.conversation ? "done" : "pending" },
      summary: { status: "pending" },
      notes: { status: reuse.slices && reuse.fileNotes ? "done" : "pending" },
    },
    results: {},
  };
  jobs.set(key, { generation, owner, repo, number, reuse, model, controller: new AbortController() });
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
  while (running < maxConcurrentGenerations() && queue.length > 0) {
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
  const { generation, owner, repo, number, reuse, model, controller } = job;
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
          const slices = await generateSlices(await fetchPrFiles(owner, repo, number), signal, model);
          generation.results.slices = slices;
          return slices;
        }),
      reuse.conversation ??
        step("conversation", async () => {
          const raw = await fetchPrConversation(owner, repo, number);
          const conversation = await generateConversationSummary(raw, signal, model);
          generation.results.conversation = conversation;
          return conversation;
        }),
    ]);
    // The summary and the file notes both build on the slices, and not on
    // each other, so they run side by side.
    await Promise.all([
      step("summary", async () => {
        const meta = await fetchPrMeta(owner, repo, number);
        generation.results.summary = await generateSummary(meta, slices, conversation, signal, model);
      }),
      reuse.slices && reuse.fileNotes
        ? undefined
        : step("notes", async () => {
            generation.results.fileNotes = await generateFileNotes(await fetchPrFiles(owner, repo, number), slices, signal, model);
          }),
    ]);
    generation.status = "done";
  } catch (err) {
    // A stop aborts the in-flight model calls, which surfaces here as an
    // error; the status was already set to "stopped".
    if (generation.status === "running") {
      generation.status = "failed";
      generation.error = (err as Error).message;
      for (const state of Object.values(generation.steps)) {
        if (state.status === "active") state.status = "pending";
      }
      console.error(`[generation] ${owner}/${repo}#${number} failed: ${generation.error}`);
      // Stop the step still running alongside the one that failed.
      controller.abort();
    }
  }
}
