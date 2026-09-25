import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Persona } from "./config.js";

// A review persona: the reviewer's own tooling - a skill, a command, a
// prompt - run as an unattended Claude Code session. It reads the PR through
// Docent's MCP server, from an empty folder with no shell, and ends with its
// findings in Docent's shape.

// Tools every persona has; its own `tools` add to these. Anything else is
// refused, since nobody is there to approve it.
export const ALWAYS_ALLOWED = [
  "mcp__docent__get_review_context",
  "mcp__docent__get_diff",
  "mcp__docent__read_file",
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
        },
        required: ["body"],
      },
    },
  },
  required: ["findings"],
};

export interface PersonaFinding {
  path?: string;
  startLine?: number;
  endLine?: number;
  body: string;
  rationale?: string;
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
get_existing_comments), passing it as ${owner}/${repo}#${number}. When the review is complete, \
report every finding in the structured output: its file path and new-file lines, the comment for \
the author, and why it was raised.`;
}

export function runPersona(
  persona: Persona,
  pr: { owner: string; repo: string; number: string },
  mcpUrl: string,
  signal: AbortSignal,
): Promise<PersonaFinding[]> {
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

  return new Promise<PersonaFinding[]>((resolve, reject) => {
    const child = spawn("claude", args, { cwd: dir, signal });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      let result: { is_error?: boolean; result?: string; structured_output?: { findings?: unknown } } | undefined;
      try {
        result = JSON.parse(stdout);
      } catch {
        return reject(new Error(stderr.trim() || stdout.trim() || `claude exited with ${code}`));
      }
      if (result?.is_error) return reject(new Error(result.result ?? "The persona's session failed."));
      const raw = result?.structured_output?.findings;
      if (!Array.isArray(raw)) {
        return reject(
          new Error(
            "It finished without handing its findings back. Built-in commands like /review can't; a skill or a plain prompt can.",
          ),
        );
      }
      resolve(
        raw.flatMap((f): PersonaFinding[] => {
          const { path, start_line, end_line, body, rationale } = (f ?? {}) as Record<string, unknown>;
          if (typeof body !== "string" || !body.trim()) return [];
          return [
            {
              body,
              path: typeof path === "string" && path ? path : undefined,
              startLine: typeof start_line === "number" ? start_line : undefined,
              endLine: typeof end_line === "number" ? end_line : undefined,
              rationale: typeof rationale === "string" ? rationale : undefined,
            },
          ];
        }),
      );
    });
    child.stdin.end();
  }).finally(() => rmSync(dir, { recursive: true, force: true }));
}
