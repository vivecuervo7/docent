import type { PrFile } from "./github.js";
import { splitPatchIntoHunks } from "./slices.js";

// Diffs as reviewers read them: each line numbered by where it sits in the
// new file, so a finding can say exactly which lines it's about. Deleted
// lines have no new-file number.

export function numberedHunk(hunk: string): string {
  const [header, ...lines] = hunk.split("\n");
  const match = header.match(/\+(\d+)/);
  let next = match ? Number(match[1]) : 1;
  const out = [header];
  for (const line of lines) {
    if (line.startsWith("-")) {
      out.push(`      ${line}`);
    } else if (line.startsWith("\\")) {
      out.push(`      ${line}`);
    } else {
      out.push(`${String(next).padStart(5)} ${line || " "}`);
      next++;
    }
  }
  return out.join("\n");
}

export function numberedFileDiff(file: PrFile, hunkIndices?: number[]): string {
  if (!file.patch) return `${file.filename} (${file.status}, no text diff)`;
  const hunks = splitPatchIntoHunks(file.patch);
  const shown = hunkIndices ? hunkIndices.map((i) => hunks[i]).filter(Boolean) : hunks;
  return `${file.filename} (${file.status})\n${shown.map(numberedHunk).join("\n")}`;
}

// New-file lines that appear in a file's diff (added or unchanged context):
// the only lines a GitHub review comment can sit on.
export function linesInDiff(file: PrFile): Set<number> {
  const lines = new Set<number>();
  if (!file.patch) return lines;
  for (const hunk of splitPatchIntoHunks(file.patch)) {
    const [header, ...rest] = hunk.split("\n");
    const match = header.match(/\+(\d+)/);
    let next = match ? Number(match[1]) : 1;
    for (const line of rest) {
      if (line.startsWith("-") || line.startsWith("\\")) continue;
      lines.add(next++);
    }
  }
  return lines;
}

// Ranges of lines, for telling a reviewer which lines are commentable.
export function describeRanges(lines: Set<number>): string {
  const sorted = [...lines].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const n of sorted.slice(1).concat(Number.NaN)) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    if (start !== undefined) ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = n;
    prev = n;
  }
  return ranges.join(", ");
}
