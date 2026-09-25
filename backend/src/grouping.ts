import { claudeCodeAvailable } from "./claudeCode.js";
import { modelName } from "./config.js";
import { chatWithTool } from "./modelProvider.js";
import { inLane } from "./notes.js";

// Grouping findings that make the same point: with several reviewers on a
// panel, the same issue is often raised more than once. Each new finding is
// checked against the likely matches already there, and joins one when it's
// the same point about the same code, however it's worded.

export interface Comparable {
  id: string;
  location: string;
  body: string;
}

const MATCH_TOOL = {
  name: "report_matches",
  description: "Report which new findings make the same point as an existing one.",
  parameters: {
    type: "object",
    properties: {
      matches: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "A new finding's id." },
            same_as: { type: "string", description: "The existing finding's id it duplicates. Leave out when it's a point of its own." },
          },
          required: ["id"],
        },
      },
    },
    required: ["matches"],
  },
};

const SYSTEM_PROMPT = `You're tidying a code review in which several reviewers commented on the same \\
pull request. For each new finding, decide whether it makes the same point as one of the existing \\
findings: the same problem, about the same code, even if it's worded differently or suggests a \\
slightly different fix. Findings about related but distinct problems - or the same kind of problem \\
in a different place - are separate points. When in doubt, it's a point of its own.`;

// A small, quick model is enough to tell whether two findings match.
async function matchingModel(): Promise<string> {
  return (await claudeCodeAvailable()) ? "claude-code:haiku" : modelName();
}

export function matchFindings(fresh: Comparable[], existing: Comparable[], signal: AbortSignal): Promise<Map<string, string>> {
  return inLane(async () => {
    signal.throwIfAborted();
    const list = (items: Comparable[]) => items.map((f) => `[${f.id}] ${f.location}\\n${f.body}`).join("\\n\\n");
    const call = await chatWithTool(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Existing findings:\\n\\n${list(existing)}\\n\\nNew findings:\\n\\n${list(fresh)}` },
      ],
      MATCH_TOOL,
      signal,
      await matchingModel(),
    );
    const known = new Set(existing.map((f) => f.id));
    const asked = new Set(fresh.map((f) => f.id));
    const raw = (call.arguments as { matches?: unknown }).matches;
    const out = new Map<string, string>();
    for (const m of Array.isArray(raw) ? raw : []) {
      const { id, same_as } = (m ?? {}) as { id?: unknown; same_as?: unknown };
      if (typeof id === "string" && asked.has(id) && typeof same_as === "string" && known.has(same_as)) out.set(id, same_as);
    }
    return out;
  });
}
