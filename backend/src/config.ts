import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Docent's settings, all in backend/data/settings.json: the model providers
// (OpenAI-compatible endpoints, keys included, so the file is written
// owner-only and never sent to the browser as it is), the model picked on
// the start page, and the review panel a new PR starts with.

const backendDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const settingsFile = join(backendDir, "data", "settings.json");

// A model from Claude Code's or Codex's group is saved with its prefix; one
// from a provider with the provider's id and a colon.
export const CLAUDE_CODE_PREFIX = "claude-code:";
export const CODEX_PREFIX = "codex:";

export interface Provider {
  id: string;
  name: string;
  // Up to and including /v1.
  baseUrl: string;
  apiKey?: string;
  // Requests it takes at once: 1 for a local server, which serves one at a
  // time, so running more only makes each slower.
  concurrency: number;
}

// A review persona: a command run in an unattended Claude Code session.
export interface Persona {
  id: string;
  name: string;
  // What the reviewer would type, with {pr_url}, {owner}, {repo}, {number}.
  command: string;
  model?: string;
  // Tools it may use beyond those every persona has, space-separated.
  tools?: string;
}

interface Settings {
  model?: string;
  personas?: Persona[];
  // Each reviewer in the default panel: a model, or "external" for the
  // reviewer's own agent.
  panel?: string[];
  providers?: Provider[];
}

function readSettings(): Settings {
  try {
    return JSON.parse(readFileSync(settingsFile, "utf8")) as Settings;
  } catch {
    return {};
  }
}

function writeSettings(change: Settings): void {
  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify({ ...readSettings(), ...change }, null, 2), { mode: 0o600 });
}

const newProviderId = () => `p${randomUUID().slice(0, 6)}`;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// Settings used to come from backend/.env. Its endpoint becomes the first
// provider, once; after that .env isn't read.
function importEnvOnce(): void {
  const settings = readSettings();
  if (settings.providers) return;
  const envFile = join(backendDir, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const baseUrl = process.env.DOCENT_MODEL_BASE_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) return writeSettings({ providers: [] });
  const provider: Provider = {
    id: newProviderId(),
    name: hostOf(baseUrl),
    baseUrl,
    apiKey: process.env.DOCENT_MODEL_API_KEY || undefined,
    concurrency: Number(process.env.DOCENT_MAX_CONCURRENT_REQUESTS) || 1,
  };
  const legacy = settings.model ?? process.env.DOCENT_MODEL;
  const model = legacy && !legacy.startsWith(CLAUDE_CODE_PREFIX) && !legacy.startsWith(CODEX_PREFIX) ? `${provider.id}:${legacy}` : legacy;
  writeSettings({ providers: [provider], model });
}
importEnvOnce();

export function providers(): Provider[] {
  return readSettings().providers ?? [];
}

export function addProvider(fields: Omit<Provider, "id">): Provider {
  const provider = { ...fields, id: newProviderId() };
  writeSettings({ providers: [...providers(), provider] });
  return provider;
}

// `apiKey: null` clears the key; leaving it out keeps it.
export function updateProvider(id: string, change: Partial<Omit<Provider, "id" | "apiKey">> & { apiKey?: string | null }): Provider | null {
  const current = providers().find((p) => p.id === id);
  if (!current) return null;
  const { apiKey, ...rest } = change;
  const next: Provider = { ...current, ...rest };
  if (apiKey === null) delete next.apiKey;
  else if (apiKey !== undefined) next.apiKey = apiKey;
  writeSettings({ providers: providers().map((p) => (p.id === id ? next : p)) });
  return next;
}

export function removeProvider(id: string): boolean {
  const list = providers();
  if (!list.some((p) => p.id === id)) return false;
  writeSettings({ providers: list.filter((p) => p.id !== id) });
  return true;
}

export function personas(): Persona[] {
  return readSettings().personas ?? [];
}

export function addPersona(fields: Omit<Persona, "id">): Persona {
  const persona = { ...fields, id: `r${randomUUID().slice(0, 6)}` };
  writeSettings({ personas: [...personas(), persona] });
  return persona;
}

export function updatePersona(id: string, change: Partial<Omit<Persona, "id">>): Persona | null {
  const current = personas().find((p) => p.id === id);
  if (!current) return null;
  const merged: Record<string, unknown> = { ...current, ...change };
  for (const key of Object.keys(merged)) if (merged[key] === undefined || merged[key] === null) delete merged[key];
  const next = merged as unknown as Persona;
  writeSettings({ personas: personas().map((p) => (p.id === id ? next : p)) });
  return next;
}

export function removePersona(id: string): boolean {
  const list = personas();
  if (!list.some((p) => p.id === id)) return false;
  writeSettings({ personas: list.filter((p) => p.id !== id) });
  return true;
}

// What a saved model id refers to. A bare name, saved before providers had
// ids, is taken as the first provider's.
export type ResolvedModel =
  | { kind: "claude-code"; alias: string }
  | { kind: "codex"; model: string }
  | { kind: "provider"; provider: Provider; model: string };

export function resolveModel(id: string): ResolvedModel | null {
  if (id.startsWith(CLAUDE_CODE_PREFIX)) return { kind: "claude-code", alias: id.slice(CLAUDE_CODE_PREFIX.length) };
  if (id.startsWith(CODEX_PREFIX)) return { kind: "codex", model: id.slice(CODEX_PREFIX.length) };
  const list = providers();
  const colon = id.indexOf(":");
  const owner = colon > 0 ? list.find((p) => p.id === id.slice(0, colon)) : undefined;
  if (owner) return { kind: "provider", provider: owner, model: id.slice(colon + 1) };
  return list[0] ? { kind: "provider", provider: list[0], model: id } : null;
}

// The model picked on the start page.
export function modelName(): string {
  return readSettings().model ?? "";
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

// How much runs at once follows the picked model's provider. Claude Code
// and Codex calls are separate processes, so several run side by side: a
// few, to leave the reviewer's own sessions room. Read on every call, so picking another
// model applies straight away.
function selected(): ResolvedModel | null {
  return resolveModel(modelName());
}

// PRs being prepared at once; the rest wait in a queue.
export function maxConcurrentGenerations(): number {
  const model = selected();
  if (!model) return 1;
  return model.kind === "provider" ? model.provider.concurrency : 3;
}

// Other model calls at once: question replies, drafting, the agent review
// and preparing the review.
export function maxConcurrentRequests(): number {
  const model = selected();
  if (!model) return 1;
  return model.kind === "provider" ? model.provider.concurrency : 4;
}
