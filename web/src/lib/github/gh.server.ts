import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { persistent } from "../storage/persistent.server.js";

// GitHub through the gh CLI, signed in as the reviewer. Its answers - a big
// PR's files with their patches, say - can run well past Node's 1MB default
// for a command's output.

const run = promisify(execFile);

export async function gh(args: string[], { timeout }: { timeout?: number } = {}): Promise<string> {
  const { stdout } = await run("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...(timeout ? { timeout } : {}) });
  return stdout;
}

export interface Pull {
  title: string;
  body: string | null;
  htmlUrl: string;
  author?: string;
  head: string;
  base: string;
}

// A PR's own fields - its title, author, and the commits it starts and ends
// at - read once for everything that asks within a few seconds, as reading
// one round's files asks for both its ends.
const pulls = persistent("gh.pulls", () => new Map<string, { at: number; pull: Promise<Pull> }>());

export function pull(owner: string, repo: string, number: string): Promise<Pull> {
  const key = `${owner}/${repo}#${number}`;
  const held = pulls.get(key);
  if (held && Date.now() - held.at < 5_000) return held.pull;
  const fields = "{title: .title, body: .body, htmlUrl: .html_url, author: .user.login, head: .head.sha, base: .base.sha}";
  const read = gh(["api", `repos/${owner}/${repo}/pulls/${number}`, "--jq", fields]).then((out) => JSON.parse(out) as Pull);
  pulls.set(key, { at: Date.now(), pull: read });
  read.catch(() => pulls.delete(key));
  return read;
}

// Where `head` left `base`: what a PR's diff is measured from.
export async function mergeBase(owner: string, repo: string, base: string, head: string): Promise<string> {
  return (await gh(["api", `repos/${owner}/${repo}/compare/${base}...${head}`, "--jq", ".merge_base_commit.sha"])).trim();
}

// Who's signed in, asked once; asked again if that failed.
const viewer = persistent("gh.viewer", () => ({ login: null as Promise<string> | null }));

export function viewerLogin(): Promise<string> {
  viewer.login ??= gh(["api", "user", "--jq", ".login"]).then((out) => out.trim());
  viewer.login.catch(() => (viewer.login = null));
  return viewer.login;
}
