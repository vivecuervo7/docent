import express from "express";
import {
  fetchAttachment,
  fetchFileContentAtRef,
  fetchPrBaseSha,
  fetchPrConversation,
  fetchPrFiles,
  fetchPrMeta,
} from "./github.js";
import { generateIdeas } from "./ideas.js";
import { readIdeas, writeIdeas } from "./ideaStore.js";
import { generateConversationCards, generateSummary } from "./overview.js";
import { readOverview, saveConversation, saveSummary } from "./overviewStore.js";

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

app.get("/api/pr/:owner/:repo/:number/ideas", async (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }

  const state = await readIdeas(owner, repo, number);
  res.json(state ?? { ideas: null });
});

app.post("/api/pr/:owner/:repo/:number/ideas", async (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }

  try {
    const files = await fetchPrFiles(owner, repo, number);
    const ideas = await generateIdeas(files);
    const state = await writeIdeas(owner, repo, number, ideas);
    res.json(state);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.get("/api/pr/:owner/:repo/:number/overview", async (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }

  const state = await readOverview(owner, repo, number);
  res.json(state);
});

app.post("/api/pr/:owner/:repo/:number/overview/summary", async (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }

  try {
    const [meta, ideasState] = await Promise.all([
      fetchPrMeta(owner, repo, number),
      readIdeas(owner, repo, number),
    ]);
    const summary = await generateSummary(meta, ideasState?.ideas ?? []);
    const state = await saveSummary(owner, repo, number, summary);
    res.json(state);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.post("/api/pr/:owner/:repo/:number/overview/conversation", async (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }

  try {
    const items = await fetchPrConversation(owner, repo, number);
    const cards = await generateConversationCards(items);
    const state = await saveConversation(owner, repo, number, cards);
    res.json(state);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`codetour-pr backend listening on http://localhost:${PORT}`);
});
