import { fetchPrBaseSha, fetchPrFiles, fetchPrHeadSha, type PrFile } from "./github.server.js";
import { getRecord, keyFor } from "../storage/store.server.js";
import { changesBetween } from "./repoCache.server.js";
import { gh, mergeBase } from "./gh.server.js";
import { parseFilePatch } from "../features/reading/diff/parse.js";
import { roundRecord } from "../storage/rounds.server.js";
import type { PrCommit, ReviewRange } from "../types.server.js";


// Reviewing some of a PR's commits: the PR as it stands at the range's last
// commit, shown only where the range changed it. That's the end result, not
// the steps, and every line shown is in the PR's diff, so comments on it can
// go inline. It also drops what a merge from the base branch brought in:
// those lines changed in the range, but aren't in the PR's diff. What the
// range changed comes from the PR's files at either end, not GitHub's
// compare, which lists at most 300 files and leaves out a large file's
// patch: a range spanning merges of a busy base branch lost files that way.
// A rebased range has no commits between its ends, and is read the same.

// The PR's own commits, oldest first. A merge commit is marked, for the
// range picker to leave out: it brings in the base branch's work.
export async function fetchPrCommits(owner: string, repo: string, number: string): Promise<PrCommit[]> {
  const stdout = await gh([
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
// files it touched are listed. An earlier round's are as they were at the
// commit it was prepared at, which its slices refer to. With `whole`, all
// the PR's files at that commit, whichever commits the round covered.
export async function fetchReviewFiles(owner: string, repo: string, number: string, round?: number, { whole = false } = {}): Promise<PrFile[]> {
  const record = getRecord(keyFor(owner, repo, number)).record as { range?: ReviewRange; rounds?: { range?: ReviewRange; preparedHead?: string }[] };
  const earlier = round === undefined ? undefined : record.rounds?.[round];
  if (round !== undefined && !earlier) throw new Error(`No round ${round + 1}`);
  const range = earlier ? earlier.range : record.range;
  const head = await fetchPrHeadSha(owner, repo, number);
  const to = range?.to ?? earlier?.preparedHead ?? head;
  const prFiles = to === head ? fetchPrFiles(owner, repo, number) : prFilesAt(owner, repo, number, to);
  if (!range || whole) return prFiles;
  const pr = await prFiles;
  const changed = await changesBetween(owner, repo, range.after, range.to, pr.map((f) => f.filename)).catch((err) => {
    if (!range.rebased) throw err;
    throw new Error(`GitHub no longer has ${range.after.slice(0, 7)}, the commit the round before read up to, so what changed since can't be told.`);
  });
  return scopeToRange(pr, changed);
}

// For a model reviewing a range, what its diff covers; empty for the whole PR.
export function rangeNote(owner: string, repo: string, number: string, round?: number): string {
  const range = roundRecord(owner, repo, number, round).range as ReviewRange | undefined;
  if (range?.rebased)
    return `The PR was rebased since its last round of review, which read it at ${range.after.slice(0, 7)}. This review covers only what changed since then: the diff is the PR as it stands now, shown only where it differs from what that round read. Review those changes, and read the rest of the PR only for context.`;
  return range
    ? `This review covers only some of the PR's commits, ${range.after.slice(0, 7)}..${range.to.slice(0, 7)}. The diff is the PR as it stands after them, shown only where they changed it: review those changes, and read the rest of the PR only for context.`
    : "";
}

// The commit the review reads up to.
export async function fetchReviewHead(owner: string, repo: string, number: string): Promise<string> {
  const range = getRecord(keyFor(owner, repo, number)).record.range as ReviewRange | undefined;
  return range?.to ?? fetchPrHeadSha(owner, repo, number);
}

// The PR's files as they were at an earlier commit: what it changed since
// it left the base branch. Only where it left is asked of GitHub's compare,
// whose list of files stops at 300.
async function prFilesAt(owner: string, repo: string, number: string, to: string): Promise<PrFile[]> {
  const base = await fetchPrBaseSha(owner, repo, number);
  return changesBetween(owner, repo, await mergeBase(owner, repo, base, to), to);
}

// Both diffs number new lines as the range's last commit has them, so a PR
// line the range added is one the range's diff added too. A PR deletion the
// range made sits where the range's diff deleted lines.
// What the range removed that the PR had added itself appears in neither
// the PR's diff nor the base branch; it's kept apart, as `rangeRemoved`, by
// the line it sat before, and the hunk around it counts as touched.
export function scopeToRange(prFiles: PrFile[], rangeFiles: Pick<PrFile, "filename" | "patch">[]): PrFile[] {
  const byName = new Map(rangeFiles.map((f) => [f.filename, f]));
  return prFiles.flatMap((file) => {
    const changed = byName.get(file.filename);
    // Without the PR's diff of it, the range is taken to have changed all of it.
    if (!file.patch) return changed ? [file] : [];
    if (!changed?.patch) return [];
    const { added, deletedAt, removed } = rangeChanges(changed.patch);
    const lines = { old: [] as number[], new: [] as number[] };
    const inRange: number[] = [];
    const hunks = patchHunks(file.patch);
    // Where the PR's diff already shows a deletion: the base branch's lines.
    const prDeletedAt = new Set(hunks.flat().flatMap((r) => (r.kind === "del" ? [r.new] : [])));
    const rangeRemoved = removed.filter((run) => !prDeletedAt.has(run.at));
    hunks.forEach((hunk, index) => {
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
      // A run removed from inside the hunk's new lines, or just after them.
      const first = hunk.find((r) => r.kind !== "del")?.new ?? 0;
      const last = hunk.findLast((r) => r.kind !== "del")?.new ?? -1;
      if (rangeRemoved.some((run) => run.at >= first && run.at <= last + 1)) touched = true;
      if (touched) inRange.push(index);
    });
    return inRange.length ? [{ ...file, inRange, rangeLines: lines, ...(rangeRemoved.length ? { rangeRemoved } : {}) }] : [];
  });
}

// New lines a diff added, the new lines its deletions sit before, and each
// run of deleted lines with its text.
function rangeChanges(patch: string): { added: Set<number>; deletedAt: Set<number>; removed: { at: number; lines: string[] }[] } {
  const added = new Set<number>();
  const deletedAt = new Set<number>();
  const removed: { at: number; end: number; lines: string[] }[] = [];
  for (const hunk of patchHunks(patch)) {
    for (const row of hunk) {
      if (row.kind === "add") added.add(row.new);
      else if (row.kind === "del") {
        deletedAt.add(row.new);
        const run = removed.at(-1);
        if (run?.at === row.new && run.end === row.old - 1) {
          run.lines.push(row.text);
          run.end = row.old;
        } else removed.push({ at: row.new, end: row.old, lines: [row.text] });
      }
    }
  }
  return { added, deletedAt, removed: removed.map(({ at, lines }) => ({ at, lines })) };
}

// Each hunk's rows. A deleted row's `new` is the new line it sits before.
type PatchRow = { kind: "add" | "del" | "context"; old: number; new: number; text: string };

function patchHunks(patch: string): PatchRow[][] {
  return parseFilePatch(patch).map((hunk) => {
    let next = hunk.newStart;
    return hunk.rows.map((r): PatchRow => {
      if (r.kind === "del") return { kind: "del", old: r.old!, new: next, text: r.text };
      next = r.new! + 1;
      return { kind: r.kind, old: r.old ?? 0, new: r.new!, text: r.text };
    });
  });
}
