import { personas } from "../storage/settings.server.js";
import { fetchPrFiles } from "./github.js";
import { chatWithTool } from "./modelProvider.js";
import { inLane } from "./notes.js";
import { getRecord, keyFor } from "../storage/store.server.js";
import type { PrSummary, Slice } from "./types.js";

// "Auto" on the panel: which of the reviewer's personas this PR warrants.
// A persona earns a place when its area is a real part of the change, not
// when one line brushes against it; general always runs anyway.

const PICK_TOOL = {
  name: "report_picks",
  description: "Report which personas this pull request warrants.",
  parameters: {
    type: "object",
    properties: {
      picks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            persona: { type: "string", description: "The persona's id." },
            reason: { type: "string", description: "Why this PR warrants it, in a short sentence naming what in the PR." },
          },
          required: ["persona", "reason"],
        },
      },
    },
    required: ["picks"],
  },
};

const PROMPT = `You're choosing which specialist reviewers a pull request warrants. A general \
reviewer always reviews it; pick a specialist only when its area is a substantial part of this \
change - several files, the change's main purpose, or a risk the change plainly creates - not \
when one line brushes against it. One log line doesn't warrant an operations reviewer, and one \
nullable column doesn't warrant a data reviewer. When the PR adds or changes tests, or changes \
behaviour that has tests, a reviewer of test quality is warranted. Pick at most three, the most \
warranted first. Picking none is fine.`;

export interface Pick {
  persona: string;
  reason: string;
}

export async function pickPersonas(owner: string, repo: string, number: string, model: string | undefined, exclude: string[]): Promise<Pick[]> {
  const candidates = personas.list().filter((p) => !exclude.includes(p.id));
  if (!candidates.length) return [];
  const record = getRecord(keyFor(owner, repo, number)).record as { title?: string; summary?: PrSummary | null; slices?: Slice[] | null };
  const files = await fetchPrFiles(owner, repo, number);
  const about = [
    record.title && `PR: ${record.title}`,
    record.summary && `What it does: ${record.summary.what}\nWhy: ${record.summary.why}`,
    record.slices?.length && `Its parts:\n${record.slices.map((s) => `- ${s.title}: ${s.summary}`).join("\n")}`,
    `The files it changes:\n${files.map((f) => `${f.filename} (+${f.additions} -${f.deletions})`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const list = candidates.map((p) => `[${p.id}] ${p.name}: ${p.instructions}`).join("\n\n");
  const call = await inLane(
    () =>
      chatWithTool(
        [
          { role: "system", content: PROMPT },
          { role: "user", content: `${about}\n\nThe specialists to choose from:\n\n${list}` },
        ],
        PICK_TOOL,
        undefined,
        model,
      ),
    model,
  );
  const raw = (call.arguments as { picks?: unknown }).picks;
  const known = new Set(candidates.map((p) => p.id));
  const seen = new Set<string>();
  return (Array.isArray(raw) ? raw : [])
    .flatMap((p) => {
      const { persona, reason } = (p ?? {}) as { persona?: unknown; reason?: unknown };
      if (typeof persona !== "string" || !known.has(persona) || seen.has(persona)) return [];
      seen.add(persona);
      return [{ persona, reason: typeof reason === "string" ? reason.trim() : "" }];
    })
    .slice(0, 3);
}
