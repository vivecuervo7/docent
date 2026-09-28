import { chatWithTool } from "./modelProvider.js";
import type { ConversationEntry, PrConversation, PrMeta } from "./github.js";
import type {
  ConversationSummary,
  Slice,
  PrSummary,
  ReplyOutcome,
  ReviewerConversation,
  ThreadReply,
} from "./types.js";

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
author's PR description, a breakdown of the change into small slices (each already grounded in the \
actual code diff), and a summary of the review conversation so far. The slices reflect the final \
state of the code and are ground truth. The conversation explains how the PR got there - it often \
records the author changing something in response to review. The description may have been \
written before those changes and can be out of date; where it disagrees with the slices or the \
conversation, trust the slices and the conversation. Use the description only as supporting \
context, not something to audit or critique. Describe the PR as it stands now: do not narrate the \
review itself ("a reviewer asked...") - that is shown separately. Write a succinct, accurate \
summary in three parts:
- what: 1-3 sentences on what this PR actually does.
- why: 1-2 sentences on why this change is being made.
- how: only if the approach isn't obvious from "what" - 1-2 sentences on the mechanism, otherwise \
an empty string.
Call report_summary with the result.`;

function formatConversationDigest(conversation: ConversationSummary | null): string {
  if (!conversation || (conversation.reviewers.length === 0 && !conversation.authorNotes)) {
    return "(no review conversation)";
  }
  const lines = conversation.reviewers.map((r) => {
    const replies = r.replies.map(
      (reply) =>
        `  - ${reply.from === "author" ? conversation.prAuthor : r.reviewer}` +
        `${reply.outcome ? ` (${reply.outcome})` : ""}: ${reply.summary}`,
    );
    return [`- ${r.reviewer}${r.verdict ? ` (${r.verdict})` : ""}: ${r.summary}`, ...replies].join("\n");
  });
  if (conversation.authorNotes) lines.push(`- ${conversation.prAuthor} (author notes): ${conversation.authorNotes}`);
  return lines.join("\n");
}

export async function generateSummary(
  meta: PrMeta,
  slices: Slice[],
  conversation: ConversationSummary | null,
  signal?: AbortSignal,
  model?: string,
): Promise<PrSummary> {
  const slicesText = slices.map((slice) => `- ${slice.title}: ${slice.summary}`).join("\n");
  const userContent = [
    `PR description:\nTitle: ${meta.title}\n${meta.body ?? "(no description provided)"}`,
    `Slices derived from the diff:\n${slicesText || "(none generated)"}`,
    `Review conversation:\n${formatConversationDigest(conversation)}`,
  ].join("\n\n");

  const result = await chatWithTool(
    [
      { role: "system", content: SUMMARY_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    SUMMARY_TOOL,
    signal,
    model,
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

const OUTCOMES: ReplyOutcome[] = ["actioned", "acknowledged", "refuted", "answered", "mixed"];
type Verdict = NonNullable<ReviewerConversation["verdict"]>;
const VERDICTS: Verdict[] = [
  "approved",
  "changes requested",
  "commented",
];

const CONVERSATION_TOOL = {
  name: "report_conversation",
  description: "Summarize the review conversation on a pull request, one entry per reviewer.",
  parameters: {
    type: "object",
    properties: {
      reviewers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            reviewer: { type: "string" },
            verdict: { type: "string", enum: VERDICTS },
            summary: { type: "string" },
            replies: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  from: { type: "string", enum: ["author", "reviewer"] },
                  outcome: { type: "string", enum: OUTCOMES },
                  summary: { type: "string" },
                },
                required: ["from", "summary"],
              },
            },
          },
          required: ["reviewer", "summary", "replies"],
        },
      },
      authorNotes: { type: "string" },
    },
    required: ["reviewers"],
  },
};

const CONVERSATION_SYSTEM_PROMPT = `You are giving a new reviewer a quick sense of the conversation \
that has happened on a pull request. Below is everything said on it, with timestamps, including who \
the PR author is. Produce one entry per reviewer (anyone other than the PR author):
- reviewer: their username, exactly as given.
- verdict: their latest review verdict if they left one ("approved", "changes requested", \
"commented"), otherwise omit it.
- summary: 1-3 sentences covering everything they raised, as one succinct overview of the kinds of \
things they noticed - even if their feedback arrived at different times or in different places. Do \
not list findings one by one.
- replies: the flattened back-and-forth, usually zero or one entries. If the PR author responded to \
this reviewer at all, add ONE "author" reply summarizing everything the author did in response, \
with outcome "actioned" (made changes), "acknowledged" (agreed, no change yet), "refuted" (pushed \
back), "answered" (answered the reviewer's question), or "mixed" (a combination, e.g. fixed some \
points but questioned or pushed back on another). Only add a further "reviewer" reply if the \
reviewer came back with something substantive after that, and an "author" reply after that only if \
the author answered again. Leave replies empty if the author never responded.
The author often responds to a reviewer's points with separate comments - inline comments on the \
files the reviewer mentioned, or comments on the PR - rather than direct replies. Attribute those to \
the reviewer whose points they address, matching by topic and timing.
Threads the author started on their own code and resolved themselves are self-review, not a \
response to anyone - cover them in authorNotes instead.
A reviewer who only approved, or a bot that only posted an automated summary of the PR, gets an \
entry with a one-line summary and no replies.
authorNotes: 1-2 sentences on anything the PR author said that wasn't a response to a reviewer \
(self-review, status updates, extra changes they landed), or an empty string if there was nothing.
Call report_conversation with the result.`;

function formatEntry(entry: ConversationEntry, suffix = ""): string {
  const when = entry.createdAt ? `[${entry.createdAt}] ` : "";
  return `${when}${entry.author}${suffix}: ${entry.body || "(no text)"}`;
}

function formatConversation(conversation: PrConversation): string {
  const sections = [`PR author: ${conversation.prAuthor}`];
  if (conversation.reviews.length > 0) {
    sections.push(
      "## Reviews\n" +
        conversation.reviews.map((r) => formatEntry(r, ` (${r.state})`)).join("\n\n"),
    );
  }
  if (conversation.comments.length > 0) {
    sections.push(
      "## Comments on the PR\n" + conversation.comments.map((c) => formatEntry(c)).join("\n\n"),
    );
  }
  if (conversation.threads.length > 0) {
    sections.push(
      "## Inline review threads\n" +
        conversation.threads
          .map((t) => `### ${t.path}\n` + t.entries.map((e) => formatEntry(e)).join("\n"))
          .join("\n\n"),
    );
  }
  return sections.join("\n\n");
}

// The local model sometimes wraps a summary in stray quotes.
function cleanSummary(text: string): string {
  return text.trim().replace(/^["'\u201c\u201d]+|["'\u201c\u201d]+$/g, "").trim();
}

function parseReplies(raw: unknown): ThreadReply[] {
  if (!Array.isArray(raw)) return [];
  const replies: ThreadReply[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { from, outcome, summary } = entry as Record<string, unknown>;
    if ((from !== "author" && from !== "reviewer") || typeof summary !== "string" || !summary.trim()) {
      continue;
    }
    replies.push({
      from,
      outcome: OUTCOMES.includes(outcome as ReplyOutcome) ? (outcome as ReplyOutcome) : undefined,
      summary: cleanSummary(summary),
    });
  }
  return replies;
}

export async function generateConversationSummary(
  conversation: PrConversation,
  signal?: AbortSignal,
  model?: string,
): Promise<ConversationSummary> {
  const empty: ConversationSummary = { prAuthor: conversation.prAuthor, reviewers: [] };
  const { reviews, comments, threads } = conversation;
  if (reviews.length + comments.length + threads.length === 0) return empty;

  const result = await chatWithTool(
    [
      { role: "system", content: CONVERSATION_SYSTEM_PROMPT },
      { role: "user", content: formatConversation(conversation) },
    ],
    CONVERSATION_TOOL,
    signal,
    model,
  );

  const raw = result.arguments as { reviewers?: unknown; authorNotes?: unknown };
  const reviewers: ReviewerConversation[] = [];
  for (const entry of Array.isArray(raw.reviewers) ? raw.reviewers : []) {
    if (typeof entry !== "object" || entry === null) continue;
    const { reviewer, verdict, summary, replies } = entry as Record<string, unknown>;
    if (typeof reviewer !== "string" || typeof summary !== "string") continue;
    // The model occasionally lists the author as a reviewer of their own PR.
    if (reviewer === conversation.prAuthor) continue;
    reviewers.push({
      reviewer,
      verdict: VERDICTS.includes(verdict as Verdict) ? (verdict as Verdict) : undefined,
      summary: cleanSummary(summary),
      replies: parseReplies(replies),
    });
  }

  const authorNotes =
    typeof raw.authorNotes === "string" && raw.authorNotes.trim() ? cleanSummary(raw.authorNotes) : undefined;
  return { prAuthor: conversation.prAuthor, reviewers, authorNotes };
}
