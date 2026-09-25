import { modelName } from "./config.js";
import { fetchPrFiles } from "./github.js";
import { chatWithTool } from "./modelProvider.js";
import { inNamedLane } from "./notes.js";
import { hunkIndicesByFile, numberedFileDiff } from "./prDiff.js";
import { getRecord, keyFor } from "./store.js";
import type { PrSummary, Slice } from "./types.js";

// The panel's editor: with several reviewers on a PR, the same point is
// often raised more than once, and a small model raises points that don't
// hold up. As each slice's reviews come in, the editor reads its new
// findings against its diff and the findings already shown, and says which
// make a point already made, and which are too trivial or unfounded to show.

export interface Editable {
  id: string;
  who: string;
  location: string;
  body: string;
  rationale?: string;
}

export interface Edit {
  sameAs?: string;
  filtered?: string;
}

const EDIT_TOOL = {
  name: "report_edits",
  description: "Report, for each new finding, whether it repeats another and whether it should be filtered out.",
  parameters: {
    type: "object",
    properties: {
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "A new finding's id." },
            same_as: {
              type: "string",
              description: "The id of the finding - shown or new - making the same point. Leave out when it's a point of its own.",
            },
            filter: {
              type: "string",
              description: "Why it's filtered out, in a few words. Leave out to keep it.",
            },
          },
          required: ["id"],
        },
      },
    },
    required: ["edits"],
  },
};

const SYSTEM_PROMPT = `You're the editor of a code review, in which several reviewers commented \\
on the same pull request. The person reviewing the PR decides what's posted; your job is to \\
save them reading the same point twice, or a point with nothing behind it.

For each new finding:
- Say which finding it repeats, if any: one already shown, or another new one. It repeats one \\
when it makes the same point - the same problem in the same code, or the same concern raised \\
about several places - however it's worded, or even if the fix suggested differs. The same kind \\
of problem in unrelated code is a point of its own.
- Filter it out if it's trivial or unfounded: nothing in the diff shows the problem it claims; \\
it asks for boilerplate with no reason in this code (a try/catch, a timeout, logging, validation \\
the types already guarantee); it speculates about code the PR doesn't show; it describes the \\
code without raising a problem; or it's about generated code. Keep anything plausible, even if \\
minor or uncertain - a question worth asking the author is worth keeping. When in doubt, keep it.`;

export async function editFindings(
  owner: string,
  repo: string,
  number: string,
  args: { slice?: string; fresh: Editable[]; shown: Editable[]; filter: boolean; model?: string },
  signal: AbortSignal,
): Promise<Map<string, Edit>> {
  const record = getRecord(keyFor(owner, repo, number)).record as { summary?: PrSummary | null; slices?: Slice[] | null; title?: string };
  const slice = args.slice ? record.slices?.find((s) => s.id === args.slice) : undefined;
  const files = slice ? await fetchPrFiles(owner, repo, number) : [];
  const diff = slice
    ? [...hunkIndicesByFile(slice)]
        .map(([path, indices]) => {
          const file = files.find((f) => f.filename === path);
          return file ? numberedFileDiff(file, indices) : "";
        })
        .filter(Boolean)
        .join("\n\n")
    : "";
  const list = (items: Editable[], withWhy: boolean) =>
    items
      .map((f) => `[${f.id}] ${f.who}, on ${f.location}\n${f.body}${withWhy && f.rationale ? `\nReviewer's rationale: ${f.rationale}` : ""}`)
      .join("\n\n");
  const about = [
    record.title && `PR: ${record.title}`,
    record.summary && `What it does: ${record.summary.what}\nWhy: ${record.summary.why}`,
    slice && `This part: ${slice.title}\n${slice.summary}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const task = args.filter
    ? "For each new finding, say which finding it repeats, if any, and whether to filter it out."
    : "These new findings come from a reviewer who has already sifted their own, so keep them all; only say which finding each repeats, if any.";

  return inNamedLane("grouping", 2, async () => {
    signal.throwIfAborted();
    const call = await chatWithTool(
      [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            about,
            diff && `The diff of this part:\n\n${diff}`,
            `Findings already shown:\n\n${list(args.shown, false) || "(none)"}`,
            `New findings:\n\n${list(args.fresh, true)}`,
            task,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
      EDIT_TOOL,
      signal,
      args.model || modelName(),
    );
    const known = new Set([...args.shown, ...args.fresh].map((f) => f.id));
    const asked = new Set(args.fresh.map((f) => f.id));
    const raw = (call.arguments as { edits?: unknown }).edits;
    const out = new Map<string, Edit>();
    for (const e of Array.isArray(raw) ? raw : []) {
      const { id, same_as, filter } = (e ?? {}) as { id?: unknown; same_as?: unknown; filter?: unknown };
      if (typeof id !== "string" || !asked.has(id)) continue;
      const edit: Edit = {};
      if (typeof same_as === "string" && same_as !== id && known.has(same_as)) edit.sameAs = same_as;
      // A reviewer who sifted their own findings keeps them all, whatever the model says.
      if (args.filter && typeof filter === "string" && filter.trim()) edit.filtered = filter.trim();
      out.set(id, edit);
    }
    return out;
  });
}
