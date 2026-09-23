import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Where the model lives and how to reach it. The endpoint, key and limits
// come from backend/.env (see .env.example), so the key stays on this
// machine and out of the browser. The model can also be picked from the
// start page; that choice is kept in backend/data/settings.json.

const backendDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(backendDir, ".env");
const settingsFile = join(backendDir, "data", "settings.json");

if (existsSync(envFile)) process.loadEnvFile(envFile);

const DEFAULT_BASE_URL = "http://127.0.0.1:8000/v1";
const DEFAULT_MODEL = "gemma-4-12B-it-8bit";

interface Settings {
  model?: string;
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

export function setModelName(model: string): void {
  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify({ ...readSettings(), model }, null, 2), { mode: 0o600 });
}

// How many PRs may be prepared at once; the rest wait in a queue. A local
// model serves one request at a time, so running more only makes each one
// slower. A hosted one can take more.
export function maxConcurrentGenerations(): number {
  const value = Number(process.env.DOCENT_MAX_CONCURRENT_GENERATIONS);
  return Number.isInteger(value) && value > 0 ? value : 1;
}
