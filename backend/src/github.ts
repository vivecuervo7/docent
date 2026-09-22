import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ATTACHMENT_URL_RE = /^https:\/\/github\.com\/user-attachments\//;

// github.com/user-attachments URLs 302 to a presigned, short-lived S3 URL
// and require an authenticated GitHub session to resolve at all - a plain
// cross-origin <img> tag never sends that session cookie (SameSite=Lax,
// blocked on subresource loads), so these need fetching server-side where
// `gh` is already authenticated, then served from our own origin.
export async function fetchAttachment(
  url: string,
): Promise<{ contentType: string; body: Buffer } | null> {
  if (!ATTACHMENT_URL_RE.test(url)) return null;

  const { stdout: tokenOut } = await execFileAsync("gh", ["auth", "token"]);
  const token = tokenOut.trim();

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;

  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const body = Buffer.from(await res.arrayBuffer());
  return { contentType, body };
}

export interface PrFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export async function fetchPrFiles(
  owner: string,
  repo: string,
  number: string,
): Promise<PrFile[]> {
  const { stdout } = await execFileAsync("gh", [
    "api",
    "--paginate",
    `repos/${owner}/${repo}/pulls/${number}/files?per_page=100`,
  ]);

  return JSON.parse(stdout) as PrFile[];
}

export interface PrMeta {
  title: string;
  body: string | null;
  htmlUrl: string;
}

export async function fetchPrMeta(owner: string, repo: string, number: string): Promise<PrMeta> {
  const { stdout } = await execFileAsync("gh", [
    "api",
    `repos/${owner}/${repo}/pulls/${number}`,
    "--jq",
    "{title: .title, body: .body, htmlUrl: .html_url}",
  ]);

  return JSON.parse(stdout) as PrMeta;
}

export interface ConversationItem {
  kind: "review" | "comment";
  author: string;
  body: string;
  state?: string;
  inlineComments?: { path: string; body: string }[];
}

interface RawReview {
  id: number;
  user: { login?: string } | null;
  body: string | null;
  state: string;
}

interface RawInlineComment {
  pull_request_review_id: number | null;
  path: string;
  body: string;
}

interface RawIssueComment {
  user: { login?: string } | null;
  body: string | null;
}

export async function fetchPrConversation(
  owner: string,
  repo: string,
  number: string,
): Promise<ConversationItem[]> {
  const [reviewsRes, inlineRes, issueCommentsRes] = await Promise.all([
    execFileAsync("gh", [
      "api",
      "--paginate",
      `repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`,
    ]),
    execFileAsync("gh", [
      "api",
      "--paginate",
      `repos/${owner}/${repo}/pulls/${number}/comments?per_page=100`,
    ]),
    execFileAsync("gh", [
      "api",
      "--paginate",
      `repos/${owner}/${repo}/issues/${number}/comments?per_page=100`,
    ]),
  ]);

  const reviews = JSON.parse(reviewsRes.stdout) as RawReview[];
  const inline = JSON.parse(inlineRes.stdout) as RawInlineComment[];
  const issueComments = JSON.parse(issueCommentsRes.stdout) as RawIssueComment[];

  const inlineByReview = new Map<number, { path: string; body: string }[]>();
  for (const c of inline) {
    if (c.pull_request_review_id == null) continue;
    if (!inlineByReview.has(c.pull_request_review_id)) {
      inlineByReview.set(c.pull_request_review_id, []);
    }
    inlineByReview.get(c.pull_request_review_id)!.push({ path: c.path, body: c.body });
  }

  const items: ConversationItem[] = [];

  for (const r of reviews) {
    const inlineForThis = inlineByReview.get(r.id) ?? [];
    if (!r.body && inlineForThis.length === 0) continue;
    items.push({
      kind: "review",
      author: r.user?.login ?? "unknown",
      body: r.body ?? "",
      state: r.state,
      inlineComments: inlineForThis.length > 0 ? inlineForThis : undefined,
    });
  }

  for (const c of issueComments) {
    if (!c.body) continue;
    items.push({ kind: "comment", author: c.user?.login ?? "unknown", body: c.body });
  }

  return items;
}

export async function fetchPrBaseSha(
  owner: string,
  repo: string,
  number: string,
): Promise<string> {
  const { stdout } = await execFileAsync("gh", [
    "api",
    `repos/${owner}/${repo}/pulls/${number}`,
    "--jq",
    ".base.sha",
  ]);

  return stdout.trim();
}

export async function fetchFileContentAtRef(
  owner: string,
  repo: string,
  ref: string,
  path: string,
): Promise<string | null> {
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  try {
    const { stdout } = await execFileAsync("gh", [
      "api",
      `repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
    ]);

    const data = JSON.parse(stdout) as { content?: string; encoding?: string };
    if (!data.content) return null;

    return Buffer.from(data.content, data.encoding === "base64" ? "base64" : "utf-8").toString(
      "utf-8",
    );
  } catch {
    return null;
  }
}
