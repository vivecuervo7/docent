import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fetchPrBaseSha, fetchPrFiles, fetchPrHeadSha, type PrFile } from "./github.server.js";
import { getRecord, keyFor } from "../storage/store.server.js";
import type { PrCommit, ReviewRange } from "../types.server.js";

const execFileAsync = promisify(execFile);

// Reviewing some of a PR's commits: the PR as it stands at the range's last
// commit, shown only where the range changed it. That's the end result, not
// the steps, and every line shown is in the PR's diff, so comments on it can
// go inline. It also drops what a merge from the base branch brought in:
// those lines changed in the range, but aren't in the PR's diff.

// The PR's own commits, oldest first. A merge commit is marked, for the
// range picker to leave out: it brings in the base branch's work.
export async function fetchPrCommits(owner: string, repo: string, number: string): Promise<PrCommit[]> {
  const { stdout } = await execFileAsync("gh", [
    "api",
    "--paginate",
    `repos/${owner}/${repo}/pulls/${number}/commits?per_page=100`,
    "--jq",
    ".[] | {sha, parents: [.parents[].sha], date: .commit.author.date, message: .commit.message}",
  ]);
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const c = JSON.parse(line) as { sha: string; parents: string[]; date: string; message: string };
      return { sha: c.sha, parent: c.parents[0], date: c.date, message: c.message.split("\n")[0], merge: c.parents.length > 1 };
    });
}

// The files under review: the whole PR, or the range the review was begun
// with. Each file of a range marks the hunks the range touched, and only
// files it touched are listed.
export async function fetchReviewFiles(owner: string, repo: string, number: string): Promise<PrFile[]> {
  const range = getRecord(keyFor(owner, repo, number)).record.range as ReviewRange | undefined;
  if (!range) return fetchPrFiles(owner, repo, number);
  const head = await fetchPrHeadSha(owner, repo, number);
  const [prFiles, rangeFiles] = await Promise.all([
    range.to === head ? fetchPrFiles(owner, repo, number) : fetchPrBaseSha(owner, repo, number).then((base) => compareFiles(owner, repo, base, range.to)),
    compareFiles(owner, repo, range.after, range.to),
  ]);
  return scopeToRange(prFiles, rangeFiles);
}

// For a model reviewing a range, what its diff covers; empty for the whole PR.
export function rangeNote(owner: string, repo: string, number: string): string {
  const range = getRecord(keyFor(owner, repo, number)).record.range as ReviewRange | undefined;
  return range
    ? `This review covers only some of the PR's commits, ${range.after.slice(0, 7)}..${range.to.slice(0, 7)}. The diff is the PR as it stands after them, shown only where they changed it: review those changes, and read the rest of the PR only for context.`
    : "";
}

// The commit the review reads up to.
export async function fetchReviewHead(owner: string, repo: string, number: string): Promise<string> {
  const range = getRecord(keyFor(owner, repo, number)).record.range as ReviewRange | undefined;
  return range?.to ?? fetchPrHeadSha(owner, repo, number);
}

async function compareFiles(owner: string, repo: string, from: string, to: string): Promise<PrFile[]> {
  const { stdout } = await execFileAsync("gh", ["api", `repos/${owner}/${repo}/compare/${from}...${to}`, "--jq", ".files"], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(stdout) as PrFile[];
}

// Both diffs number new lines as the range's last commit has them, so a PR
// line the range added is one the range's diff added too. A PR deletion the
// range made sits where the range's diff deleted lines.
export function scopeToRange(prFiles: PrFile[], rangeFiles: PrFile[]): PrFile[] {
  const byName = new Map(rangeFiles.map((f) => [f.filename, f]));
  return prFiles.flatMap((file) => {
    const changed = byName.get(file.filename);
    if (!file.patch || !changed?.patch) return [];
    const { added, deletedAt } = rangeChanges(changed.patch);
    const lines = { old: [] as number[], new: [] as number[] };
    const inRange: number[] = [];
    patchHunks(file.patch).forEach((hunk, index) => {
      let touched = false;
      for (const row of hunk) {
        if (row.kind === "add" && added.has(row.new)) {
          lines.new.push(row.new);
          touched = true;
        } else if (row.kind === "del" && deletedAt.has(row.new)) {
          lines.old.push(row.old);
          touched = true;
        }
      }
      if (touched) inRange.push(index);
    });
    return inRange.length ? [{ ...file, inRange, rangeLines: lines }] : [];
  });
}

// New lines a diff added, and the new lines its deletions sit before.
function rangeChanges(patch: string): { added: Set<number>; deletedAt: Set<number> } {
  const added = new Set<number>();
  const deletedAt = new Set<number>();
  for (const hunk of patchHunks(patch)) {
    for (const row of hunk) {
      if (row.kind === "add") added.add(row.new);
      else if (row.kind === "del") deletedAt.add(row.new);
    }
  }
  return { added, deletedAt };
}

// Each hunk's rows. A deleted row's `new` is the new line it sits before.
type PatchRow = { kind: "add" | "del" | "context"; old: number; new: number };

function patchHunks(patch: string): PatchRow[][] {
  const hunks: PatchRow[][] = [];
  let rows: PatchRow[] | null = null;
  let oldLine = 0;
  let newLine = 0;
  for (const line of patch.split("\n")) {
    const header = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);
    if (header) {
      rows = [];
      hunks.push(rows);
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
    } else if (!rows || line.startsWith("\\")) {
      continue;
    } else if (line.startsWith("+")) {
      rows.push({ kind: "add", old: oldLine, new: newLine++ });
    } else if (line.startsWith("-")) {
      rows.push({ kind: "del", old: oldLine++, new: newLine });
    } else {
      rows.push({ kind: "context", old: oldLine++, new: newLine++ });
    }
  }
  return hunks;
}
