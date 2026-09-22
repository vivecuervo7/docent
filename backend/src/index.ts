import express from "express";
import { fetchFileContentAtRef, fetchPrBaseSha, fetchPrFiles } from "./github.js";
import { readReviewState, setHunksReviewed } from "./reviewStore.js";
import { generateIdeas } from "./ideas.js";
import { readIdeas, writeIdeas } from "./ideaStore.js";

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
    const files = await fetchPrFiles(owner, repo, number);
    res.json({ files });
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

app.get("/api/review/:owner/:repo/:number", async (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }

  const state = await readReviewState(owner, repo, number);
  res.json(state);
});

app.post("/api/review/:owner/:repo/:number", async (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }

  const { keys, reviewed } = req.body as { keys?: string[]; reviewed?: boolean };
  if (!Array.isArray(keys) || !keys.every((k) => typeof k === "string") || typeof reviewed !== "boolean") {
    return res.status(400).json({ error: "expected { keys: string[], reviewed: boolean }" });
  }

  const state = await setHunksReviewed(owner, repo, number, keys, reviewed);
  res.json(state);
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

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`codetour-pr backend listening on http://localhost:${PORT}`);
});
