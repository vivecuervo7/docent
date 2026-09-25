import { maxConcurrentRequests } from "./config.js";
import { chat, type ChatMessage } from "./modelProvider.js";

// Replies to notes left on selected lines. These run in their own lane,
// apart from the generation queue, so a question isn't stuck behind a PR
// that's being prepared - but only as many at once as the model allows, so
// a burst of questions doesn't pile onto a local model.

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
  // Set when the question is about a finding a reviewer on the panel raised.
  finding?: { reviewer: string; body: string; rationale?: string };
}

const SYSTEM_PROMPT = `You are helping someone review a pull request. They have selected some \
lines of the diff and written something about them. It is either a question or a remark.
- A question: answer it directly and concisely, grounded in the code shown - the selected lines, and \
the rest of the file's changes around them. Say so plainly when that isn't enough to be sure.
- A remark meant as feedback for the PR's author, often terse ("typo", "could be null"): write \
it up as a clear, specific review comment they could post to the author, written as the \
reviewer, grounded in the selected lines. Reply with just the comment.
Keep replies short - a few sentences - since they're read in a small panel. Use backticks for code.`;

const FINDING_PROMPT = `You are helping someone review a pull request. An automated reviewer raised \
a finding on some lines of the diff, and the reviewer is asking about it before deciding whether \
to post it. Answer their question directly and honestly, grounded in the code shown: whether the \
finding holds up, what it means, what fixing it would involve. If the code shows the finding is \
wrong or doesn't apply, say so plainly - agreeing with it isn't the goal. Say so when the code \
shown isn't enough to be sure.
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
  parts.push(`${context.finding ? "The finding is on" : "Selected"} ${context.lines}:\n\`\`\`diff\n${context.code}\n\`\`\``);
  if (context.finding) {
    parts.push(`The finding, from ${context.finding.reviewer}:\n${context.finding.body}`);
    if (context.finding.rationale) parts.push(`Why it raised it:\n${context.finding.rationale}`);
  }
  return parts.join("\n\n");
}

let active = 0;
const waiting: (() => void)[] = [];

function admit() {
  while (active < maxConcurrentRequests() && waiting.length > 0) {
    active++;
    waiting.shift()!();
  }
}

// Shared by the other interactive model calls, such as drafting feedback:
// as many run at once as the model allows, and the rest wait their turn.
export function inLane<T>(work: () => Promise<T>): Promise<T> {
  return new Promise<void>((start) => {
    waiting.push(start);
    admit();
  })
    .then(work)
    .finally(() => {
      active--;
      admit();
    });
}

// `model` answers with a model of its own: the one that raised a finding.
export function replyToNote(
  context: NoteContext,
  messages: NoteMessage[],
  signal: AbortSignal,
  model?: string,
): Promise<string> {
  return inLane(async () => {
    // Asked while others were ahead of it, then abandoned: skip the model.
    signal.throwIfAborted();
    const [first, ...rest] = messages;
    const conversation: ChatMessage[] = [
      { role: "system", content: context.finding ? FINDING_PROMPT : SYSTEM_PROMPT },
      { role: "user", content: `${contextMessage(context)}\n\n${context.finding ? "The reviewer asks" : "The reviewer wrote"}:\n${first.text}` },
      ...rest.map((m): ChatMessage => ({ role: m.role, content: m.text })),
    ];
    return model ? chat(conversation, signal, model) : chat(conversation, signal);
  });
}
