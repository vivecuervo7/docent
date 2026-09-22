import { chatWithTool } from "./modelProvider.js";
import type { PrFile } from "./github.js";
import type { Idea, Scrutiny } from "./ideaStore.js";

const SCRUTINY_VALUES: Scrutiny[] = ["skim", "read", "careful"];

// Splits a unified-diff patch into its hunks purely by the "@@ ... @@"
// header lines, matching how react-diff-view/gitdiff-parser splits hunks
// client-side, so the indices assigned here line up with the frontend's.
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

function buildPrompt(refs: Map<string, string>): string {
  return [...refs.entries()]
    .map(([ref, text]) => `### ${ref}\n${text}`)
    .join("\n\n");
}

const REPORT_IDEAS_TOOL = {
  name: "report_ideas",
  description: "Report the pull request broken into small, reviewable ideas.",
  parameters: {
    type: "object",
    properties: {
      ideas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            hunks: { type: "array", items: { type: "string" } },
            scrutiny: { type: "string", enum: SCRUTINY_VALUES },
            attention: { type: "string" },
            tested: { type: "string" },
            untested: { type: "string" },
          },
          required: ["title", "hunks"],
        },
      },
    },
    required: ["ideas"],
  },
};

const SYSTEM_PROMPT = `You are reviewing a pull request. Below are the changed hunks, each labeled with a \
stable reference like "src/foo.ts#0". Break the diff into small, granular, easily-reviewable \
"ideas" - smaller than a whole feature (e.g. "refactor to use a constant", "clean up indentation \
on these parameters"). Group whatever hunks are needed to understand one idea, even across \
files, and even if a hunk is only shown for context - the same hunk reference may legitimately \
appear under more than one idea. Not every hunk needs to belong to an idea; leave out hunks that \
don't fit anywhere. For each idea, give:
- title: a short title.
- summary: 1-2 sentences on what changed and why it matters for review.
- hunks: the exact hunk references (format "path#index") it covers.
- scrutiny: "skim" for mechanical/safe changes (renames, removing dead code, formatting), "read" \
for a normal change worth reading through, or "careful" for something a reviewer should stop and \
think about (behavior change, tricky logic, something easy to get subtly wrong).
- attention: only something that can't be verified from these hunks alone and needs a human \
judgment call (e.g. a behavior change with no accompanying test, an edge case not obviously \
handled, a naming or API choice worth confirming) - empty string if nothing like that applies. \
Don't restate the summary or invent generic risk language.
- tested: what test coverage, if any, accompanies this idea - empty string if not applicable.
- untested: what this idea changes that isn't covered by the tests shown - empty string if \
nothing notable or not applicable.
Call report_ideas with the result.`;

export async function generateIdeas(files: PrFile[]): Promise<Idea[]> {
  const refs = buildHunkRefs(files);
  if (refs.size === 0) return [];

  const result = await chatWithTool(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildPrompt(refs) },
    ],
    REPORT_IDEAS_TOOL,
  );

  const raw = result.arguments as { ideas?: unknown };
  if (!Array.isArray(raw.ideas)) return [];

  // Only title/hunks are load-bearing; the rest are best-effort judgment
  // fields the model sometimes drops under schema pressure - defaulting
  // them rather than discarding the whole (correctly-grouped) idea.
  const ideas: Idea[] = [];
  raw.ideas.forEach((entry, i) => {
    if (typeof entry !== "object" || entry === null) return;
    const { title, summary, hunks, scrutiny, attention, tested, untested } = entry as Record<
      string,
      unknown
    >;
    if (typeof title !== "string" || !Array.isArray(hunks)) return;

    const validHunks = hunks.filter((h): h is string => typeof h === "string" && refs.has(h));
    if (validHunks.length === 0) return;

    const nonEmpty = (v: unknown): string | undefined =>
      typeof v === "string" && v.trim() ? v.trim() : undefined;

    ideas.push({
      id: `idea-${i}`,
      title,
      summary: nonEmpty(summary) ?? "",
      hunks: validHunks,
      scrutiny: SCRUTINY_VALUES.includes(scrutiny as Scrutiny) ? (scrutiny as Scrutiny) : "read",
      attention: nonEmpty(attention),
      tested: nonEmpty(tested),
      untested: nonEmpty(untested),
    });
  });

  return ideas;
}
