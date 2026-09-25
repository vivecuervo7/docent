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
  author?: string;
}

export async function fetchPrMeta(owner: string, repo: string, number: string): Promise<PrMeta> {
  const { stdout } = await execFileAsync("gh", [
    "api",
    `repos/${owner}/${repo}/pulls/${number}`,
    "--jq",
    "{title: .title, body: .body, htmlUrl: .html_url, author: .user.login}",
  ]);

  return JSON.parse(stdout) as PrMeta;
}

export interface ConversationEntry {
  author: string;
  body: string;
  createdAt: string;
}

export interface ReviewEntry extends ConversationEntry {
  state: string;
}

export interface InlineThread {
  path: string;
  entries: ConversationEntry[];
}

// Everything said on the PR, keeping enough structure (who the PR author is,
// when things were said, which inline replies belong together) for the model
// to tell a reviewer's point from the author's response to it.
export interface PrConversation {
  prAuthor: string;
  reviews: ReviewEntry[];
  comments: ConversationEntry[];
  threads: InlineThread[];
}

interface RawUser {
  login?: string;
}

interface RawReview {
  user: RawUser | null;
  body: string | null;
  state: string;
  submitted_at: string | null;
}

interface RawInlineComment {
  id: number;
  in_reply_to_id?: number;
  user: RawUser | null;
  path: string;
  body: string;
  created_at: string;
}

interface RawIssueComment {
  user: RawUser | null;
  body: string | null;
  created_at: string;
}

export async function fetchPrConversation(
  owner: string,
  repo: string,
  number: string,
): Promise<PrConversation> {
  const [prAuthorRes, reviewsRes, inlineRes, issueCommentsRes] = await Promise.all([
    execFileAsync("gh", ["api", `repos/${owner}/${repo}/pulls/${number}`, "--jq", ".user.login"]),
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

  const rawReviews = JSON.parse(reviewsRes.stdout) as RawReview[];
  const rawInline = JSON.parse(inlineRes.stdout) as RawInlineComment[];
  const rawIssueComments = JSON.parse(issueCommentsRes.stdout) as RawIssueComment[];
  const login = (user: RawUser | null) => user?.login ?? "unknown";

  // A bare "commented" review with no body is just the envelope GitHub
  // creates around inline comments, which are captured in threads instead.
  const reviews: ReviewEntry[] = rawReviews
    .filter((r) => r.body || (r.state !== "COMMENTED" && r.state !== "PENDING"))
    .map((r) => ({
      author: login(r.user),
      body: r.body ?? "",
      state: r.state,
      createdAt: r.submitted_at ?? "",
    }));

  // GitHub points every reply at the thread's first comment, so the root id
  // groups a whole inline thread.
  const threadsByRoot = new Map<number, InlineThread>();
  for (const c of [...rawInline].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const root = c.in_reply_to_id ?? c.id;
    if (!threadsByRoot.has(root)) threadsByRoot.set(root, { path: c.path, entries: [] });
    threadsByRoot.get(root)!.entries.push({
      author: login(c.user),
      body: c.body,
      createdAt: c.created_at,
    });
  }

  const comments: ConversationEntry[] = rawIssueComments
    .filter((c) => c.body)
    .map((c) => ({ author: login(c.user), body: c.body ?? "", createdAt: c.created_at }));

  return {
    prAuthor: prAuthorRes.stdout.trim(),
    reviews,
    comments,
    threads: [...threadsByRoot.values()],
  };
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

export async function fetchPrHeadSha(
  owner: string,
  repo: string,
  number: string,
): Promise<string> {
  const { stdout } = await execFileAsync("gh", [
    "api",
    `repos/${owner}/${repo}/pulls/${number}`,
    "--jq",
    ".head.sha",
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

// An open PR the reviewer is part of: asked to review it, has reviewed it,
// or wrote it.
export interface InvolvedPr {
  owner: string;
  repo: string;
  number: string;
  title: string;
  url: string;
  author?: string;
  updatedAt: string;
  createdAt: string;
  isDraft: boolean;
  // GitHub's verdict so far, and each reviewer's latest review.
  decision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  reviews: { state: string; author?: string }[];
  mine: boolean;
}

const PR_FIELDS = `number title url updatedAt createdAt isDraft
        repository { nameWithOwner }
        author { login }
        reviewDecision
        latestReviews(first: 20) { nodes { state author { login } } }`;

// Open PRs the reviewer is asked to review by name (not through a team),
// has reviewed, or wrote - one query, three searches.
export async function fetchInvolvedPrs(): Promise<InvolvedPr[]> {
  const search = (q: string) => `search(query: "${q} archived:false", type: ISSUE, first: 50) { nodes { ... on PullRequest { ${PR_FIELDS} } } }`;
  const query = `query {
    requested: ${search("is:pr is:open user-review-requested:@me")}
    reviewed: ${search("is:pr is:open reviewed-by:@me")}
    mine: ${search("is:pr is:open author:@me")}
  }`;
  const { stdout } = await execFileAsync("gh", ["api", "graphql", "-f", `query=${query}`]);
  type Node = {
    number: number;
    title: string;
    url: string;
    updatedAt: string;
    createdAt: string;
    isDraft: boolean;
    repository: { nameWithOwner: string };
    author: { login: string } | null;
    reviewDecision: InvolvedPr["decision"];
    latestReviews: { nodes: { state: string; author: { login: string } | null }[] };
  };
  const data = JSON.parse(stdout).data ?? {};
  const byKey = new Map<string, InvolvedPr>();
  for (const [group, mine] of [["requested", false], ["reviewed", false], ["mine", true]] as const) {
    for (const n of (data[group]?.nodes ?? []) as Node[]) {
      if (!n?.repository) continue;
      const [owner, repo] = n.repository.nameWithOwner.split("/");
      const key = `${owner}/${repo}/${n.number}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.mine ||= mine;
        continue;
      }
      byKey.set(key, {
        owner,
        repo,
        number: String(n.number),
        title: n.title,
        url: n.url,
        author: n.author?.login,
        updatedAt: n.updatedAt,
        createdAt: n.createdAt,
        isDraft: n.isDraft,
        decision: n.reviewDecision,
        reviews: n.latestReviews.nodes.map((r) => ({ state: r.state, author: r.author?.login })),
        mine,
      });
    }
  }
  return [...byKey.values()];
}

export interface PrStatus {
  owner: string;
  repo: string;
  number: string;
  head: string;
  createdAt: string;
  author?: string;
  state: "OPEN" | "CLOSED" | "MERGED";
}

// Where several PRs stand on GitHub now, in one query: for the start page,
// to order by when each was raised and tell which have had new commits.
export async function fetchPrStatuses(prs: { owner: string; repo: string; number: string }[]): Promise<PrStatus[]> {
  if (!prs.length) return [];
  const fields = prs
    .map(
      (pr, i) =>
        `p${i}: repository(owner: ${JSON.stringify(pr.owner)}, name: ${JSON.stringify(pr.repo)}) { pullRequest(number: ${Number(pr.number)}) { headRefOid createdAt state author { login } } }`,
    )
    .join("\n");
  const { stdout } = await execFileAsync("gh", ["api", "graphql", "-f", `query=query { ${fields} }`]).catch((err) => {
    // A PR that's gone or out of reach fails the whole query; its partial
    // data still comes back on stdout.
    if (err?.stdout) return { stdout: err.stdout as string };
    throw err;
  });
  const data = (JSON.parse(stdout).data ?? {}) as Record<
    string,
    { pullRequest: { headRefOid: string; createdAt: string; state: PrStatus["state"]; author: { login: string } | null } | null } | null
  >;
  return prs.flatMap((pr, i) => {
    const found = data[`p${i}`]?.pullRequest;
    return found
      ? [{ ...pr, head: found.headRefOid, createdAt: found.createdAt, author: found.author?.login, state: found.state }]
      : [];
  });
}
