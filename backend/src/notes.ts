import { chat, type ChatMessage } from "./modelProvider.js";

// Replies to notes left on selected lines. These run in their own lane,
// apart from the generation queue, so a question isn't stuck behind a PR
// that's being prepared - but one at a time, so a burst of questions doesn't
// pile onto the model at once.

export interface NoteMessage {
  role: "user" | "assistant";
  text: string;
}

export interface NoteContext {
  path: string;
  lines: string;
  code: string;
  fileDiff: string;
  prTitle?: string;
  prWhat?: string;
  sliceTitle?: string;
  sliceSummary?: string;
}

const SYSTEM_PROMPT = `You are helping someone review a pull request. They have selected some \
lines of the diff and written something about them. It is either a question or a remark.
- A question: answer it directly and concisely, grounded in the code shown - the selected lines, and \
the rest of the file's changes around them. Say so plainly when that isn't enough to be sure.
- A remark meant as feedback for the PR's author, often terse ("typo", "could be null"): write \
it up as a clear, specific review comment they could post to the author, written as the \
reviewer, grounded in the selected lines. Reply with just the comment.
Keep replies short - a few sentences - since they're read in a small panel. Use backticks for code.`;

function contextMessage(context: NoteContext): string {
  const parts: string[] = [];
  if (context.prTitle) parts.push(`PR: ${context.prTitle}`);
  if (context.prWhat) parts.push(`What the PR does: ${context.prWhat}`);
  if (context.sliceTitle) {
    parts.push(`Part of the PR being reviewed: ${context.sliceTitle}${context.sliceSummary ? ` - ${context.sliceSummary}` : ""}`);
  }
  parts.push(`File: ${context.path}`);
  parts.push(`All of this PR's changes to the file:\n\`\`\`diff\n${context.fileDiff}\n\`\`\``);
  parts.push(`Selected ${context.lines}:\n\`\`\`diff\n${context.code}\n\`\`\``);
  return parts.join("\n\n");
}

let tail: Promise<unknown> = Promise.resolve();

function inLane<T>(work: () => Promise<T>): Promise<T> {
  const run = tail.then(work, work);
  tail = run.catch(() => {});
  return run;
}

export function replyToNote(
  context: NoteContext,
  messages: NoteMessage[],
  signal: AbortSignal,
): Promise<string> {
  return inLane(async () => {
    // Asked while others were ahead of it, then abandoned: skip the model.
    signal.throwIfAborted();
    const [first, ...rest] = messages;
    const conversation: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `${contextMessage(context)}\n\nThe reviewer wrote:\n${first.text}` },
      ...rest.map((m): ChatMessage => ({ role: m.role, content: m.text })),
    ];
    return chat(conversation, signal);
  });
}
