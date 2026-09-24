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
            scenario_lines: {
              type: "array",
              items: { type: "integer" },
              description: "For tests only: new-file line numbers of the lines that name a test or a group of tests.",
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
For a test file, also give scenario_lines: the new-file line numbers, as numbered in the diff, of \
every line that names a test or a group of tests - whatever this file's framework uses, e.g. \
describe/it/test calls, def test_ functions, func TestX or t.Run, [Fact] or [Test] methods, \
RSpec's describe/context/it. The reviewer then reads those lines with the code between them \
folded, so include every one, and nothing else.
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
    const { path, kind, note, scenario_lines } = (entry ?? {}) as Record<string, unknown>;
    // Only files in this slice, and one note per file.
    if (typeof path !== "string" || !byFile.has(path) || typeof note !== "string" || !note.trim()) return [];
    if (kind !== "tests" && kind !== "context") return [];
    const file = files.find((f) => f.filename === path);
    const scenarios = kind === "tests" && file ? checkLines(scenario_lines, linesInDiff(file)) : [];
    return [{ path, kind, note: note.trim(), ...(scenarios.length ? { scenarioLines: scenarios } : {}) }];
  })
    .filter((n, i, all) => all.findIndex((m) => m.path === n.path) === i);
}

// Line numbers that are in the diff, in order, once each.
function checkLines(raw: unknown, inDiff: Set<number>): number[] {
  const lines = (Array.isArray(raw) ? raw : []).filter((n): n is number => typeof n === "number" && inDiff.has(n));
  return [...new Set(lines)].sort((a, b) => a - b);
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
