import type { ChangeData, HunkData } from "react-diff-view";
import type { LineRef } from "./prDb";

// Showing unchanged lines around a hunk, GitHub-style. Expanded lines are
// added to that hunk's own changes rather than merging hunks, so hunk
// indices - which slices, reviewed state and notes all refer to - never
// change. Expansion stops at the neighbouring hunk even when that hunk isn't
// shown (it may belong to another slice), so changed lines are never shown
// as context.

export const EXPAND_STEP = 20;

export interface Expansion {
  up: number;
  down: number;
}

// First and last old-file lines a hunk covers. A hunk with no old lines
// ("-12,0") is an insertion after line 12, so it covers none; these then
// describe the lines either side of it.
function firstOld(h: HunkData): number {
  return h.oldLines === 0 ? h.oldStart + 1 : h.oldStart;
}

function lastOld(h: HunkData): number {
  return h.oldLines === 0 ? h.oldStart : h.oldStart + h.oldLines - 1;
}

// new line = old line + offset, for unchanged lines above / below a hunk.
function offsetAbove(h: HunkData): number {
  const firstNew = h.newLines === 0 ? h.newStart + 1 : h.newStart;
  return firstNew - firstOld(h);
}

function offsetBelow(h: HunkData): number {
  return offsetAbove(h) + h.newLines - h.oldLines;
}

// Unchanged lines between a hunk and the one before it (or the file's start).
export function gapAbove(hunks: HunkData[], i: number): number {
  const previousLast = i > 0 ? lastOld(hunks[i - 1]) : 0;
  return Math.max(0, firstOld(hunks[i]) - previousLast - 1);
}

// Unchanged lines between a hunk and the one after it (or the file's end).
export function gapBelow(hunks: HunkData[], i: number, totalLines: number): number {
  const nextFirst = i < hunks.length - 1 ? firstOld(hunks[i + 1]) : totalLines + 1;
  return Math.max(0, nextFirst - lastOld(hunks[i]) - 1);
}

export function fileLines(source: string): string[] {
  const lines = source.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function context(oldLine: number, offset: number, lines: string[]): ChangeData {
  return {
    type: "normal",
    isNormal: true,
    oldLineNumber: oldLine,
    newLineNumber: oldLine + offset,
    content: lines[oldLine - 1] ?? "",
  };
}

export function expandHunk(h: HunkData, { up, down }: Expansion, lines: string[]): HunkData {
  if (!up && !down) return h;
  const first = firstOld(h);
  const last = lastOld(h);
  const above = Array.from({ length: up }, (_, k) => context(first - up + k, offsetAbove(h), lines));
  const below = Array.from({ length: down }, (_, k) => context(last + 1 + k, offsetBelow(h), lines));
  return {
    ...h,
    oldStart: first - up,
    newStart: first - up + offsetAbove(h),
    oldLines: h.oldLines + up + down,
    newLines: h.newLines + up + down,
    changes: [...above, ...h.changes, ...below],
  };
}

// How far a hunk has to be expanded to show lines a note is anchored to,
// for notes made on lines that were expanded at the time.
export function expansionFor(h: HunkData, start: LineRef, end: LineRef): Expansion {
  const first = firstOld(h);
  const last = lastOld(h);
  const firstNew = first + offsetAbove(h);
  const lastNew = last + offsetBelow(h);
  // Where a line falls relative to the hunk, as an old-file line when it's
  // outside it. Lines inside the hunk need no expansion.
  const outside = ({ side, line }: LineRef): number | null => {
    if (side === "old") return line < first || line > last ? line : null;
    if (line < firstNew) return line - offsetAbove(h);
    if (line > lastNew) return line - offsetBelow(h);
    return null;
  };
  const from = outside(start);
  const to = outside(end);
  return {
    up: from !== null && from < first ? first - from : 0,
    down: to !== null && to > last ? to - last : 0,
  };
}

// A block of the diff as drawn: one hunk, or neighbouring hunks whose gap has
// been fully expanded, joined the way GitHub joins them - so a selection can
// run across what was the boundary. `index` is the first hunk's.
export interface ShownHunk {
  index: number;
  indices: number[];
  parts: HunkData[];
  hunk: HunkData;
}

function join(a: HunkData, b: HunkData): HunkData {
  return {
    ...a,
    oldLines: b.oldStart + b.oldLines - a.oldStart,
    newLines: b.newStart + b.newLines - a.newStart,
    changes: [...a.changes, ...b.changes],
  };
}

export function shownHunks(hunks: HunkData[], indices: number[], gapClosed: (i: number) => boolean): ShownHunk[] {
  const blocks: ShownHunk[] = [];
  for (const i of [...indices].sort((a, b) => a - b)) {
    const hunk = hunks[i];
    if (!hunk) continue;
    const last = blocks.at(-1);
    if (last && last.indices.at(-1) === i - 1 && gapClosed(i - 1)) {
      last.indices.push(i);
      last.parts.push(hunk);
      last.hunk = join(last.hunk, hunk);
    } else {
      blocks.push({ index: i, indices: [i], parts: [hunk], hunk });
    }
  }
  return blocks;
}
