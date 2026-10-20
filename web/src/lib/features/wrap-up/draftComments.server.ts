import { chatWithTool } from "../../models/modelProvider.server.js";
import { inLane } from "../../models/lanes.server.js";
import type { NoteMessage } from "../reading/threadReplies.server.js";

// Drafting your feedback: review comments worth posting, from the threads
// you had on selected lines. The panel's reviews are in features/panel.

export interface ThreadForFeedback {
  path: string;
  lines: string;
  code: string;
  messages: NoteMessage[];
  // The comment on GitHub it asks about, as text.
  github?: string;
}

export interface DraftedComment {
  // Indices of the threads it draws on, which place it on their lines.
  threads: number[];
  // Somewhere else instead, when a conclusion says the point applies there.
  at?: { path: string; startLine: number; endLine: number };
  body: string;
  rationale?: string;
  // The earlier comment it's a new version of, by its id.
  replaces?: string;
}

// A comment drafted from the same threads before, which a redraft may
// carry on.
export interface EarlierComment {
  id: string;
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
            rationale: { type: "string" },
            path: { type: "string", description: "Only for a comment placed away from its threads' lines." },
            start_line: { type: "integer", description: "New-file line number, with path." },
            end_line: { type: "integer", description: "New-file line number, with path." },
            replaces: { type: "string", description: "The id of the earlier comment this is a new version of, if any." },
          },
          required: ["threads", "body", "rationale"],
        },
      },
    },
    required: ["comments"],
  },
};

const SYSTEM_PROMPT = `You are helping a reviewer turn their notes on a pull request into review \
comments for its author. Each numbered thread is about some lines of the diff, a whole file, or the \
PR as a whole: the reviewer either asked a question or jotted a remark, and an assistant replied.
Write a review comment only where the thread points to something the author should act on or \
answer: a bug, a risk, something unclear, a missed case, a naming or readability problem, a typo. \
A question the reply answered with no problem found is not feedback - leave it out. A remark \
the reviewer made is feedback, written up properly.
Some threads end with the reviewer's conclusion: their decision on where the thread lands. Where \
there is one, follow it over your own judgement - draft the comment it calls for, in the reviewer's \
voice and close to what they concluded, taking the detail from the rest of the thread, and write \
none when it settles that nothing needs raising. When it says the point applies somewhere else as \
well, write a further comment for each such place, worded for it, with its path and new-file \
start_line and end_line as the thread names them.
Comments don't map one-to-one to threads: combine threads that raise the same point into one \
comment, and split a thread that raises several points into several comments.
Each comment is addressed to the author, written as the reviewer, specific to the lines, and \
short: a sentence or two, with a suggestion where there is one. Start a minor point with \
"Nit: ", as reviewers do. Don't mention the assistant or the thread. Put code in backticks. Report no comments if nothing is worth posting.
When earlier comments drafted from these threads are listed, the threads have moved on since: \
write the comments as the threads now stand, and give each that makes the same point as an earlier \
one that earlier comment's id as replaces. Leave replaces out for a new point.
Also give each comment a rationale, for the reviewer only (the author never sees it): which of \
their notes it came from and what those showed - say so when you combined several notes or \
split one. A sentence or two.`;

function threadText(thread: ThreadForFeedback, index: number): string {
  const code = thread.code
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  const messages = thread.messages
    .map((m) => `${m.conclusion ? "Reviewer's conclusion" : m.role === "user" ? "Reviewer" : "Assistant"}: ${m.text}`)
    .join("\n");
  const about = thread.github ? `About this comment someone left on GitHub:\n${thread.github}\n` : "";
  return `Thread ${index + 1}: ${thread.path}, ${thread.lines}\n${code}\n${about}${messages}`;
}

export function draftYourFeedback(
  threads: ThreadForFeedback[],
  prTitle: string | undefined,
  signal: AbortSignal,
  model?: string,
  earlier: EarlierComment[] = [],
): Promise<DraftedComment[]> {
  return inLane(async () => {
    signal.throwIfAborted();
    const intro = prTitle ? `PR: ${prTitle}\n\n` : "";
    const before = earlier.length
      ? `\n\nEarlier comments drafted from these threads:\n${earlier.map((c) => `[${c.id}] ${c.body}`).join("\n\n")}`
      : "";
    const call = await chatWithTool(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: intro + threads.map(threadText).join("\n\n") + before },
      ],
      REPORT_FEEDBACK_TOOL,
      signal,
      model,
    );
    const raw = (call.arguments as { comments?: unknown }).comments;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((entry): DraftedComment[] => {
      const { threads: refs, body, rationale, path, start_line, end_line, replaces } = (entry ?? {}) as Record<string, unknown>;
      if (typeof body !== "string" || !body.trim()) return [];
      const indices = Array.isArray(refs)
        ? [...new Set(refs.filter((n): n is number => Number.isInteger(n)).map((n) => n - 1))].filter(
            (i) => i >= 0 && i < threads.length,
          )
        : [];
      const placed =
        typeof path === "string" && path.trim() && Number.isInteger(start_line) && Number.isInteger(end_line)
          ? { path: path.trim(), startLine: Math.min(start_line as number, end_line as number), endLine: Math.max(start_line as number, end_line as number) }
          : undefined;
      return [
        {
          threads: indices,
          body: body.trim(),
          rationale: typeof rationale === "string" && rationale.trim() ? rationale.trim() : undefined,
          ...(placed ? { at: placed } : {}),
          ...(typeof replaces === "string" && earlier.some((c) => c.id === replaces) ? { replaces } : {}),
        },
      ];
    });
  }, model);
}
