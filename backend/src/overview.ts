import { chatWithTool } from "./modelProvider.js";
import type { ConversationItem, PrMeta } from "./github.js";
import type { Idea } from "./ideaStore.js";
import type { ConversationCard, PrSummary } from "./overviewStore.js";

const SUMMARY_TOOL = {
  name: "report_summary",
  description: "Report a succinct, accurate What/Why/How summary of the pull request.",
  parameters: {
    type: "object",
    properties: {
      what: { type: "string" },
      why: { type: "string" },
      how: { type: "string" },
    },
    required: ["what", "why"],
  },
};

const SUMMARY_SYSTEM_PROMPT = `You are orienting a reviewer to a pull request. Below is the \
author's PR description and a breakdown of the change into small ideas, each already grounded in \
the actual code diff. Treat the ideas as ground truth; use the description only as supporting \
context, not something to audit or critique. Write a succinct, accurate summary in three parts:
- what: 1-3 sentences on what this PR actually does.
- why: 1-2 sentences on why this change is being made.
- how: only if the approach isn't obvious from "what" - 1-2 sentences on the mechanism, otherwise \
an empty string.
Call report_summary with the result.`;

export async function generateSummary(meta: PrMeta, ideas: Idea[]): Promise<PrSummary> {
  const ideasText = ideas.map((idea) => `- ${idea.title}: ${idea.summary}`).join("\n");
  const userContent = `PR description:\nTitle: ${meta.title}\n${meta.body ?? "(no description provided)"}\n\nIdeas derived from the diff:\n${ideasText || "(none generated)"}`;

  const result = await chatWithTool(
    [
      { role: "system", content: SUMMARY_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    SUMMARY_TOOL,
  );

  const raw = result.arguments as { what?: unknown; why?: unknown; how?: unknown };
  const nonEmpty = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;

  return {
    what: nonEmpty(raw.what) ?? "",
    why: nonEmpty(raw.why) ?? "",
    how: nonEmpty(raw.how),
  };
}

const CONVERSATION_TOOL = {
  name: "report_conversation",
  description: "Summarize the pull request's reviews and comments into short cards.",
  parameters: {
    type: "object",
    properties: {
      cards: {
        type: "array",
        items: {
          type: "object",
          properties: {
            author: { type: "string" },
            kind: { type: "string" },
            summary: { type: "string" },
          },
          required: ["author", "summary"],
        },
      },
    },
    required: ["cards"],
  },
};

const CONVERSATION_SYSTEM_PROMPT = `You are summarizing the review conversation on a pull \
request for a new reviewer. Below are the reviews and comments left so far, each labeled with \
its author. For each distinct review or comment with real content, produce one card: author \
(their username, exactly as given), kind (a short label like "approved", "requested changes", or \
"comment"), and summary (1-2 sentences capturing what they said or asked). Skip anything with no \
real content. Call report_conversation with the result.`;

function formatConversationItem(item: ConversationItem): string {
  const lines = [`### ${item.kind} by ${item.author}${item.state ? ` (${item.state})` : ""}`];
  if (item.body) lines.push(item.body);
  for (const c of item.inlineComments ?? []) {
    lines.push(`> ${c.path}: ${c.body}`);
  }
  return lines.join("\n");
}

export async function generateConversationCards(
  items: ConversationItem[],
): Promise<ConversationCard[]> {
  if (items.length === 0) return [];

  const prompt = items.map(formatConversationItem).join("\n\n");

  const result = await chatWithTool(
    [
      { role: "system", content: CONVERSATION_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    CONVERSATION_TOOL,
  );

  const raw = result.arguments as { cards?: unknown };
  if (!Array.isArray(raw.cards)) return [];

  const cards: ConversationCard[] = [];
  for (const entry of raw.cards) {
    if (typeof entry !== "object" || entry === null) continue;
    const { author, kind, summary } = entry as Record<string, unknown>;
    if (typeof author !== "string" || typeof summary !== "string") continue;
    cards.push({ author, kind: typeof kind === "string" && kind ? kind : "comment", summary });
  }
  return cards;
}
