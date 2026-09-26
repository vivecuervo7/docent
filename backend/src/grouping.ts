import { claudeCodeAvailable } from "./claudeCode.js";
import { modelName, resolveModel, savedEditorModel } from "./config.js";
import { fetchPrConversation, fetchPrFiles } from "./github.js";
import { canReadCode, chatWithTool } from "./modelProvider.js";
import { inNamedLane } from "./notes.js";
import { conversationText } from "./postReview.js";
import { hunkIndicesByFile, numberedFileDiff } from "./prDiff.js";
import { getRecord, keyFor } from "./store.js";
import type { PrSummary, Slice } from "./types.js";

// The panel's editor: with several reviewers on a PR, the same point is
// often raised more than once, and reviewers seeing only the diff raise
// points the rest of the code disproves. As each slice's reviews come in,
// the editor reads its new findings against its diff, the findings already
// shown and the PR's conversation, and says which make a point already
// made, and which to filter out: trivial, unfounded, settled on the PR, or -
// on Claude Code or Codex, which can look through the repo - disproved by
// the code.

// The editor's model: the one picked in Settings, else Opus where Claude
// Code is present - it's a handful of calls per PR, and the judgement the
// whole review rests on - else Docent's model.
export async function editorModel(): Promise<string> {
  const saved = savedEditorModel();
  if (saved && resolveModel(saved)) return saved;
  return (await claudeCodeAvailable()) ? "claude-code:opus" : modelName();
}

// Docent's read tools the editor looks through the code with.
const EDITOR_TOOLS = ["get_diff", "read_file", "list_files", "search_code"];

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
  // For one kept, what checking it against the code showed.
  checked?: string;
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
              description:
                "Why it's filtered out, in a sentence for someone reading it later: for one the code disproves, the file and line that shows it; for one settled on the PR, the thread. Refer to another finding or a thread by what it says, never by its id. Leave out to keep it.",
            },
            checked: {
              type: "string",
              description:
                "For a finding you keep, what checking it against the code showed, in a sentence with the file and line - or that the code couldn't settle it, and why.",
            },
          },
          required: ["id"],
        },
      },
    },
    required: ["edits"],
  },
};

const BASE_PROMPT = `You're the editor of a code review, in which several reviewers commented \
on the same pull request. The person reviewing the PR decides what's posted; your job is to \
save them reading the same point twice, or a point with nothing behind it.

For each new finding:
- Say which finding it repeats, if any: one already shown, or another new one. It repeats one \
when it makes the same point - the same problem in the same code, or the same concern raised \
about several places - however it's worded, or even if the fix suggested differs. The same kind \
of problem in unrelated code is a point of its own.
- Filter it out if it's trivial or unfounded: nothing in the diff shows the problem it claims; \
it asks for boilerplate with no reason in this code (a try/catch, a timeout, logging, validation \
the types already guarantee); it speculates about code the PR doesn't show; it describes the \
code without raising a problem; or it's about generated code.
- Filter it out if it names no concrete failure - what would break, for whom, and when: a \
"worth considering" about design, a request for a comment or a doc, a preference. Filter it out, \
too, if it objects to a pattern the surrounding code already follows, or a convention the code \
documents.
- Filter it out if the same problem already exists in the same form elsewhere in the codebase and \
the PR doesn't make it worse - it isn't this PR's to fix. Say where it already exists.
Keep anything that names a real failure, even if it's minor or you aren't sure it happens - a \
question worth asking the author is worth keeping.
- Filter it out if the PR's conversation has already raised its point and settled it - answered, \
fixed, or explained. Say which thread, briefly.`;

const LOOK_PROMPT = (pr: string) => `

You can look through the whole repository at the PR's head, not just the diff, with Docent's tools \
(pass ${pr} as the PR): read_file for any file, list_files to see what's there, search_code to find \
where something is defined or used, get_diff for other parts of the PR. Before keeping a finding, \
check its claim against the code: the file it's about, and whatever it depends on beyond the diff - \
the type or column it says is nullable, the caller it says is missing, the check it says doesn't \
exist, the test it says isn't there, how the neighbouring code does the same thing. If the code \
shows the claim is wrong, filter it out as \
disproved, citing the file and line that shows it. If you can't settle it, keep it. For each \
finding you keep, say what checking it showed. Check the claims made, briefly; this isn't a fresh \
review of the PR.`;

export async function editFindings(
  owner: string,
  repo: string,
  number: string,
  args: { slice?: string; fresh: Editable[]; shown: Editable[]; filter: boolean; mcpUrl: string },
  signal: AbortSignal,
): Promise<Map<string, Edit>> {
  const model = await editorModel();
  // Looking through the code is for checking claims, so only when filtering.
  const looks = args.filter && canReadCode(model);
  const conversation = conversationText(await fetchPrConversation(owner, repo, number));
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
        { role: "system", content: BASE_PROMPT + (looks ? LOOK_PROMPT(`${owner}/${repo}#${number}`) : "") },
        {
          role: "user",
          content: [
            about,
            diff && `The diff of this part:\n\n${diff}`,
            `Already said on the PR:\n\n${conversation || "(nothing yet)"}`,
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
      model,
      looks ? { mcpUrl: args.mcpUrl, tools: EDITOR_TOOLS } : undefined,
    );
    const known = new Set([...args.shown, ...args.fresh].map((f) => f.id));
    const asked = new Set(args.fresh.map((f) => f.id));
    const raw = (call.arguments as { edits?: unknown }).edits;
    const out = new Map<string, Edit>();
    for (const e of Array.isArray(raw) ? raw : []) {
      const { id, same_as, filter, checked } = (e ?? {}) as { id?: unknown; same_as?: unknown; filter?: unknown; checked?: unknown };
      if (typeof id !== "string" || !asked.has(id)) continue;
      const edit: Edit = {};
      if (typeof same_as === "string" && same_as !== id && known.has(same_as)) edit.sameAs = same_as;
      // A reviewer who sifted their own findings keeps them all, whatever the model says.
      if (args.filter && typeof filter === "string" && filter.trim()) edit.filtered = filter.trim();
      else if (looks && typeof checked === "string" && checked.trim()) edit.checked = checked.trim();
      out.set(id, edit);
    }
    return out;
  });
}
