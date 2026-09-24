import type { PrFile } from "./github.js";
import { chatWithTool } from "./modelProvider.js";
import { inLane } from "./notes.js";
import { linesInDiff, numberedFileDiff } from "./prDiff.js";
import type { FileNote, Slice } from "./types.js";

// Notes on individual files within a slice, where a file needs more than the
// slice's summary: what a test file actually tests, or what a large change
// amounts to. A pass of its own after slicing, one call per slice, so it
// can't change the slices themselves.

const REPORT_FILE_NOTES_TOOL = {
  name: "report_file_notes",
  description: "Report notes on the files in this slice that need one.",
  parameters: {
    type: "object",
    properties: {
      notes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            kind: { type: "string", enum: ["tests", "context"] },
            note: { type: "string", description: "One or two sentences of plain prose: a verdict, not a list." },
            folds: {
              type: "array",
              description: "Parts of this file's diff that are safe to skim once summarised.",
              items: {
                type: "object",
                properties: {
                  start_line: { type: "integer", description: "First new-file line, as numbered in the diff." },
                  end_line: { type: "integer", description: "Last new-file line, as numbered in the diff." },
                  summary: { type: "string", description: "One sentence: what the folded code does." },
                },
                required: ["summary"],
              },
            },
          },
          required: ["path", "kind", "note"],
        },
      },
    },
    required: ["notes"],
  },
};

const SYSTEM_PROMPT = `You are helping someone review one slice of a pull request - a coherent part of \
it, already summarised. Decide which of its files deserve a note of their own, to spare the reviewer \
reading them line by line or to tell them what to look for. Most files don't: skip small or obvious \
changes, and never restate the slice's summary.
Each note is one or two sentences of plain prose - a verdict, with no headings or lists:
- tests: for a test file. Whether the tests cover the change well, and whether they're \
well-formed (clear assertions, realistic setups, names that match what they test), or what's off.
- context: for a large or intricate change in a non-test file. What the change amounts to, and \
what's worth checking.
A note can also fold parts of the file's diff that are safe to skim once summarised, so the \
reviewer reads the summary in their place:
- In a test file, fold each describe block (or a run of related it blocks) whose scenarios you can \
name; the summary lists them, e.g. "Checks each PA-429 entity syncs through its filter input type, \
and that paged wrappers are exempt." Leave unfolded only test code that's surprising or suspect.
- Fold a long mechanical run: a list of similar entries, or the same edit repeated.
- Fold a file that's deleted outright or generated, as a whole: leave the lines out.
Each fold gives start_line and end_line as new-file line numbers from the diff (both inside the \
block), and a one-sentence summary of what the folded code does. Never fold logic the reviewer \
should read.
Only note files that are in this slice, using their paths exactly as shown. Report no notes if \
none are needed.`;

function hunkIndicesByFile(slice: Slice): Map<string, number[]> {
  const byFile = new Map<string, number[]>();
  for (const ref of slice.hunks) {
    const at = ref.lastIndexOf("#");
    const path = ref.slice(0, at);
    byFile.set(path, [...(byFile.get(path) ?? []), Number(ref.slice(at + 1))]);
  }
  return byFile;
}

async function notesForSlice(files: PrFile[], slice: Slice, signal?: AbortSignal): Promise<FileNote[]> {
  const byFile = hunkIndicesByFile(slice);
  const diff = [...byFile]
    .map(([path, indices]) => {
      const file = files.find((f) => f.filename === path);
      return file ? numberedFileDiff(file, indices) : "";
    })
    .filter(Boolean)
    .join("\n\n");
  if (!diff) return [];

  const call = await inLane(() => {
    signal?.throwIfAborted();
    return chatWithTool(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Slice: ${slice.title}\n${slice.summary}\n\n${diff}` },
      ],
      REPORT_FILE_NOTES_TOOL,
      signal,
    );
  });

  const raw = (call.arguments as { notes?: unknown }).notes;
  return (Array.isArray(raw) ? raw : []).flatMap((entry): FileNote[] => {
    const { path, kind, note, folds } = (entry ?? {}) as Record<string, unknown>;
    // Only files in this slice, and one note per file.
    if (typeof path !== "string" || !byFile.has(path) || typeof note !== "string" || !note.trim()) return [];
    if (kind !== "tests" && kind !== "context") return [];
    const file = files.find((f) => f.filename === path);
    const checked = file ? checkFolds(folds, linesInDiff(file)) : [];
    return [{ path, kind, note: note.trim(), ...(checked.length ? { folds: checked } : {}) }];
  })
    .filter((n, i, all) => all.findIndex((m) => m.path === n.path) === i);
}

// Folds whose lines are in the diff, in order and not overlapping; a fold
// with no lines covers the whole file, so it stands alone.
function checkFolds(raw: unknown, inDiff: Set<number>): NonNullable<FileNote["folds"]> {
  const folds: NonNullable<FileNote["folds"]> = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const { start_line, end_line, summary } = (entry ?? {}) as Record<string, unknown>;
    if (typeof summary !== "string" || !summary.trim()) continue;
    if (start_line === undefined && end_line === undefined) return [{ summary: summary.trim() }];
    if (typeof start_line !== "number" || typeof end_line !== "number") continue;
    const [startLine, endLine] = start_line <= end_line ? [start_line, end_line] : [end_line, start_line];
    if (!inDiff.has(startLine) || !inDiff.has(endLine)) continue;
    folds.push({ startLine, endLine, summary: summary.trim() });
  }
  folds.sort((a, b) => a.startLine! - b.startLine!);
  return folds.filter((f, i) => i === 0 || f.startLine! > folds[i - 1].endLine!);
}

// Notes for every slice, by slice id. Slices are done side by side, as many
// at once as the model allows.
export async function generateFileNotes(
  files: PrFile[],
  slices: Slice[],
  signal?: AbortSignal,
): Promise<Record<string, FileNote[]>> {
  const entries = await Promise.all(
    slices.map(async (slice) => [slice.id, await notesForSlice(files, slice, signal)] as const),
  );
  return Object.fromEntries(entries.filter(([, notes]) => notes.length > 0));
}
