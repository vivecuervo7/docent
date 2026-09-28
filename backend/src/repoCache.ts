import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { persistent } from "./persistent.js";

const execFileAsync = promisify(execFile);

// The code a PR sits in, for models checking what the diff alone can't show.
// Each repo is a bare clone in backend/data/repos holding only the PR heads
// asked for, each without history and without file contents: a file's
// contents are fetched the first time it's read or searched, and kept. So a
// huge repo costs its tree listing plus what's actually been looked at, and
// nothing is ever checked out - reads come straight from git's objects.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "repos");

// Caps on what one read can return, or one search can fetch.
const MAX_LIST = 2000;
const MAX_FILE_BYTES = 400_000;
const MAX_SEARCH_FILES = 4000;
const MAX_SEARCH_LINES = 200;

const github = persistent("repo-cache.github", () => ({ token: null as Promise<string> | null }));

// GitHub's token, passed in the environment so it's never on a command line
// or written into the clone's config.
async function env(): Promise<NodeJS.ProcessEnv> {
  github.token ??= execFileAsync("gh", ["auth", "token"]).then(({ stdout }) => stdout.trim());
  const auth = Buffer.from(`x-access-token:${await github.token}`).toString("base64");
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${auth}`,
  };
}

async function git(dir: string, args: string[], extraEnv: Record<string, string> = {}): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: dir,
    env: { ...(await env()), ...extraEnv },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });
  return stdout;
}

// One git operation at a time per repo, so fetches and reads can't trip
// over each other.
const queues = persistent("repo-cache.queues", () => new Map<string, Promise<unknown>>());

function inRepo<T>(owner: string, repo: string, work: (dir: string) => Promise<T>): Promise<T> {
  const dir = join(root, owner, `${repo}.git`);
  const run = (queues.get(dir) ?? Promise.resolve()).catch(() => {}).then(() => work(dir));
  queues.set(dir, run);
  return run;
}

async function ensureRepo(owner: string, repo: string, dir: string) {
  if (existsSync(join(dir, "HEAD"))) return;
  mkdirSync(dir, { recursive: true });
  await git(dir, ["init", "--quiet", "--bare"]);
  await git(dir, ["remote", "add", "origin", `https://github.com/${owner}/${repo}.git`]);
  // Contents left out now come from GitHub when something reads them.
  await git(dir, ["config", "remote.origin.promisor", "true"]);
  await git(dir, ["config", "remote.origin.partialclonefilter", "blob:none"]);
}

// A PR's head commit, fetched if it isn't here yet. Fetched again at most
// once a minute, so a model's reads in a row don't each ask GitHub.
const heads = persistent("repo-cache.heads", () => new Map<string, { sha: string; at: number }>());

export function prHead(owner: string, repo: string, number: string): Promise<string> {
  const key = `${owner}/${repo}#${number}`;
  const known = heads.get(key);
  if (known && Date.now() - known.at < 60_000) return Promise.resolve(known.sha);
  return inRepo(owner, repo, async (dir) => {
    await ensureRepo(owner, repo, dir);
    const ref = `refs/docent/pull/${number}`;
    await git(dir, ["fetch", "--quiet", "--depth=1", "--filter=blob:none", "--no-tags", "origin", `+refs/pull/${number}/head:${ref}`]);
    const sha = (await git(dir, ["rev-parse", ref])).trim();
    heads.set(key, { sha, at: Date.now() });
    return sha;
  });
}

// A path as given by a model: relative to the repo's root, without "./" or
// a leading slash, and never climbing out of it.
function clean(path: string): string {
  const p = path.trim().replace(/^\.?\/+/, "").replace(/\/+$/, "");
  if (p.split("/").includes("..")) throw new Error(`"${path}" isn't a path inside the repo.`);
  return p;
}

export function listFiles(owner: string, repo: string, sha: string, dir = ""): Promise<string> {
  return inRepo(owner, repo, async (repoDir) => {
    const d = clean(dir);
    const out = await git(repoDir, ["ls-tree", "-r", "--name-only", sha, "--", ...(d ? [d] : [])]);
    const files = out.split("\n").filter(Boolean);
    if (!files.length) return d ? `Nothing at ${d}.` : "The repo is empty.";
    const shown = files.slice(0, MAX_LIST).join("\n");
    return files.length > MAX_LIST ? `${shown}\n\n(${files.length - MAX_LIST} more; list a narrower directory)` : shown;
  });
}

// A file's lines, numbered, optionally only some of them.
export function readFile(owner: string, repo: string, sha: string, path: string, from?: number, to?: number): Promise<string> {
  return inRepo(owner, repo, async (repoDir) => {
    const p = clean(path);
    let content: string;
    try {
      content = await git(repoDir, ["cat-file", "blob", `${sha}:${p}`]);
    } catch {
      throw new Error(`There's no file at ${p} in the PR's head. list_files shows what's there.`);
    }
    const lines = content.split("\n");
    const start = Math.max(1, from ?? 1);
    const end = Math.min(lines.length, to ?? lines.length);
    let out = "";
    for (let n = start; n <= end; n++) {
      const line = `${n}: ${lines[n - 1]}\n`;
      if (out.length + line.length > MAX_FILE_BYTES) {
        return `${out}\n(cut off at line ${n - 1} of ${lines.length}; read on from there)`;
      }
      out += line;
    }
    return out;
  });
}

// Lines matching a pattern (an extended regular expression) under a
// directory. The directory's contents are fetched in one go first, rather
// than file by file as git would.
export function searchCode(owner: string, repo: string, sha: string, pattern: string, dir: string): Promise<string> {
  return inRepo(owner, repo, async (repoDir) => {
    const d = clean(dir);
    const tree = await git(repoDir, ["ls-tree", "-r", sha, "--", ...(d ? [d] : [])]);
    const blobs = [...new Set(tree.split("\n").flatMap((l) => (l.split(/\s+/)[1] === "blob" ? [l.split(/\s+/)[2]] : [])))];
    if (blobs.length > MAX_SEARCH_FILES) {
      throw new Error(`${d || "The repo"} has ${blobs.length} files; search a narrower directory (at most ${MAX_SEARCH_FILES}).`);
    }
    const missing = await new Promise<string[]>((resolve, reject) => {
      const child = execFile(
        "git",
        ["cat-file", "--batch-check"],
        { cwd: repoDir, env: { ...process.env, GIT_NO_LAZY_FETCH: "1" }, maxBuffer: 16 * 1024 * 1024 },
        (err, stdout) => (err ? reject(err) : resolve(stdout.split("\n").flatMap((l) => (l.endsWith(" missing") ? [l.split(" ")[0]] : [])))),
      );
      child.stdin?.end(blobs.join("\n") + "\n");
    });
    for (let i = 0; i < missing.length; i += 500) {
      await git(repoDir, [
        "-c",
        "fetch.negotiationAlgorithm=noop",
        "fetch",
        "--quiet",
        "--no-tags",
        "--no-write-fetch-head",
        "--filter=blob:none",
        "origin",
        ...missing.slice(i, i + 500),
      ]);
    }
    let out: string;
    try {
      out = await git(repoDir, ["grep", "-n", "-I", "-E", "-e", pattern, sha, "--", ...(d ? [d] : [])]);
    } catch (err) {
      // No match is exit code 1.
      if ((err as { code?: number }).code === 1) return `No matches for /${pattern}/ in ${d || "the repo"}.`;
      throw new Error(`The search failed: ${(err as Error).message.split("\n").find((l) => /fatal|error/i.test(l)) ?? "bad pattern?"}`);
    }
    const lines = out
      .split("\n")
      .filter(Boolean)
      .map((l) => l.slice(sha.length + 1));
    const shown = lines.slice(0, MAX_SEARCH_LINES).join("\n");
    return lines.length > MAX_SEARCH_LINES ? `${shown}\n\n(${lines.length - MAX_SEARCH_LINES} more matches; narrow the pattern or directory)` : shown;
  });
}
