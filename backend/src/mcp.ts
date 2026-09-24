import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as z from "zod/v4";
import { REVIEWER_RE, finishAgentReview, getReviewContext, resolveReviewer, submitFinding } from "./agentReview.js";
import {
  fetchFileContentAtRef,
  fetchPrBaseSha,
  fetchPrConversation,
  fetchPrFiles,
  fetchPrHeadSha,
  fetchPrMeta,
} from "./github.js";
import { conversationText } from "./postReview.js";
import { numberedFileDiff } from "./prDiff.js";

// Docent over MCP, so a reviewer can run their own agent - any model, any
// harness - against a PR and have its findings land on the Agent feedback
// page. Stateless: each request gets a fresh server, and review state lives
// in agentReview.ts.

const PR_REF_RE = /^(?:https:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+)(?:\/pull\/|#|\/)(\d+)\/?$/;

function parsePr(pr: string): { owner: string; repo: string; number: string } {
  const match = pr.trim().match(PR_REF_RE);
  if (!match) throw new Error(`Couldn't read "${pr}" as a PR. Use owner/repo#123 or its GitHub URL.`);
  return { owner: match[1], repo: match[2], number: match[3] };
}

const prArg = z.string().describe("The pull request, as owner/repo#123 or its GitHub URL.");

const reviewerArg = z
  .string()
  .regex(REVIEWER_RE)
  .optional()
  .describe(
    "Which of the PR's agent reviewers in Docent this is for, e.g. agent-2, if the user named one. Leave it out otherwise: Docent picks the reviewer waiting for this agent.",
  );

// Prompt arguments arrive as text, and may be left empty.
function reviewerFrom(value: string | undefined): string | undefined {
  const reviewer = value?.trim();
  return reviewer && REVIEWER_RE.test(reviewer) ? reviewer : undefined;
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

function failure(err: unknown) {
  return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
}

function buildServer(): McpServer {
  const server = new McpServer({ name: "docent", version: "0.1.0" });

  server.registerTool(
    "get_review_context",
    {
      description:
        "Start here. The PR's title and description, Docent's summary of it, how it's broken into slices (small groups of related changes, each with an id), and the files it changes.",
      inputSchema: { pr: prArg },
    },
    async ({ pr }) => {
      try {
        const { owner, repo, number } = parsePr(pr);
        const [meta, files] = await Promise.all([fetchPrMeta(owner, repo, number), fetchPrFiles(owner, repo, number)]);
        const context = getReviewContext(owner, repo, number);
        const parts = [`# ${meta.title}`, meta.htmlUrl, meta.body ? `## Description\n${meta.body}` : ""];
        if (context.summary) {
          parts.push(
            `## Summary\nWhat: ${context.summary.what}\nWhy: ${context.summary.why}${context.summary.how ? `\nHow: ${context.summary.how}` : ""}`,
          );
        }
        if (context.slices?.length) {
          parts.push(
            `## Slices\n${context.slices.map((s) => `- ${s.id}: ${s.title} - ${s.summary} (${s.hunks.join(", ")})`).join("\n")}`,
          );
        }
        parts.push(`## Files\n${files.map((f) => `- ${f.filename} (${f.status}, +${f.additions} -${f.deletions})`).join("\n")}`);
        return text(parts.filter(Boolean).join("\n\n"));
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    "get_diff",
    {
      description:
        "The diff for one slice, one file, or (with neither) the whole PR. Each line starts with its line number in the new file - the numbers findings refer to. Deleted lines have none.",
      inputSchema: {
        pr: prArg,
        slice_id: z.string().optional().describe("A slice id from get_review_context."),
        path: z.string().optional().describe("A file the PR changes."),
      },
    },
    async ({ pr, slice_id, path }) => {
      try {
        const { owner, repo, number } = parsePr(pr);
        const files = await fetchPrFiles(owner, repo, number);
        if (slice_id) {
          const slice = getReviewContext(owner, repo, number).slices?.find((s) => s.id === slice_id);
          if (!slice) throw new Error(`No slice ${slice_id}. Slices come from get_review_context.`);
          const byFile = new Map<string, number[]>();
          for (const ref of slice.hunks) {
            const at = ref.lastIndexOf("#");
            byFile.set(ref.slice(0, at), [...(byFile.get(ref.slice(0, at)) ?? []), Number(ref.slice(at + 1))]);
          }
          return text(
            [...byFile]
              .map(([file, indices]) => {
                const found = files.find((f) => f.filename === file);
                return found ? numberedFileDiff(found, indices) : "";
              })
              .filter(Boolean)
              .join("\n\n"),
          );
        }
        const shown = path ? files.filter((f) => f.filename === path) : files;
        if (path && shown.length === 0) throw new Error(`${path} isn't one of the files this PR changes.`);
        return text(shown.map((f) => numberedFileDiff(f)).join("\n\n"));
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    "read_file",
    {
      description: "A file's full contents, as of the PR's head (the new version) or its base (the old one).",
      inputSchema: {
        pr: prArg,
        path: z.string(),
        version: z.enum(["head", "base"]).optional().describe("Defaults to head."),
      },
    },
    async ({ pr, path, version }) => {
      try {
        const { owner, repo, number } = parsePr(pr);
        const sha = version === "base" ? await fetchPrBaseSha(owner, repo, number) : await fetchPrHeadSha(owner, repo, number);
        const content = await fetchFileContentAtRef(owner, repo, sha, path);
        if (content === null) throw new Error(`Couldn't read ${path} at the PR's ${version ?? "head"}.`);
        return text(content);
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    "get_existing_comments",
    {
      description: "What's already been said on the PR - reviews, comments and inline threads - so findings don't repeat it.",
      inputSchema: { pr: prArg },
    },
    async ({ pr }) => {
      try {
        const { owner, repo, number } = parsePr(pr);
        return text(conversationText(await fetchPrConversation(owner, repo, number)));
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    "submit_finding",
    {
      description:
        "Record one review finding. It appears in Docent for the reviewer to keep or drop. Give the file and new-file line numbers from get_diff (they must be lines in the diff) - the few lines the point is actually about, not the whole block around them - or leave the lines out to comment on the whole file, or leave both out for the PR as a whole.",
      inputSchema: {
        pr: prArg,
        body: z
          .string()
          .describe('The comment, addressed to the PR\'s author. A sentence or two; code in backticks. Start a minor point with "Nit: ".'),
        rationale: z
          .string()
          .optional()
          .describe(
            "For the reviewer deciding whether to post it - the author never sees it: why it matters, what in the code shows it, and how sure you are.",
          ),
        path: z.string().optional(),
        start_line: z.number().int().optional(),
        end_line: z.number().int().optional().describe("For a finding spanning several lines."),
        reviewer: reviewerArg,
      },
    },
    async ({ pr, body, rationale, path, start_line, end_line, reviewer }) => {
      try {
        const { owner, repo, number } = parsePr(pr);
        await submitFinding(
          owner,
          repo,
          number,
          { body, rationale, path, startLine: start_line, endLine: end_line },
          undefined,
          resolveReviewer(owner, repo, number, reviewer),
        );
        return text("Recorded.");
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    "finish_review",
    {
      description: "Call once every finding has been submitted, to tell Docent the review is complete.",
      inputSchema: { pr: prArg, reviewer: reviewerArg },
    },
    async ({ pr, reviewer }) => {
      try {
        const { owner, repo, number } = parsePr(pr);
        const review = finishAgentReview(owner, repo, number, resolveReviewer(owner, repo, number, reviewer));
        const count = review?.findings.length ?? 0;
        return text(review ? `Done: ${count} ${count === 1 ? "finding" : "findings"} recorded.` : "No review was in progress.");
      } catch (err) {
        return failure(err);
      }
    },
  );

  // Prompts, which clients like Claude Code offer as commands: one to review
  // a PR your usual way and send the findings here, one to send findings
  // from a review you've already done.
  const findingFormat = (reviewer: string | undefined) => `For each finding, call submit_finding with${reviewer ? ` reviewer "${reviewer}" and` : ""}:
- body: the comment for the PR's author - a sentence or two, specific, with a suggestion where there is one. Start a minor point with "Nit: ".
- rationale: for the reviewer deciding whether to post it (the author never sees it) - why it matters, what in the code shows it, and how sure you are.
- path, start_line and end_line: the few lines the point is about, as new-file line numbers from get_diff. Leave the lines out for a point about a whole file, and the path too for the PR as a whole.
If submit_finding rejects the lines, it lists the lines that are in the diff; pick from those. When every finding is in, call finish_review${reviewer ? ` with reviewer "${reviewer}"` : ""}.`;

  server.registerPrompt(
    "review",
    {
      description: "Review a PR your usual way, and send the findings to Docent.",
      argsSchema: {
        pr: z.string().describe("The pull request, as owner/repo#123 or its GitHub URL."),
        reviewer: z.string().optional().describe("Which agent reviewer in Docent to send the findings to, e.g. agent-2. Optional when only one is waiting."),
      },
    },
    ({ pr, reviewer }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Review the pull request ${pr} the way you usually review code: your own review skills, conventions and judgement, reading the repository wherever that helps. Docent's tools give you its context - start with get_review_context, read the diff with get_diff, and check get_existing_comments so you don't repeat what's already been said. Report real problems the author should act on or answer, not observations that the code is fine.

${findingFormat(reviewerFrom(reviewer))}`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "submit",
    {
      description: "Send the findings from a review you've already done in this conversation to Docent.",
      argsSchema: {
        pr: z.string().describe("The pull request, as owner/repo#123 or its GitHub URL."),
        reviewer: z.string().optional().describe("Which agent reviewer in Docent to send the findings to, e.g. agent-2. Optional when only one is waiting."),
      },
    },
    ({ pr, reviewer }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Send the review findings from this conversation so far to Docent, for the pull request ${pr}. Don't review it again: take the findings as they are, one submit_finding call each, using get_diff to find the right line numbers.

${findingFormat(reviewerFrom(reviewer))}`,
          },
        },
      ],
    }),
  );

  return server;
}

export async function handleMcpRequest(req: Request, res: Response) {
  const server = buildServer();
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await transport.handleRequest(req, res, req.body);
  } catch {
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
}
