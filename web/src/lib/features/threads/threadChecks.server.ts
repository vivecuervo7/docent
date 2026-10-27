import { database, getRecord, keyFor } from '../../storage/store.server.js';
import { persistent } from '../../storage/persistent.server.js';
import { fetchGitHubComments } from '../../github/comments.server.js';
import { fetchPrFiles, fetchPrMeta, type PrFile } from '../../github/github.server.js';
import { changesBetween } from '../../github/repoCache.server.js';
import { codeIn, nearestHunk, parseFilePatch } from '../reading/diff/parse.js';
import { noteWhere, type GitHubThread, type ThreadCheck } from '../../types.js';
import { checkThread, type ThreadToCheck } from './checkThreads.server.js';

// The GitHub threads on a PR, and what checking them found, whether or not
// it's being reviewed: from the start page as much as a round's Overview.
// A check is of the PR as it stands, against all that changed in the
// thread's file since it was left, so it's kept for the PR, not a round,
// with the head it was made at.

const db = persistent('thread-check-tables', () => {
	const opened = database();
	opened.exec(`
    CREATE TABLE IF NOT EXISTS thread_checks (
      key TEXT PRIMARY KEY,
      checks TEXT NOT NULL
    )
  `);
	return opened;
});

type Checks = Record<string, ThreadCheck>;

// Checks made before they were kept per PR sat on its rounds: the latest
// round's are brought over the first time the PR's are asked for.
export function checksOf(key: string): Checks {
	const row = db.prepare('SELECT checks FROM thread_checks WHERE key = ?').get(key) as { checks: string } | undefined;
	if (row) return JSON.parse(row.checks);
	const { record, version } = getRecord(key);
	const rounds = version ? [...((record.rounds as Record<string, unknown>[] | undefined) ?? []), record] : [];
	const last = rounds.findLast((r) => Object.keys((r.threadChecks as Checks | undefined) ?? {}).length);
	const range = last?.range as { to?: string } | undefined;
	const head = range?.to ?? (last?.preparedHead as string | undefined);
	const checks = Object.fromEntries(
		Object.entries((last?.threadChecks as Checks | undefined) ?? {})
			.filter(([, c]) => !c.checking)
			.map(([id, c]) => [id, { ...c, ...(head ? { head } : {}) }])
	);
	db.prepare('INSERT OR IGNORE INTO thread_checks (key, checks) VALUES (?, ?)').run(key, JSON.stringify(checks));
	return checks;
}

// Checks saved as under way, which nothing is running any more.
export function clearInterruptedChecks(error: string) {
	const rows = db.prepare('SELECT key, checks FROM thread_checks').all() as { key: string; checks: string }[];
	for (const row of rows) {
		const checks = JSON.parse(row.checks) as Checks;
		const stuck = Object.entries(checks).filter(([, c]) => c.checking);
		if (!stuck.length) continue;
		for (const [id, c] of stuck) checks[id] = { error, at: c.at, entries: c.entries, ...(c.head ? { head: c.head } : {}) };
		db.prepare('UPDATE thread_checks SET checks = ? WHERE key = ?').run(JSON.stringify(checks), row.key);
	}
}

function saveCheck(key: string, id: string, check: ThreadCheck) {
	const checks = { ...checksOf(key), [id]: check };
	db.prepare('UPDATE thread_checks SET checks = ? WHERE key = ?').run(JSON.stringify(checks), key);
}

export interface PrThreads {
	// Every thread on the PR, each with its lines as they read at the head.
	threads: (GitHubThread & { now: string })[];
	checks: Checks;
	head: string;
	author?: string;
}

async function read(owner: string, repo: string, number: string) {
	const [comments, files, meta] = await Promise.all([
		fetchGitHubComments(owner, repo, number),
		fetchPrFiles(owner, repo, number),
		fetchPrMeta(owner, repo, number)
	]);
	const byName = new Map(files.map((f) => [f.filename, f]));
	const threads = comments.threads.map((t) => ({ ...t, now: codeNow(byName.get(t.path), t) }));
	return { threads, files: byName, head: meta.head ?? '', author: meta.author };
}

// A thread's lines as they read at the PR's head, with +/- markers.
function codeNow(file: PrFile | undefined, thread: GitHubThread): string {
	const { start, end } = thread;
	if (!file?.patch || !start || !end) return '';
	const hunk = nearestHunk(parseFilePatch(file.patch), start);
	return hunk ? codeIn(hunk, start, end) : '';
}

export async function prThreads(owner: string, repo: string, number: string): Promise<PrThreads> {
	const { threads, head, author } = await read(owner, repo, number);
	return { threads, checks: checksOf(keyFor(owner, repo, number)), head, ...(author ? { author } : {}) };
}

// Checks the threads asked for, each saved as it's made - marked as
// checking until then - so they land whether or not anything's waiting.
export async function startChecks(owner: string, repo: string, number: string, ids: string[], model: string | undefined, mcpUrl: string): Promise<number> {
	const key = keyFor(owner, repo, number);
	const { threads, files, head } = await read(owner, repo, number);
	const chosen = threads.filter((t) => ids.includes(t.id));
	const access = { pr: `${owner}/${repo}#${number}`, mcpUrl };
	for (const thread of chosen) {
		const entries = thread.entries.length;
		saveCheck(key, thread.id, { checking: true, at: Date.now(), entries, head });
		contextOf(owner, repo, thread, files.get(thread.path), head)
			.then((context) => checkThread(context, new AbortController().signal, model, access))
			.then(
				(verdict) => saveCheck(key, thread.id, { ...verdict, at: Date.now(), entries, head }),
				(err) => saveCheck(key, thread.id, { error: (err as Error).message, at: Date.now(), entries, head })
			)
			.catch((err) => console.error(`[threads] ${thread.id}: ${(err as Error).message}`));
	}
	return chosen.length;
}

// What changed in the thread's file since it was left: from the commit it
// was left on to the head, or the PR's whole change to the file when that
// commit's gone.
async function contextOf(owner: string, repo: string, thread: GitHubThread & { now: string }, file: PrFile | undefined, head: string): Promise<ThreadToCheck> {
	const since = thread.commit && thread.commit !== head ? await changesBetween(owner, repo, thread.commit, head, [thread.path]).catch(() => null) : null;
	const lines =
		thread.start && thread.end
			? noteWhere({ path: thread.path, start: thread.start, end: thread.end })
			: thread.outdated
				? `outdated: its lines have changed since${thread.originalLine ? `; it was left on line ${thread.originalLine}` : ''}`
				: 'the whole file';
	return {
		path: thread.path,
		lines,
		code: thread.now,
		fileDiff: since ? (since[0]?.patch ?? '') : (file?.patch ?? ''),
		since: !!since,
		github: [thread.diffHunk ? `Left on:\n${thread.diffHunk}` : '', ...thread.entries.map((e) => `${e.author}: ${e.body}`)].filter(Boolean).join('\n\n')
	};
}
