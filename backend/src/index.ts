import express from "express";
import {
  fetchAttachment,
  fetchPrConversation,
  fetchFileContentAtRef,
  fetchPrBaseSha,
  fetchPrFiles,
  fetchPrMeta,
} from "./github.js";
import {
  dismissGeneration,
  getGeneration,
  listGenerations,
  startGeneration,
  stopGeneration,
  type Reuse,
} from "./generation.js";
import { localhostHostValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import {
  dismissAgentReview,
  finishAgentReview,
  getAgentReview,
  openExternalReview,
  startBuiltinReview,
  stopAgentReview,
  type ReviewContext,
} from "./agentReview.js";
import { draftYourFeedback, type ThreadForFeedback } from "./feedback.js";
import { modelName, setModelName } from "./config.js";
import { handleMcpRequest } from "./mcp.js";
import { deleteRecord, getRecord, keyFor, listRecords, putRecord, VersionConflict } from "./store.js";
import { listModels } from "./modelProvider.js";
import {
  buildReviewPayload,
  fetchViewer,
  findReviewSince,
  postReviewPayload,
  prepareReview,
  type Candidate,
  type CommentToPost,
  type ReviewEvent,
} from "./postReview.js";
import { replyToNote, type NoteContext, type NoteMessage } from "./notes.js";
import type { ConversationSummary, Slice } from "./types.js";

const app = express();
// Whole review records come through here, so allow more than the default.
app.use(express.json({ limit: "20mb" }));

const OWNER_REPO_RE = /^[A-Za-z0-9._-]+$/;
const NUMBER_RE = /^[0-9]+$/;

function validParams(owner: string, repo: string, number: string): boolean {
  return (
    OWNER_REPO_RE.test(owner) && OWNER_REPO_RE.test(repo) && NUMBER_RE.test(number)
  );
}

app.get("/api/pr/:owner/:repo/:number", async (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }

  try {
    const [files, meta] = await Promise.all([
      fetchPrFiles(owner, repo, number),
      fetchPrMeta(owner, repo, number),
    ]);
    res.json({ files, meta });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.get("/api/attachment", async (req, res) => {
  const { url } = req.query;
  if (typeof url !== "string" || !url) {
    return res.status(400).json({ error: "missing url" });
  }

  try {
    const attachment = await fetchAttachment(url);
    if (!attachment) return res.status(404).end();
    res.setHeader("Content-Type", attachment.contentType);
    res.send(attachment.body);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.get("/api/pr/:owner/:repo/:number/old-content", async (req, res) => {
  const { owner, repo, number } = req.params;
  const { path } = req.query;
  if (!validParams(owner, repo, number) || typeof path !== "string" || !path) {
    return res.status(400).json({ error: "invalid owner, repo, number, or path" });
  }

  try {
    const baseSha = await fetchPrBaseSha(owner, repo, number);
    const content = await fetchFileContentAtRef(owner, repo, baseSha, path);
    res.json({ content });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// Preparing a PR's review (slices, conversation, summary) runs as a
// background generation; see generation.ts.
app.get("/api/generations", (_req, res) => {
  res.json({ generations: listGenerations() });
});

app.post("/api/pr/:owner/:repo/:number/generation", (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }

  const reuse: Reuse = {};
  if (Array.isArray(req.body?.reuse?.slices)) reuse.slices = req.body.reuse.slices as Slice[];
  if (Array.isArray(req.body?.reuse?.conversation?.reviewers)) {
    reuse.conversation = req.body.reuse.conversation as ConversationSummary;
  }
  res.json({ generation: startGeneration(owner, repo, number, reuse) });
});

app.get("/api/pr/:owner/:repo/:number/generation", (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }
  res.json({ generation: getGeneration(owner, repo, number) });
});

app.post("/api/pr/:owner/:repo/:number/generation/stop", (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }
  res.json({ generation: stopGeneration(owner, repo, number) });
});

app.delete("/api/pr/:owner/:repo/:number/generation", (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }
  dismissGeneration(owner, repo, number);
  res.status(204).end();
});

// Answers a question (or writes up a remark) about lines the reviewer
// selected. Held open until the model replies; see notes.ts for the lane.
app.post("/api/pr/:owner/:repo/:number/notes/reply", async (req, res) => {
  const { owner, repo, number } = req.params;
  const context = req.body?.context as NoteContext | undefined;
  const messages = req.body?.messages as NoteMessage[] | undefined;
  if (
    !validParams(owner, repo, number) ||
    typeof context?.path !== "string" ||
    typeof context?.code !== "string" ||
    !Array.isArray(messages) ||
    messages.length === 0
  ) {
    return res.status(400).json({ error: "invalid note" });
  }

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    res.json({ text: await replyToNote(context, messages, controller.signal) });
  } catch (err) {
    if (!controller.signal.aborted) res.status(502).json({ error: (err as Error).message });
  }
});

// Drafts review comments from the reviewer's threads. Held open like a note
// reply, in the same lane.
app.post("/api/pr/:owner/:repo/:number/feedback/yours", async (req, res) => {
  const { owner, repo, number } = req.params;
  const threads = req.body?.threads as ThreadForFeedback[] | undefined;
  if (!validParams(owner, repo, number) || !Array.isArray(threads) || threads.length === 0) {
    return res.status(400).json({ error: "invalid threads" });
  }

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    const prTitle = typeof req.body?.prTitle === "string" ? req.body.prTitle : undefined;
    res.json({ comments: await draftYourFeedback(threads, prTitle, controller.signal) });
  } catch (err) {
    if (!controller.signal.aborted) res.status(502).json({ error: (err as Error).message });
  }
});

// The agent review: Docent's own reviewer ("builtin"), or waiting for the
// reviewer's own agent to submit findings over MCP ("external").
app.post("/api/pr/:owner/:repo/:number/agent-review", (req, res) => {
  const { owner, repo, number } = req.params;
  const mode = req.body?.mode;
  if (!validParams(owner, repo, number) || (mode !== "builtin" && mode !== "external")) {
    return res.status(400).json({ error: "invalid PR or mode" });
  }
  const context: ReviewContext = {
    title: typeof req.body?.context?.title === "string" ? req.body.context.title : undefined,
    summary: req.body?.context?.summary ?? null,
    slices: Array.isArray(req.body?.context?.slices) ? (req.body.context.slices as Slice[]) : null,
  };
  const review =
    mode === "builtin"
      ? startBuiltinReview(owner, repo, number, context)
      : openExternalReview(owner, repo, number, context);
  res.json({ review });
});

app.get("/api/pr/:owner/:repo/:number/agent-review", (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }
  res.json({ review: getAgentReview(owner, repo, number) });
});

app.post("/api/pr/:owner/:repo/:number/agent-review/:action", (req, res) => {
  const { owner, repo, number, action } = req.params;
  if (!validParams(owner, repo, number) || (action !== "stop" && action !== "finish")) {
    return res.status(400).json({ error: "invalid PR or action" });
  }
  const review =
    action === "stop" ? stopAgentReview(owner, repo, number) : finishAgentReview(owner, repo, number);
  res.json({ review });
});

app.delete("/api/pr/:owner/:repo/:number/agent-review", (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }
  dismissAgentReview(owner, repo, number);
  res.status(204).end();
});

// Post review: who's reviewing (GitHub won't let you approve or request
// changes on your own PR), preparing the review, and posting it.
app.get("/api/pr/:owner/:repo/:number/review/viewer", async (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }
  try {
    const [viewer, author] = await Promise.all([
      fetchViewer(),
      fetchPrConversation(owner, repo, number).then((c) => c.prAuthor),
    ]);
    res.json({ viewer, author });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.post("/api/pr/:owner/:repo/:number/review/prepare", async (req, res) => {
  const { owner, repo, number } = req.params;
  const candidates = req.body?.candidates as Candidate[] | undefined;
  if (!validParams(owner, repo, number) || !Array.isArray(candidates)) {
    return res.status(400).json({ error: "invalid candidates" });
  }
  if (candidates.length === 0) return res.json({ comments: [], dropped: [], body: "", inBody: [] });

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    res.json(await prepareReview(owner, repo, number, candidates, controller.signal));
  } catch (err) {
    if (!controller.signal.aborted) res.status(502).json({ error: (err as Error).message });
  }
});

app.get("/api/pr/:owner/:repo/:number/review/posted-since", async (req, res) => {
  const { owner, repo, number } = req.params;
  const since = Number(req.query.since);
  if (!validParams(owner, repo, number) || !Number.isFinite(since)) {
    return res.status(400).json({ error: "invalid PR or time" });
  }
  try {
    res.json({ url: await findReviewSince(owner, repo, number, since) });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// With dryRun, returns exactly what would be sent without sending it.
app.post("/api/pr/:owner/:repo/:number/review/post", async (req, res) => {
  const { owner, repo, number } = req.params;
  const event = req.body?.event as ReviewEvent | undefined;
  const comments = req.body?.comments as CommentToPost[] | undefined;
  if (
    !validParams(owner, repo, number) ||
    (event !== "COMMENT" && event !== "APPROVE" && event !== "REQUEST_CHANGES") ||
    !Array.isArray(comments)
  ) {
    return res.status(400).json({ error: "invalid review" });
  }
  try {
    const summary = typeof req.body?.summary === "string" ? req.body.summary : "";
    const payload = await buildReviewPayload(owner, repo, number, event, summary, comments);
    if (req.body?.dryRun) return res.json({ payload });
    res.json({ payload, ...(await postReviewPayload(owner, repo, number, payload)) });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// MCP, for the reviewer's own agent. Local only: the host check stops other
// sites the browser has open from reaching it.
app.post("/mcp", localhostHostValidation(), handleMcpRequest);
app.all("/mcp", (_req, res) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
});

// The models the endpoint offers, and which one Docent uses.
app.get("/api/models", async (_req, res) => {
  try {
    res.json({ models: await listModels(), selected: modelName() });
  } catch (err) {
    res.json({ models: [], selected: modelName(), error: (err as Error).message });
  }
});

app.put("/api/models/selected", (req, res) => {
  const model = req.body?.model;
  if (typeof model !== "string" || !model.trim()) {
    return res.status(400).json({ error: "invalid model" });
  }
  setModelName(model.trim());
  res.json({ selected: modelName() });
});

// Saved reviews: one record per PR, owned here rather than in the browser so
// agents can read and write them too. See store.ts.
app.get("/api/prs", (_req, res) => {
  res.json({
    prs: listRecords().flatMap(({ key, record }) => {
      const [owner, repo, number] = key.split("/");
      return owner && repo && number ? [{ owner, repo, number, record }] : [];
    }),
  });
});

app.get("/api/prs/:owner/:repo/:number", (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }
  res.json(getRecord(keyFor(owner, repo, number)));
});

// The version is the one the change was made from; a stale one gets a 409
// with the record as it is now, to redo the change on.
app.put("/api/prs/:owner/:repo/:number", (req, res) => {
  const { owner, repo, number } = req.params;
  const { record, version } = req.body ?? {};
  if (
    !validParams(owner, repo, number) ||
    typeof record !== "object" ||
    record === null ||
    !Number.isInteger(version)
  ) {
    return res.status(400).json({ error: "invalid record" });
  }
  try {
    res.json({ version: putRecord(keyFor(owner, repo, number), record, version) });
  } catch (err) {
    if (err instanceof VersionConflict) return res.status(409).json(err.current);
    throw err;
  }
});

app.delete("/api/prs/:owner/:repo/:number", (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }
  deleteRecord(keyFor(owner, repo, number));
  res.status(204).end();
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`docent backend listening on http://localhost:${PORT}`);
});
