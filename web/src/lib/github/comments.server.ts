import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// What people have said on the PR on GitHub, for showing beside the code:
// inline threads with where they sit, and what was said on the PR as a
// whole. Kept apart from the conversation the models summarise, which
// doesn't need lines.

export interface GitHubEntry {
  author: string;
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
  entries: GitHubEntry[];
}

export interface GitHubComments {
  threads: GitHubThread[];
  // Review bodies and comments on the PR as a whole.
  general: (GitHubEntry & { id: string; state?: string })[];
}

interface RawInline {
  id: number;
  in_reply_to_id?: number;
  user: { login?: string } | null;
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
  subject_type?: "line" | "file";
}

const gh = async <T>(path: string): Promise<T> =>
  JSON.parse((await execFileAsync("gh", ["api", "--paginate", path], { maxBuffer: 64 * 1024 * 1024 })).stdout) as T;

export async function fetchGitHubComments(owner: string, repo: string, number: string): Promise<GitHubComments> {
  const [inline, reviews, issueComments] = await Promise.all([
    gh<RawInline[]>(`repos/${owner}/${repo}/pulls/${number}/comments?per_page=100`),
    gh<{ id: number; user: { login?: string } | null; body: string | null; state: string; submitted_at: string | null }[]>(
      `repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`,
    ),
    gh<{ id: number; user: { login?: string } | null; body: string | null; created_at: string }[]>(
      `repos/${owner}/${repo}/issues/${number}/comments?per_page=100`,
    ),
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
        ...(placed
          ? {
              start: { side: side(c.start_side ?? c.side), line: c.start_line ?? c.line! },
              end: { side: side(c.side), line: c.line! },
            }
          : {}),
        entries: [],
      };
      byRoot.set(root, thread);
    }
    thread.entries.push({ author: login(c.user), body: c.body, createdAt: c.created_at });
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
