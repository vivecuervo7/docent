import { fetchPrFiles } from "../github/github.server.js";
import { editorModel } from "./grouping.js";
import { canReadCode, chatWithTool } from "../models/modelProvider.server.js";
import { inLane } from "../features/reading/threadReplies.server.js";
import { numberedFileDiff } from "../github/prDiff.server.js";
import { prHead } from "../github/repoCache.server.js";
import { persistent } from "../storage/persistent.server.js";

// What the code around a PR shows, looked up once and shared by every one of
// Docent's reviewers. They review from the diff alone, and guess at what it
// leans on - whether a column can be null, what a base class already does,
// what's already tested - so one model with Docent's read tools looks those
// things up first, and every part review starts from its facts. Runs on the
// editor's model, and only where that can use the tools.

const CONTEXT_TOOLS = ["get_diff", "read_file", "list_files", "search_code"];

const REPORT_CONTEXT_TOOL = {
  name: "report_context",
  description: "Report what the code around the pull request shows.",
  parameters: {
    type: "object",
    properties: {
      facts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            fact: { type: "string", description: "What's true, in a sentence." },
            where: { type: "string", description: "The file and line that shows it." },
          },
          required: ["fact", "where"],
        },
      },
    },
    required: ["facts"],
  },
};

const PROMPT = (pr: string) => `Reviewers are about to review a pull request from its diff alone. \
Before they do, look up what the changed code depends on beyond the diff, so they work from facts \
rather than guesses: whether the columns and fields it reads can be null; what the base classes, \
wrappers and helpers it calls already do (defaults, ordering, validation, error handling); how \
the neighbouring code does the same kind of thing, and conventions it documents; what tests \
already cover; who calls what it changes, and what those callers expect.

Use Docent's tools, passing ${pr} as the PR: read_file for any file at the PR's head, list_files \
to see what's there, search_code to find where something is defined or used, get_diff for the \
PR's changes. Report up to 25 facts that a reviewer would otherwise guess at, each with the file \
and line that shows it. Report what's true, not whether the PR is right - this isn't a review.`;

// A lookup, as the panel shows it: the looks taken so far, then the facts.
export interface Lookup {
  status: "running" | "done" | "failed";
  steps: string[];
  facts: { fact: string; where: string }[];
  startedAt: number;
  endedAt?: number;
}

const passes = persistent("code-context.passes", () => new Map<string, Promise<string>>());
// The latest lookup for each PR, by owner/repo#number.
const latest = persistent("code-context.latest", () => new Map<string, Lookup>());

export function getLookup(owner: string, repo: string, number: string): Lookup | null {
  return latest.get(`${owner}/${repo}#${number}`) ?? null;
}

// The facts, as a block for the reviewers' prompt; empty when the editor's
// model can't look, or the lookup failed.
export async function codeContext(owner: string, repo: string, number: string, mcpUrl: string): Promise<string> {
  try {
    const model = await editorModel();
    if (!canReadCode(model)) return "";
    const key = `${owner}/${repo}#${number}@${await prHead(owner, repo, number)}`;
    let pass = passes.get(key);
    if (!pass) {
      const lookup: Lookup = { status: "running", steps: [], facts: [], startedAt: Date.now() };
      latest.set(`${owner}/${repo}#${number}`, lookup);
      pass = lookUp(owner, repo, number, model, mcpUrl, lookup).then(
        (facts) => {
          lookup.status = "done";
          lookup.endedAt = Date.now();
          return facts;
        },
        (err) => {
          lookup.status = "failed";
          lookup.endedAt = Date.now();
          throw err;
        },
      );
      passes.set(key, pass);
      // A failed lookup is tried again by the next review.
      pass.catch(() => passes.delete(key));
    }
    return await pass;
  } catch {
    // Reviews go ahead without it.
    return "";
  }
}

async function lookUp(owner: string, repo: string, number: string, model: string, mcpUrl: string, lookup: Lookup): Promise<string> {
  const files = await fetchPrFiles(owner, repo, number);
  const diff = files.map((f) => numberedFileDiff(f)).join("\n\n");
  const shown = diff.length <= 120_000 ? `The diff:\n\n${diff}` : `The files it changes (read their diffs with get_diff):\n${files.map((f) => f.filename).join("\n")}`;
  const call = await inLane(
    () =>
      chatWithTool(
        [
          { role: "system", content: PROMPT(`${owner}/${repo}#${number}`) },
          { role: "user", content: shown },
        ],
        REPORT_CONTEXT_TOOL,
        undefined,
        model,
        { mcpUrl, tools: CONTEXT_TOOLS, onStep: (step) => lookup.steps.push(step) },
      ),
    model,
  );
  const raw = (call.arguments as { facts?: unknown }).facts;
  lookup.facts = (Array.isArray(raw) ? raw : []).flatMap((f) => {
    const { fact, where } = (f ?? {}) as { fact?: unknown; where?: unknown };
    return typeof fact === "string" && fact.trim() ? [{ fact: fact.trim(), where: typeof where === "string" ? where.trim() : "" }] : [];
  });
  return lookup.facts.map(({ fact, where }) => `- ${fact}${where ? ` (${where})` : ""}`).join("\n");
}
