import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// What people have said on the PR on GitHub, for showing beside the code:
// inline threads with where they sit, and what was said on the PR as a
// whole. Kept apart from the conversation the models summarise, which
// doesn't need lines.

export interface GitHubEntry {
  author: string;
  // Their GitHub avatar's address.
  avatar?: string;
  body: string;
  createdAt: string;
}

export interface GitHubThread {
  id: string;
  path: string;
  // Where it sits at the PR's head; none once the lines it was left on have
  // changed (GitHub calls it outdated), or for a comment on a whole file.
  start?: { side: "old" | "new"; line: number };
  end?: { side: "old" | "new"; line: number };
  outdated: boolean;
  // The lines it was left on, as the code was then, and the commit it was.
  originalStartLine?: number;
  originalLine?: number;
  commit?: string;
  // The lines it was left on, as GitHub shows them: the diff up to them.
  diffHunk?: string;
  entries: GitHubEntry[];
  // GitHub's id for the thread, which resolving it takes, and whether it is.
  node?: string;
  resolved?: boolean;
}

export interface GitHubComments {
  threads: GitHubThread[];
  // Review bodies and comments on the PR as a whole.
  general: (GitHubEntry & { id: string; state?: string })[];
}

interface RawInline {
  id: number;
  in_reply_to_id?: number;
  user: { login?: string; avatar_url?: string } | null;
  path: string;
  body: string;
  created_at: string;
  line: number | null;
  start_line: number | null;
  side: "LEFT" | "RIGHT" | null;
  start_side: "LEFT" | "RIGHT" | null;
  original_line: number | null;
  original_start_line?: number | null;
  original_commit_id?: string;
  diff_hunk?: string;
  subject_type?: "line" | "file";
}

const gh = async <T>(path: string): Promise<T> =>
  JSON.parse((await execFileAsync("gh", ["api", "--paginate", path], { maxBuffer: 64 * 1024 * 1024 })).stdout) as T;

// Each inline thread's GitHub id and whether it's resolved, by the id of
// its first comment: only GitHub's GraphQL API says.
async function threadStates(owner: string, repo: string, number: string): Promise<Map<number, { node: string; resolved: boolean }>> {
  const states = new Map<number, { node: string; resolved: boolean }>();
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const query = `query($owner: String!, $repo: String!, $number: Int!, $after: String) {
      repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
        reviewThreads(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id isResolved comments(first: 1) { nodes { databaseId } } }
        } } } }`;
    const args = ["api", "graphql", "-f", `query=${query}`, "-F", `owner=${owner}`, "-F", `repo=${repo}`, "-F", `number=${number}`];
    if (after) args.push("-F", `after=${after}`);
    const { stdout } = await execFileAsync("gh", args, { maxBuffer: 16 * 1024 * 1024 });
    const threads = JSON.parse(stdout).data?.repository?.pullRequest?.reviewThreads;
    for (const t of threads?.nodes ?? []) {
      const first = t.comments?.nodes?.[0]?.databaseId;
      if (first) states.set(first, { node: t.id, resolved: t.isResolved });
    }
    if (!threads?.pageInfo?.hasNextPage) break;
    after = threads.pageInfo.endCursor;
  }
  return states;
}

// Replies to, resolves or reopens inline threads on GitHub, by their GitHub
// ids, as the reviewer does it. Each is tried on its own, so one GitHub
// refuses doesn't stop the rest. A reply goes first, by the id of the
// thread's first comment.
export async function changeThreads(
  ref: { owner: string; repo: string; number: string },
  changes: { node: string; resolved?: boolean; reply?: { comment: number; body: string } }[],
): Promise<{ node: string; error?: string }[]> {
  return Promise.all(
    changes.map(async ({ node, resolved, reply }) => {
      try {
        if (reply) {
          await execFileAsync("gh", [
            "api",
            "--method",
            "POST",
            `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/comments/${reply.comment}/replies`,
            "-f",
            `body=${reply.body}`,
          ]);
        }
        if (resolved !== undefined) {
          const mutation = resolved
            ? "mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { id } } }"
            : "mutation($id: ID!) { unresolveReviewThread(input: { threadId: $id }) { thread { id } } }";
          await execFileAsync("gh", ["api", "graphql", "-f", `query=${mutation}`, "-F", `id=${node}`]);
        }
        return { node };
      } catch (err) {
        const out = (err as { stdout?: string; stderr?: string }).stdout || (err as { stderr?: string }).stderr || (err as Error).message;
        return { node, error: String(out).trim().slice(0, 300) };
      }
    }),
  );
}

export async function fetchGitHubComments(owner: string, repo: string, number: string): Promise<GitHubComments> {
  const [inline, reviews, issueComments, states] = await Promise.all([
    gh<RawInline[]>(`repos/${owner}/${repo}/pulls/${number}/comments?per_page=100`),
    gh<{ id: number; user: { login?: string } | null; body: string | null; state: string; submitted_at: string | null }[]>(
      `repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`,
    ),
    gh<{ id: number; user: { login?: string } | null; body: string | null; created_at: string }[]>(
      `repos/${owner}/${repo}/issues/${number}/comments?per_page=100`,
    ),
    // Without it, threads show without their state, and can't be resolved here.
    threadStates(owner, repo, number).catch(() => new Map<number, { node: string; resolved: boolean }>()),
  ]);
  const login = (user: { login?: string } | null) => user?.login ?? "unknown";
  const side = (s: "LEFT" | "RIGHT" | null) => (s === "LEFT" ? ("old" as const) : ("new" as const));

  // GitHub points every reply at the thread's first comment.
  const byRoot = new Map<number, GitHubThread>();
  for (const c of [...inline].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const root = c.in_reply_to_id ?? c.id;
    let thread = byRoot.get(root);
    if (!thread) {
      const placed = c.line !== null && c.subject_type !== "file";
      thread = {
        id: `t${root}`,
        path: c.path,
        outdated: c.line === null && c.subject_type !== "file",
        ...(c.original_line !== null ? { originalLine: c.original_line } : {}),
        ...(c.original_start_line ? { originalStartLine: c.original_start_line } : {}),
        ...(c.original_commit_id ? { commit: c.original_commit_id } : {}),
        ...(c.diff_hunk ? { diffHunk: c.diff_hunk } : {}),
        ...(placed
          ? {
              start: { side: side(c.start_side ?? c.side), line: c.start_line ?? c.line! },
              end: { side: side(c.side), line: c.line! },
            }
          : {}),
        entries: [],
        ...(states.get(root) ?? {}),
      };
      byRoot.set(root, thread);
    }
    thread.entries.push({ author: login(c.user), ...(c.user?.avatar_url ? { avatar: c.user.avatar_url } : {}), body: c.body, createdAt: c.created_at });
  }

  const general = [
    ...reviews
      .filter((r) => r.body)
      .map((r) => ({ id: `r${r.id}`, author: login(r.user), body: r.body!, createdAt: r.submitted_at ?? "", state: r.state })),
    ...issueComments
      .filter((c) => c.body)
      .map((c) => ({ id: `c${c.id}`, author: login(c.user), body: c.body!, createdAt: c.created_at })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return { threads: [...byRoot.values()], general };
}
