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
  description: "Report notes on the files in this slice that need one, and the quiet parts of each file.",
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
            note: {
              type: "string",
              description: "One or two sentences of plain prose: a verdict, not a list. Empty for a file that only has quiet_ranges.",
            },
            scenario_lines: {
              type: "array",
              items: { type: "integer" },
              description: "For tests only: new-file line numbers of the lines that name a test or a group of tests.",
            },
            quiet_ranges: {
              type: "array",
              description: "Imports and test setup: code the reviewer would only skim.",
              items: {
                type: "object",
                properties: {
                  kind: { type: "string", enum: ["imports", "setup"] },
                  start_line: { type: "integer" },
                  end_line: { type: "integer" },
                },
                required: ["kind", "start_line", "end_line"],
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
For a test file, also give scenario_lines: the new-file line numbers, as numbered in the diff, of \
every line that names a test or a group of tests - whatever this file's framework uses, e.g. \
describe/it/test calls, def test_ functions, func TestX or t.Run, [Fact] or [Test] methods, \
RSpec's describe/context/it. The reviewer then reads those lines with the code between them \
folded, so include every one, and nothing else.
For any file in this slice, also give quiet_ranges for code the reviewer would only skim, shown \
folded with a count of what changed inside:
- imports: a file's block of imports, using directives, includes or requires, in whatever \
language it's in.
- setup: in a test file, the setup before its first test - mocks, fixtures, helpers - but not \
the tests themselves.
Each range is start_line and end_line, new-file line numbers from the diff covering the whole \
block. A file that only has quiet ranges gets an entry with an empty note.
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
    const { path, kind, note, scenario_lines, quiet_ranges } = (entry ?? {}) as Record<string, unknown>;
    // Only files in this slice, and one note per file.
    if (typeof path !== "string" || !byFile.has(path) || typeof note !== "string") return [];
    if (kind !== "tests" && kind !== "context") return [];
    const file = files.find((f) => f.filename === path);
    const inDiff = file ? linesInDiff(file) : new Set<number>();
    const scenarios = kind === "tests" ? checkLines(scenario_lines, inDiff) : [];
    const quiet = checkRanges(quiet_ranges, inDiff);
    if (!note.trim() && !quiet.length) return [];
    return [
      {
        path,
        kind,
        note: note.trim(),
        ...(scenarios.length ? { scenarioLines: scenarios } : {}),
        ...(quiet.length ? { quietRanges: quiet } : {}),
      },
    ];
  })
    .filter((n, i, all) => all.findIndex((m) => m.path === n.path) === i);
}

// Ranges whose ends are in the diff, in order and not overlapping.
function checkRanges(raw: unknown, inDiff: Set<number>): NonNullable<FileNote["quietRanges"]> {
  const ranges: NonNullable<FileNote["quietRanges"]> = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const { kind, start_line, end_line } = (entry ?? {}) as Record<string, unknown>;
    if ((kind !== "imports" && kind !== "setup") || typeof start_line !== "number" || typeof end_line !== "number") continue;
    const [startLine, endLine] = start_line <= end_line ? [start_line, end_line] : [end_line, start_line];
    if (inDiff.has(startLine) && inDiff.has(endLine)) ranges.push({ kind, startLine, endLine });
  }
  ranges.sort((a, b) => a.startLine - b.startLine);
  return ranges.filter((r, i) => i === 0 || r.startLine > ranges[i - 1].endLine);
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
