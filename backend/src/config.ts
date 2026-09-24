import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Where the model lives and how to reach it. The endpoint, key and limits
// come from backend/.env (see .env.example), so the key stays on this
// machine and out of the browser. The model can also be picked from the
// start page; that choice is kept in backend/data/settings.json, along with
// the review panel a new PR starts with.

const backendDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(backendDir, ".env");
const settingsFile = join(backendDir, "data", "settings.json");

if (existsSync(envFile)) process.loadEnvFile(envFile);

const DEFAULT_BASE_URL = "http://127.0.0.1:8000/v1";
const DEFAULT_MODEL = "gemma-4-12B-it-8bit";

interface Settings {
  model?: string;
  // Each reviewer in the default panel: a model, or "external" for the
  // reviewer's own agent.
  panel?: string[];
}

function readSettings(): Settings {
  try {
    return JSON.parse(readFileSync(settingsFile, "utf8")) as Settings;
  } catch {
    return {};
  }
}

export function modelBaseUrl(): string {
  return (process.env.DOCENT_MODEL_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export function modelApiKey(): string | undefined {
  return process.env.DOCENT_MODEL_API_KEY || undefined;
}

// The model picked on the start page, else the one in .env.
export function modelName(): string {
  return readSettings().model || process.env.DOCENT_MODEL || DEFAULT_MODEL;
}

function writeSettings(change: Settings): void {
  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify({ ...readSettings(), ...change }, null, 2), { mode: 0o600 });
}

export function setModelName(model: string): void {
  writeSettings({ model });
}

export function defaultPanel(): string[] | null {
  return readSettings().panel ?? null;
}

export function setDefaultPanel(panel: string[]): void {
  writeSettings({ panel });
}

// Claude Code models are picked with this prefix (see modelProvider.ts).
export function usingClaudeCode(): boolean {
  return modelName().startsWith("claude-code:");
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

// How much runs at once depends on the model. A local model serves one
// request at a time, so running more only makes each slower; a hosted
// endpoint can take more, set in .env. Claude Code calls are separate
// processes, so several run side by side - a few, to leave the reviewer's
// own sessions room. Read on every call, so picking another model applies
// straight away.

// PRs being prepared at once; the rest wait in a queue.
export function maxConcurrentGenerations(): number {
  return usingClaudeCode() ? 3 : positiveInt(process.env.DOCENT_MAX_CONCURRENT_GENERATIONS, 1);
}

// Other model calls at once: question replies, drafting, the agent review
// and preparing the review.
export function maxConcurrentRequests(): number {
  return usingClaudeCode() ? 4 : positiveInt(process.env.DOCENT_MAX_CONCURRENT_REQUESTS, 1);
}
