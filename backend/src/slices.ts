import { chatWithTool } from "./modelProvider.js";
import type { PrFile } from "./github.js";
import type { Slice } from "./types.js";

// Splits a unified-diff patch into its hunks purely by the "@@ ... @@"
// header lines, matching how the web app's diff parser splits hunks, so the
// indices assigned here line up with its own.
export function splitPatchIntoHunks(patch: string): string[] {
  const lines = patch.split("\n");
  const hunks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith("@@ ")) {
      if (current.length) hunks.push(current.join("\n"));
      current = [line];
    } else if (current.length) {
      current.push(line);
    }
  }
  if (current.length) hunks.push(current.join("\n"));

  return hunks;
}

function buildHunkRefs(files: PrFile[]): Map<string, string> {
  const refs = new Map<string, string>();
  for (const file of files) {
    if (!file.patch) continue;
    splitPatchIntoHunks(file.patch).forEach((hunkText, i) => {
      refs.set(`${file.filename}#${i}`, hunkText);
    });
  }
  return refs;
}

// Hints for the model about what a file is, from its name alone. Only
// unambiguous names count, so a hint is never wrong; the model decides what
// to do with it.
const TEST_FILE_RE = /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[a-z0-9]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/i;
const GENERATED_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "Cargo.lock",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "Gemfile.lock",
  "composer.lock",
  "go.sum",
  "packages.lock.json",
]);

function fileHint(path: string): string {
  const name = path.split("/").pop() ?? path;
  if (GENERATED_FILES.has(name)) return " (generated: lockfile)";
  if (TEST_FILE_RE.test(path)) return " (test file)";
  return "";
}

function buildPrompt(refs: Map<string, string>): string {
  return [...refs.entries()]
    .map(([ref, text]) => `### ${ref}${fileHint(ref.slice(0, ref.lastIndexOf("#")))}\n${text}`)
    .join("\n\n");
}

const REPORT_SLICES_TOOL = {
  name: "report_slices",
  description: "Report the pull request broken into small, reviewable slices.",
  parameters: {
    type: "object",
    properties: {
      slices: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            hunks: { type: "array", items: { type: "string" } },
          },
          required: ["title", "hunks"],
        },
      },
    },
    required: ["slices"],
  },
};

const SYSTEM_PROMPT = `You are reviewing a pull request. Below are the changed hunks, each labeled with a \
stable reference like "src/foo.ts#0". Break the diff into easily-reviewable "slices": each one a \
single coherent change a reviewer can check in one sitting, smaller than a whole feature (e.g. \
"refactor to use a constant", "clean up indentation on these parameters"). Keep one change \
together rather than splitting it across slices, and don't make a slice out of a trivial hunk \
that belongs with its neighbours.
Group whatever hunks are needed to understand one slice, even across files, and even if a hunk \
is only shown for context - the same hunk reference may legitimately appear under more than one \
slice. Not every hunk needs to belong to a slice; leave out hunks that don't fit anywhere.
- Tests belong in the same slice as the code they test, so the reviewer sees the change and its \
tests together. Give tests a slice of their own only when they stand alone, such as a new test \
helper or tests for code this PR doesn't change.
- Generated files, such as lockfiles, get a slice of their own - unless they belong with a \
specific change, like a migration's generated snapshot next to the migration.
Headings marked "(test file)" or "(generated: lockfile)" are hints about what a file is.
For each slice, give a short title, a 1-2 sentence summary of what changed and why it matters \
for review, and the exact hunk references (format "path#index") it covers. Call report_slices \
with the result.`;

export async function generateSlices(files: PrFile[], signal?: AbortSignal): Promise<Slice[]> {
  const refs = buildHunkRefs(files);
  if (refs.size === 0) return [];

  const result = await chatWithTool(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildPrompt(refs) },
    ],
    REPORT_SLICES_TOOL,
    signal,
  );

  const raw = result.arguments as { slices?: unknown };
  if (!Array.isArray(raw.slices)) return [];

  const slices: Slice[] = [];
  raw.slices.forEach((entry, i) => {
    if (typeof entry !== "object" || entry === null) return;
    const { title, summary, hunks } = entry as Record<string, unknown>;
    if (typeof title !== "string" || !Array.isArray(hunks)) return;

    const validHunks = hunks.filter((h): h is string => typeof h === "string" && refs.has(h));
    if (validHunks.length === 0) return;

    slices.push({
      id: `slice-${i}`,
      title,
      summary: typeof summary === "string" && summary.trim() ? summary.trim() : "",
      hunks: validHunks,
    });
  });

  return slices;
}
