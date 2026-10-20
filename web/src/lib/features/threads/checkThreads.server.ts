import { canReadCode, chatWithTool } from "../../models/modelProvider.server.js";
import { inLane } from "../../models/lanes.server.js";
import { modelName } from "../../storage/settings.server.js";
import type { AnswerAccess } from "../reading/threadReplies.server.js";

// Whether the changes under review address a thread someone left on GitHub,
// checked for every open thread at once, so none is missed.

export interface ThreadToCheck {
  path: string;
  // Where it sits now, or where it was left when its lines have changed.
  lines: string;
  // Its lines as they read now, with +/- markers; empty when they've moved.
  code: string;
  // This round's changes to its file; empty when the round didn't touch it.
  fileDiff: string;
  // Reviewing some of the PR's commits: the lines in the file they changed.
  roundLines?: string;
  // The thread, as text.
  github: string;
}

export interface ThreadVerdict {
  verdict: "addressed" | "not-yet" | "unclear";
  reason: string;
  // A reply the reviewer could post, when it isn't addressed.
  reply?: string;
}

const REPORT_CHECK_TOOL = {
  name: "report_check",
  description: "Report whether the comment has been addressed.",
  parameters: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["addressed", "not-yet", "unclear"] },
      reason: { type: "string" },
      reply: { type: "string" },
    },
    required: ["verdict", "reason"],
  },
};

const SYSTEM_PROMPT = `You are helping someone review a pull request. Someone left a comment on \
it on GitHub, and the reviewer wants to know whether it has been dealt with, so they can resolve \
it or follow it up. Judge from the changes shown and the replies in the thread:
- addressed: the changes do what it asked, or the thread settled it (the author explained and the \
commenter agreed, or it turned out not to need a change).
- not-yet: it still stands - nothing changed it, or a promised fix hasn't landed.
- unclear: what's shown can't settle it, or whether it's settled is a matter of taste.
Give the reason in one short sentence the reviewer can scan in a list: what addresses it, by line, \
or what's left. For not-yet or unclear, also write a reply the reviewer could post on the thread: \
a sentence or two, as the reviewer, saying what's still open. Write no reply when it's addressed. \
Use backticks for code.`;

const LOOK_NOTE = (pr: string) => `

You can look beyond the code shown, through Docent's tools (pass ${pr} as the PR): read_file for \
any file at the PR's head and search_code to find where something now lives. Look when the \
comment's lines have moved or the fix may be elsewhere; answer straight away when what's shown is \
enough.`;

function contextOf(thread: ThreadToCheck): string {
  const parts = [`File: ${thread.path}, ${thread.lines}`, `The thread on GitHub:\n${thread.github}`];
  if (thread.code) parts.push(`Its lines now:\n\`\`\`diff\n${thread.code}\n\`\`\``);
  parts.push(
    thread.fileDiff
      ? `The changes under review to the file:\n\`\`\`diff\n${thread.fileDiff}\n\`\`\``
      : "The changes under review don't touch this file.",
  );
  if (thread.roundLines) {
    parts.push(`This review covers only some of the PR's commits. In this file they changed lines ${thread.roundLines}.`);
  }
  return parts.join("\n\n");
}

export function checkThread(thread: ThreadToCheck, signal: AbortSignal, model?: string, access?: AnswerAccess): Promise<ThreadVerdict> {
  return inLane(async () => {
    signal.throwIfAborted();
    const looks = !!access && canReadCode(model ?? modelName());
    const call = await chatWithTool(
      [
        { role: "system", content: SYSTEM_PROMPT + (looks ? LOOK_NOTE(access!.pr) : "") },
        { role: "user", content: contextOf(thread) },
      ],
      REPORT_CHECK_TOOL,
      signal,
      model ?? modelName(),
      looks ? { mcpUrl: access!.mcpUrl, tools: ["read_file", "search_code", "list_files"] } : undefined,
    );
    const { verdict, reason, reply } = call.arguments as Record<string, unknown>;
    if (verdict !== "addressed" && verdict !== "not-yet" && verdict !== "unclear") throw new Error("The check gave no verdict.");
    return {
      verdict,
      reason: typeof reason === "string" ? reason.trim() : "",
      ...(verdict !== "addressed" && typeof reply === "string" && reply.trim() ? { reply: reply.trim() } : {}),
    };
  }, model);
}
