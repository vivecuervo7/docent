import { getChangeKey, isDelete, isInsert, isNormal, type ChangeData, type HunkData } from "react-diff-view";
import type { LineRef } from "./prDb";

// Mapping between diff changes and the lines a note is anchored to.

export const PIN_SIZE = 26;

export function lineRefFor(change: ChangeData): LineRef {
  if (isDelete(change)) return { side: "old", line: change.lineNumber };
  if (isInsert(change)) return { side: "new", line: change.lineNumber };
  return { side: "new", line: change.newLineNumber };
}

function matches(change: ChangeData, ref: LineRef): boolean {
  if (isNormal(change)) {
    return ref.side === "old" ? change.oldLineNumber === ref.line : change.newLineNumber === ref.line;
  }
  return (ref.side === "old") === isDelete(change) && change.lineNumber === ref.line;
}

// The changes a note covers, found by line number so the anchor survives
// the diff being re-parsed (e.g. toggling Hide whitespace).
export function changesBetween(hunk: HunkData, start: LineRef, end: LineRef): ChangeData[] {
  const from = hunk.changes.findIndex((c) => matches(c, start));
  const to = hunk.changes.findIndex((c) => matches(c, end));
  if (from < 0 || to < from) return [];
  return hunk.changes.slice(from, to + 1);
}

export function changeKeys(changes: ChangeData[]): string[] {
  return changes.map(getChangeKey);
}

export function diffLines(changes: ChangeData[]): string {
  return changes
    .map((c) => `${isInsert(c) ? "+" : isDelete(c) ? "-" : " "}${c.content}`)
    .join("\n");
}

export function describeLines(start: LineRef, end: LineRef): string {
  return start.line === end.line ? `line ${start.line}`
    : `lines ${start.line}–${end.line}`;
}
