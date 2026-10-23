import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { persistent } from "../storage/persistent.server.js";
import type { Provider } from "../storage/settings.server.js";

// A provider's key, from a command the reviewer gives - `security
// find-generic-password -s litellm -w`, say - so it can live in their own
// secret store rather than in Docent's settings. The command's output is the
// key; it never goes back to the page.

const TTL = 5 * 60_000;
const TIMEOUT = 10_000;

const state = persistent("providerKey", () => ({
  keys: new Map<string, { key: string; at: number }>(),
  pending: new Map<string, Promise<string>>(),
}));

export type KeyCheck = { state: "found" } | { state: "missing" | "failed"; message: string };

class KeyCommandError extends Error {
  constructor(
    message: string,
    readonly missing = false,
  ) {
    super(message);
  }
}

// The program and its arguments. There's no shell, so nothing past the
// command's own words is interpreted: no pipes, substitution or variables.
export function splitCommand(command: string): string[] {
  const words: string[] = [];
  let word = "";
  let started = false;
  let quote: string | null = null;
  for (const ch of command.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else word += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      word += ch;
      started = true;
    }
  }
  if (quote) throw new Error("The command has an unclosed quote.");
  if (started) words.push(word);
  return words;
}

function lookup(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let program: string | undefined;
    let args: string[];
    try {
      [program, ...args] = splitCommand(command);
    } catch (err) {
      return reject(new KeyCommandError((err as Error).message));
    }
    if (!program) return reject(new KeyCommandError("The key command is empty."));
    execFile(program, args, { timeout: TIMEOUT, cwd: homedir(), maxBuffer: 64 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const e = err as NodeJS.ErrnoException & { killed?: boolean };
        if (e.code === "ENOENT") return reject(new KeyCommandError(`The key command couldn't run: ${program} wasn't found.`));
        if (e.killed) return reject(new KeyCommandError(`The key command didn't finish within ${TIMEOUT / 1000} seconds.`));
        const detail = stderr.trim().split("\n")[0];
        return reject(new KeyCommandError(`The key command failed${detail ? `: ${detail}` : "."}`, /could not be found/i.test(stderr)));
      }
      const key = stdout.trim();
      if (!key) return reject(new KeyCommandError("The key command printed nothing."));
      resolve(key);
    });
  });
}

// The key for a call to `provider`: from its command when it has one, held
// for a few minutes so a burst of reviewers asks once and a key changed in
// the store is picked up without a restart. A failed lookup isn't held.
export async function providerKey(provider: Provider): Promise<string | undefined> {
  const command = provider.apiKeyCommand?.trim();
  if (!command) return provider.apiKey;
  const held = state.keys.get(command);
  if (held && Date.now() - held.at < TTL) return held.key;
  let pending = state.pending.get(command);
  if (!pending) {
    pending = lookup(command)
      .then((key) => {
        state.keys.set(command, { key, at: Date.now() });
        return key;
      })
      .finally(() => state.pending.delete(command));
    state.pending.set(command, pending);
  }
  return pending;
}

// Whether the command gives a key, run afresh and without the key leaving
// here; what it finds replaces what's held.
export async function checkKeyCommand(command: string): Promise<KeyCheck> {
  try {
    state.keys.set(command, { key: await lookup(command), at: Date.now() });
    return { state: "found" };
  } catch (err) {
    state.keys.delete(command);
    return { state: (err as KeyCommandError).missing ? "missing" : "failed", message: (err as Error).message };
  }
}
