import { chatWithTool } from "./modelProvider.js";
import { inLane, type NoteMessage } from "./notes.js";

// Drafting your feedback: review comments worth posting, from the threads
// you had on selected lines. The agent review is in agentReview.ts.

export interface ThreadForFeedback {
  path: string;
  lines: string;
  code: string;
  messages: NoteMessage[];
}

export interface DraftedComment {
  // Indices of the threads it draws on, which place it on their lines.
  threads: number[];
  body: string;
}

const REPORT_FEEDBACK_TOOL = {
  name: "report_feedback",
  description: "Report the review comments worth posting on the pull request.",
  parameters: {
    type: "object",
    properties: {
      comments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            threads: {
              type: "array",
              items: { type: "integer" },
              description: "The numbers of the threads this comment draws on.",
            },
            body: { type: "string" },
          },
          required: ["threads", "body"],
        },
      },
    },
    required: ["comments"],
  },
};

const SYSTEM_PROMPT = `You are helping a reviewer turn their notes on a pull request into review \
comments for its author. Each numbered thread is about some lines of the diff: the reviewer \
either asked a question or jotted a remark, and an assistant replied.
Write a review comment only where the thread points to something the author should act on or \
answer: a bug, a risk, something unclear, a missed case, a naming or readability problem, a typo. \
A question the reply answered with no problem found is not feedback - leave it out. A remark \
the reviewer made is feedback, written up properly.
Comments don't map one-to-one to threads: combine threads that raise the same point into one \
comment, and split a thread that raises several points into several comments.
Each comment is addressed to the author, written as the reviewer, specific to the lines, and \
short: a sentence or two, with a suggestion where there is one. Start a minor point with \
"Nit: ", as reviewers do. Don't mention the assistant or the thread. Put code in backticks. Report no comments if nothing is worth posting.`;

function threadText(thread: ThreadForFeedback, index: number): string {
  const code = thread.code
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  const messages = thread.messages
    .map((m) => `${m.role === "user" ? "Reviewer" : "Assistant"}: ${m.text}`)
    .join("\n");
  return `Thread ${index + 1}: ${thread.path}, ${thread.lines}\n${code}\n${messages}`;
}

export function draftYourFeedback(
  threads: ThreadForFeedback[],
  prTitle: string | undefined,
  signal: AbortSignal,
): Promise<DraftedComment[]> {
  return inLane(async () => {
    signal.throwIfAborted();
    const intro = prTitle ? `PR: ${prTitle}\n\n` : "";
    const call = await chatWithTool(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: intro + threads.map(threadText).join("\n\n") },
      ],
      REPORT_FEEDBACK_TOOL,
      signal,
    );
    const raw = (call.arguments as { comments?: unknown }).comments;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((entry): DraftedComment[] => {
      const { threads: refs, body } = (entry ?? {}) as { threads?: unknown; body?: unknown };
      if (typeof body !== "string" || !body.trim()) return [];
      const indices = Array.isArray(refs)
        ? [...new Set(refs.filter((n): n is number => Number.isInteger(n)).map((n) => n - 1))].filter(
            (i) => i >= 0 && i < threads.length,
          )
        : [];
      return [{ threads: indices, body: body.trim() }];
    });
  });
}
