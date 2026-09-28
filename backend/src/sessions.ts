import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexSession } from "./codex.js";
import type { ExternalReviewer } from "./config.js";

// An external reviewer: the reviewer's own tooling - a skill, a command, a
// prompt - run as an unattended Claude Code session. It reads the PR through
// Docent's MCP server, from an empty folder with no shell, and ends with its
// findings in Docent's shape.

// Tools every Claude Code session has; its own `tools` add to these.
// Anything else is refused, since nobody is there to approve it.
export const ALWAYS_ALLOWED = [
  "mcp__docent__get_review_context",
  "mcp__docent__get_diff",
  "mcp__docent__read_file",
  "mcp__docent__list_files",
  "mcp__docent__search_code",
  "mcp__docent__get_existing_comments",
  "Read",
  "Glob",
  "Grep",
  "Agent",
  "Skill",
];

// Docent's own tools that would compete with the structured answer.
const REFUSED = ["mcp__docent__submit_review", "mcp__docent__submit_finding", "mcp__docent__finish_review"];

const FINDINGS_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string", description: "The file's path in the PR. Leave out for the PR as a whole." },
          start_line: { type: "integer", description: "The new-file line it starts on." },
          end_line: { type: "integer" },
          body: { type: "string", description: "The comment for the PR's author." },
          rationale: { type: "string", description: "Why it was raised, for the reviewer deciding whether to post it." },
          severity: { type: "string", enum: ["blocker", "major", "minor", "nit"], description: "How much it matters; the lower one when unsure." },
          set_aside: {
            type: "string",
            description:
              "If the review's own process set this finding aside - pushed back on it, or filtered it out of what it would post - why. Leave out for a finding it stands by.",
          },
        },
        required: ["body"],
      },
    },
    verdict: {
      type: "string",
      enum: ["approve", "request_changes", "comment"],
      description: "The review's overall recommendation, if it makes one.",
    },
    verdict_reason: { type: "string", description: "Why, in a sentence." },
  },
  required: ["findings"],
};

export interface SessionFinding {
  path?: string;
  startLine?: number;
  endLine?: number;
  body: string;
  rationale?: string;
  severity?: string;
  setAside?: string;
}

// What a session hands back: its findings, and its overall recommendation
// when the review makes one.
export interface SessionResult {
  findings: SessionFinding[];
  verdict?: { event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"; reason?: string };
}

function verdictOf(out: unknown): SessionResult["verdict"] {
  const { verdict, verdict_reason } = (out ?? {}) as { verdict?: unknown; verdict_reason?: unknown };
  const event = verdict === "approve" ? "APPROVE" : verdict === "request_changes" ? "REQUEST_CHANGES" : verdict === "comment" ? "COMMENT" : undefined;
  return event ? { event, ...(typeof verdict_reason === "string" && verdict_reason.trim() ? { reason: verdict_reason.trim() } : {}) } : undefined;
}

export function fillCommand(command: string, pr: { owner: string; repo: string; number: string }): string {
  const url = `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}`;
  return command
    .replaceAll("{pr_url}", url)
    .replaceAll("{owner}", pr.owner)
    .replaceAll("{repo}", pr.repo)
    .replaceAll("{number}", pr.number);
}

function handback(owner: string, repo: string, number: string): string {
  return `This runs unattended inside Docent, a pull request review tool. There's no shell or local \
checkout: read the pull request through Docent's tools (get_review_context, get_diff, read_file, \
list_files, search_code, get_existing_comments), passing it as ${owner}/${repo}#${number}. When the review is complete, \
report every finding in the structured output: its file path and new-file lines, the comment for \
the author, and why it was raised - and, if the review ends with an overall recommendation \
(approve, request changes, or just comment), that too, with why. If the review set findings aside - pushed back on them, or \
filtered them out of what it would post, such as to a local-only list - hand those back too, each \
with why it was set aside; Docent's editor makes the final call on them. Leave out positive \
observations. Nobody is here to answer questions or approve actions: don't ask, and don't post \
anything to GitHub.`;
}

export function runClaudeSession(
  persona: ExternalReviewer,
  pr: { owner: string; repo: string; number: string },
  mcpUrl: string,
  signal: AbortSignal,
): Promise<SessionResult> {
  const dir = mkdtempSync(join(tmpdir(), "docent-persona-"));
  const extra = (persona.tools ?? "").split(/\s+/).filter(Boolean);
  const args = [
    "-p",
    fillCommand(persona.command, pr),
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(FINDINGS_SCHEMA),
    "--strict-mcp-config",
    "--mcp-config",
    JSON.stringify({ mcpServers: { docent: { type: "http", url: mcpUrl } } }),
    "--append-system-prompt",
    handback(pr.owner, pr.repo, pr.number),
    "--allowedTools",
    ...ALWAYS_ALLOWED,
    ...extra,
    "--disallowedTools",
    ...REFUSED,
    ...(persona.model ? ["--model", persona.model] : []),
  ];

  return new Promise<SessionResult>((resolve, reject) => {
    const child = spawn("claude", args, { cwd: dir, signal });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      let result: { is_error?: boolean; result?: string; structured_output?: { findings?: unknown; verdict?: unknown } } | undefined;
      try {
        result = JSON.parse(stdout);
      } catch {
        return reject(new Error(stderr.trim() || stdout.trim() || `claude exited with ${code}`));
      }
      if (result?.is_error) return reject(new Error(result.result ?? "The session failed."));
      const raw = result?.structured_output?.findings;
      if (!Array.isArray(raw)) {
        return reject(
          new Error(
            "It finished without handing its findings back. Built-in commands like /review can't; a skill or a plain prompt can.",
          ),
        );
      }
      resolve({
        verdict: verdictOf(result?.structured_output),
        findings: raw.flatMap((f): SessionFinding[] => {
          const { path, start_line, end_line, body, rationale, severity, set_aside } = (f ?? {}) as Record<string, unknown>;
          if (typeof body !== "string" || !body.trim()) return [];
          return [
            {
              body,
              path: typeof path === "string" && path ? path : undefined,
              startLine: typeof start_line === "number" ? start_line : undefined,
              endLine: typeof end_line === "number" ? end_line : undefined,
              rationale: typeof rationale === "string" ? rationale : undefined,
              severity: typeof severity === "string" ? severity : undefined,
              setAside: typeof set_aside === "string" && set_aside.trim() ? set_aside.trim() : undefined,
            },
          ];
        }),
      });
    });
    child.stdin.end();
  }).finally(() => rmSync(dir, { recursive: true, force: true }));
}

function toFindings(raw: unknown[]): SessionFinding[] {
  return raw.flatMap((f): SessionFinding[] => {
    const { path, start_line, end_line, body, rationale, severity, set_aside } = (f ?? {}) as Record<string, unknown>;
    if (typeof body !== "string" || !body.trim()) return [];
    return [
      {
        body,
        path: typeof path === "string" && path ? path : undefined,
        startLine: typeof start_line === "number" ? start_line : undefined,
        endLine: typeof end_line === "number" ? end_line : undefined,
        rationale: typeof rationale === "string" ? rationale : undefined,
        severity: typeof severity === "string" ? severity : undefined,
        setAside: typeof set_aside === "string" && set_aside.trim() ? set_aside.trim() : undefined,
      },
    ];
  });
}

// The same, on Codex: Docent's read tools approved ahead, its shell and the
// rest switched off.
async function runCodexSession(
  reviewer: ExternalReviewer,
  pr: { owner: string; repo: string; number: string },
  mcpUrl: string,
  signal: AbortSignal,
): Promise<SessionResult> {
  const prompt = `${fillCommand(reviewer.command, pr)}\n\n---\n\n${handback(pr.owner, pr.repo, pr.number)}`;
  const tools = ALWAYS_ALLOWED.filter((t) => t.startsWith("mcp__docent__")).map((t) => t.slice("mcp__docent__".length));
  const answer = (await codexSession(reviewer.model, prompt, FINDINGS_SCHEMA, { url: mcpUrl, tools }, signal)) as { findings?: unknown };
  if (!Array.isArray(answer?.findings)) throw new Error("It finished without handing its findings back.");
  return { findings: toFindings(answer.findings), verdict: verdictOf(answer) };
}

export function runSession(
  reviewer: ExternalReviewer,
  pr: { owner: string; repo: string; number: string },
  mcpUrl: string,
  signal: AbortSignal,
): Promise<SessionResult> {
  return reviewer.runner === "codex" ? runCodexSession(reviewer, pr, mcpUrl, signal) : runClaudeSession(reviewer, pr, mcpUrl, signal);
}
