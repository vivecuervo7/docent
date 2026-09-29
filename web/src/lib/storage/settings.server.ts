import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { dataDir } from "./dataDir.server.js";

// Docent's settings, all in the data folder's settings.json: the model providers
// (OpenAI-compatible endpoints, keys included, so the file is written
// owner-only and never sent to the browser as it is), the model picked on
// the start page, and the review panel a new PR starts with.

const settingsFile = dataDir("settings.json");

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

// A persona: Docent's own reviewer with a point of view, given by its
// instructions ("Security: look for injection, auth gaps..."). A reviewer
// on the panel runs one on whichever model it's set to.
export interface Persona {
  id: string;
  name: string;
  instructions: string;
}

// An external reviewer: the reviewer's own prompt or skill, run as an
// unattended Claude Code or Codex session.
export interface ExternalReviewer {
  id: string;
  name: string;
  runner: "claude-code" | "codex";
  // What the reviewer would type, with {pr_url}, {owner}, {repo}, {number}.
  command: string;
  model?: string;
  // Claude Code tools it may use beyond those it always has, space-separated.
  tools?: string;
}

// A reviewer in the default panel: what runs it (a model, "external" for
// the reviewer's own agent, or "session:<id>"), and for Docent's reviewer
// the persona it takes.
export interface PanelEntry {
  runs: string;
  persona?: string;
}

interface Settings {
  model?: string;
  // The panel's editor's model; see editorModel in grouping.ts.
  editorModel?: string;
  personas?: Persona[];
  externalReviewers?: ExternalReviewer[];
  // PRs kept off the start page's lists, as "owner/repo/number".
  hiddenPrs?: string[];
  // Calls run at once through each tool; see laneOf.
  claudeCodeConcurrency?: number;
  codexConcurrency?: number;
  // Plain strings are from before panels had personas.
  panel?: (string | PanelEntry)[];
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

// Personas and external reviewers are kept alike: a list in settings,
// each entry with an id.
function listIn<T extends { id: string }>(key: "personas" | "externalReviewers", prefix: string) {
  const list = (): T[] => (readSettings()[key] as T[] | undefined) ?? [];
  return {
    list,
    add(fields: Omit<T, "id">): T {
      const entry = { ...fields, id: `${prefix}${randomUUID().slice(0, 6)}` } as T;
      writeSettings({ [key]: [...list(), entry] });
      return entry;
    },
    // A field set to null is cleared.
    update(id: string, change: Record<string, unknown>): T | null {
      const current = list().find((e) => e.id === id);
      if (!current) return null;
      const merged: Record<string, unknown> = { ...current, ...change };
      for (const k of Object.keys(merged)) if (merged[k] === undefined || merged[k] === null) delete merged[k];
      const next = merged as unknown as T;
      writeSettings({ [key]: list().map((e) => (e.id === id ? next : e)) });
      return next;
    },
    remove(id: string): boolean {
      if (!list().some((e) => e.id === id)) return false;
      writeSettings({ [key]: list().filter((e) => e.id !== id) });
      return true;
    },
    // The same entries in a new order; null unless `ids` names each once.
    reorder(ids: string[]): T[] | null {
      const current = list();
      if (ids.length !== current.length || new Set(ids).size !== ids.length) return null;
      const next = ids.map((id) => current.find((e) => e.id === id));
      if (next.some((e) => !e)) return null;
      writeSettings({ [key]: next as T[] });
      return next as T[];
    },
  };
}

export const personas = listIn<Persona>("personas", "s");
export const externalReviewers = listIn<ExternalReviewer>("externalReviewers", "r");

// "Personas" used to be Claude Code sessions; those are external reviewers
// now, moved across once with their ids kept.
function moveSessionsOnce(): void {
  const settings = readSettings();
  if (settings.externalReviewers) return;
  const old = (settings.personas ?? []) as unknown as Record<string, unknown>[];
  const sessions = old.filter((p) => typeof p.command === "string");
  writeSettings({
    externalReviewers: sessions.map((p) => ({ ...(p as unknown as ExternalReviewer), runner: "claude-code" })),
    personas: old.filter((p) => typeof p.command !== "string") as unknown as Persona[],
  });
}
moveSessionsOnce();

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

export function savedEditorModel(): string | undefined {
  return readSettings().editorModel;
}

export function setEditorModel(editorModel: string): void {
  writeSettings({ editorModel });
}

export function hiddenPrs(): string[] {
  return readSettings().hiddenPrs ?? [];
}

export function setHidden(key: string, hidden: boolean): string[] {
  const list = hiddenPrs().filter((k) => k !== key);
  writeSettings({ hiddenPrs: hidden ? [...list, key] : list });
  return hiddenPrs();
}

export function defaultPanel(): PanelEntry[] | null {
  const panel = readSettings().panel;
  return panel ? panel.map((e) => (typeof e === "string" ? { runs: e } : e)) : null;
}

export function setDefaultPanel(panel: PanelEntry[]): void {
  writeSettings({ panel });
}

// How much runs at once follows the picked model's provider. Claude Code
// and Codex calls are separate processes, so several run side by side: a
// few, to leave the reviewer's own sessions room. Read on every call, so picking another
// model applies straight away.
function selected(): ResolvedModel | null {
  return resolveModel(modelName());
}

// Claude Code and Codex calls run on the reviewer's own plan and are
// separate processes here, so how many at once is theirs to choose.
const RUNNER_DEFAULT = 10;

export function runnerConcurrency(runner: "claude-code" | "codex"): number {
  const s = readSettings();
  return (runner === "codex" ? s.codexConcurrency : s.claudeCodeConcurrency) ?? RUNNER_DEFAULT;
}

export function setRunnerConcurrency(runner: "claude-code" | "codex", n: number): void {
  writeSettings(runner === "codex" ? { codexConcurrency: n } : { claudeCodeConcurrency: n });
}

// The queue a model's calls wait in, and how many run at once: one queue per
// tool or provider, so a Codex reviewer never waits behind Claude Code calls.
export function laneOf(model?: string): { key: string; cap: number } {
  const resolved = resolveModel(model ?? modelName());
  if (!resolved) return { key: "none", cap: 1 };
  if (resolved.kind === "provider") return { key: resolved.provider.id, cap: resolved.provider.concurrency };
  return { key: resolved.kind, cap: runnerConcurrency(resolved.kind) };
}

// PRs being prepared at once; the rest wait in a queue.
export function maxConcurrentGenerations(): number {
  const model = selected();
  if (!model) return 1;
  return model.kind === "provider" ? model.provider.concurrency : 3;
}

