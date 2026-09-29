import { canReadCode, chat, type ChatMessage } from "../../models/modelProvider.server.js";
import { modelName } from "../../storage/settings.server.js";
import { inLane } from "../../models/lanes.server.js";

// Docent's replies in a thread on selected lines, and its answers to
// questions about a finding the panel raised.

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
  // Set when the question is about a finding a reviewer on the panel raised:
  // with the other reviewers' versions of the same point, and what the
  // panel's editor found.
  finding?: {
    reviewer: string;
    body: string;
    rationale?: string;
    severity?: string;
    others?: { reviewer: string; body: string; severity?: string; disputed?: string }[];
    editor?: { impact?: string; checked?: string; speculative?: string; onPr?: string; setAside?: string };
  };
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
wrong or doesn't apply, say so plainly - agreeing with it isn't the goal. When other reviewers \
raised the same point, or disagree about it, weigh their versions and the editor's notes too, and \
say where you land and why. Say so when the code shown isn't enough to be sure.
Keep replies short - a few sentences - since they're read in a small panel. Use backticks for code.`;

function contextMessage(context: NoteContext): string {
  const parts: string[] = [];
  if (context.prTitle) parts.push(`PR: ${context.prTitle}`);
  if (context.prWhat) parts.push(`What the PR does: ${context.prWhat}`);
  if (context.sliceTitle) {
    parts.push(`Part of the PR being reviewed: ${context.sliceTitle}${context.sliceSummary ? ` - ${context.sliceSummary}` : ""}`);
  }
  // Without a file, it's about the PR as a whole; without code, the file as a whole.
  if (context.path) {
    parts.push(`File: ${context.path}`);
    parts.push(`All of this PR's changes to the file:\n\`\`\`diff\n${context.fileDiff}\n\`\`\``);
  } else {
    parts.push(`All of this PR's changes:\n\`\`\`diff\n${context.fileDiff}\n\`\`\``);
  }
  if (context.code) {
    parts.push(`${context.finding ? "The finding is on" : "Selected"} ${context.lines}:\n\`\`\`diff\n${context.code}\n\`\`\``);
  } else if (context.finding) {
    parts.push(`The finding is about ${context.path ? "the file as a whole" : "the PR as a whole"}.`);
  }
  if (context.finding) {
    const f = context.finding;
    parts.push(`The finding, from ${f.reviewer}${f.severity ? ` (${f.severity})` : ""}:\n${f.body}`);
    if (f.rationale) parts.push(`Why it raised it:\n${f.rationale}`);
    if (f.others?.length) {
      parts.push(
        `Other reviewers raised the same point:\n${f.others
          .map((o) => `- ${o.reviewer}${o.severity ? ` (${o.severity})` : ""}${o.disputed ? ` - disagrees: ${o.disputed}` : ""}: ${o.body}`)
          .join("\n")}`,
      );
    }
    const e = f.editor;
    const notes = e
      ? [
          e.impact && `Impact: ${e.impact}`,
          e.checked && `Checked against the code: ${e.checked}`,
          e.speculative && `Speculative - it assumes: ${e.speculative}`,
          e.onPr && `Already on the PR: ${e.onPr}`,
          e.setAside && `Its reviewer had set it aside: ${e.setAside}`,
        ].filter(Boolean)
      : [];
    if (notes.length) parts.push(`What the panel's editor found:\n${notes.join("\n")}`);
  }
  return parts.join("\n\n");
}

// Where an answer can look beyond the lines it's shown: the whole repo at the
// PR's head, through Docent's read tools, on Claude Code or Codex.
export interface AnswerAccess {
  pr: string;
  mcpUrl: string;
}

const LOOK_NOTE = (pr: string) => `

You can look beyond the code shown, through Docent's tools (pass ${pr} as the PR): read_file for \
any file at the PR's head, search_code to find where something is defined or used, list_files, \
get_diff for the rest of the PR's changes, and get_existing_comments for what's been said on the \
PR. When the answer depends on code you haven't been \
shown - a type's definition, what a caller expects, another part of the PR - look it up rather \
than guess, and say which file and line you relied on. Answer straight away when what's shown is \
enough.`;

export function replyToNote(
  context: NoteContext,
  messages: NoteMessage[],
  signal: AbortSignal,
  model?: string,
  access?: AnswerAccess,
): Promise<string> {
  return inLane(async () => {
    // Asked while others were ahead of it, then abandoned: skip the model.
    signal.throwIfAborted();
    const [first, ...rest] = messages;
    const looks = !!access && canReadCode(model ?? modelName());
    const conversation: ChatMessage[] = [
      { role: "system", content: (context.finding ? FINDING_PROMPT : SYSTEM_PROMPT) + (looks ? LOOK_NOTE(access!.pr) : "") },
      { role: "user", content: `${contextMessage(context)}\n\n${context.finding ? "The reviewer asks" : "The reviewer wrote"}:\n${first.text}` },
      ...rest.map((m): ChatMessage => ({ role: m.role, content: m.text })),
    ];
    const tools = looks
      ? { mcpUrl: access!.mcpUrl, tools: ["get_diff", "read_file", "list_files", "search_code", "get_existing_comments"] }
      : undefined;
    return chat(conversation, signal, model ?? modelName(), tools);
  }, model);
}
