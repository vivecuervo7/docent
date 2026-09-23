import express from "express";
import {
  fetchAttachment,
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
import { draftYourFeedback, runAgentReview, type ThreadForFeedback } from "./feedback.js";
import { replyToNote, type NoteContext, type NoteMessage } from "./notes.js";
import type { ConversationSummary, Slice } from "./types.js";

const app = express();
app.use(express.json());

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

app.post("/api/pr/:owner/:repo/:number/feedback/agent", async (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }
  res.json({ comments: await runAgentReview() });
});

app.post("/api/debug/pr-state", (req, res) => {
  if (process.env.NODE_ENV !== "production") {
    console.log("[pr-state]", JSON.stringify(req.body, null, 2));
  }
  res.status(204).end();
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`docent backend listening on http://localhost:${PORT}`);
});
