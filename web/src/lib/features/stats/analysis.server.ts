import { database, listRecords } from '../../storage/store.server.js';
import { persistent } from '../../storage/persistent.server.js';
import { roundView } from '../../storage/rounds.js';
import { chatWithTool } from '../../models/modelProvider.server.js';
import { inLane } from '../../models/lanes.server.js';
import { modelName } from '../../storage/settings.server.js';
import { fetchGitHubComments } from '../../github/comments.server.js';
import { fetchPrMeta } from '../../github/github.server.js';
import { viewerLogin } from '../../github/gh.server.js';
import { idOf, reviewerOf, stillListed } from './stats.server.js';
import { THEMES, type Analysis, type Theme } from './stats.js';
import type { FeedbackItem, PrRecord } from '../../types.js';

// How the panel performs, on asking: what kinds of point each reviewer
// raises, and which points others made on a PR after the panel had
// reviewed it - caught and kept, caught but lost, or missed. Each run only
// takes what's new since the last, and what it finds is kept; resetting
// starts over.

const db = persistent('analysis-tables', () => {
	const opened = database();
	opened.exec(`
		CREATE TABLE IF NOT EXISTS finding_themes (
			pr TEXT NOT NULL,
			finding TEXT NOT NULL,
			theme TEXT NOT NULL,
			PRIMARY KEY (pr, finding)
		);
		CREATE TABLE IF NOT EXISTS gap_comments (
			pr TEXT NOT NULL,
			comment TEXT NOT NULL,
			author TEXT NOT NULL,
			created_at TEXT NOT NULL,
			body TEXT NOT NULL,
			url TEXT NOT NULL,
			theme TEXT NOT NULL,
			severity TEXT NOT NULL,
			matched TEXT,
			PRIMARY KEY (pr, comment)
		);
	`);
	return opened;
});

const state = persistent('analysis-state', () => ({ running: false, done: 0, total: 0 }) as Analysis['status']);

const SEVERITIES = ['blocker', 'major', 'minor', 'nit'] as const;
// What each theme takes in, for the model sorting points into them.
const THEME_GUIDES: Record<Theme, string> = {
	correctness: 'logic errors, wrong results, edge cases, concurrency, data handling',
	reliability: 'error handling, failure paths, resilience, performance',
	security: 'vulnerabilities, secrets, permissions, unsafe input',
	tests: 'missing, weak or misleading tests',
	design: 'structure, naming, readability, documentation and comments',
	build: 'CI, deployment, dependencies, configuration'
};
const THEME_GUIDE = THEMES.map((t) => `- ${t}: ${THEME_GUIDES[t]}`).join('\n');

interface Finding {
	pr: string;
	// Its reviewer and id, unique within the PR: `<round>:<reviewer>:<id>`.
	id: string;
	reviewer: string;
	who: ReturnType<typeof reviewerOf>;
	item: FeedbackItem;
	// When its round's panel started, if it ran.
	startedAt: number | null;
}

// Every finding the panel raised on a PR, every round.
function findingsOf(key: string, record: PrRecord): Finding[] {
	const rounds = [...(record.rounds ?? []).map((_, i) => roundView(record, i)), record];
	return rounds.flatMap((round, n) => {
		const starts = (round.agentReviewers ?? []).flatMap((a) => (a.lastRun?.startedAt ? [a.lastRun.startedAt] : []));
		const startedAt = starts.length ? Math.min(...starts) : null;
		return Object.entries(round.feedback ?? {})
			.filter(([reviewer]) => reviewer.startsWith('agent-'))
			.flatMap(([reviewer, draft]) => {
				const who = reviewerOf(round.agentReviewers?.find((a) => a.id === reviewer));
				return (draft?.items ?? []).map((item) => ({ pr: key, id: `${n + 1}:${reviewer}:${item.id}`, reviewer: idOf(who), who, item, startedAt }));
			});
	});
}

const kept = (item: FeedbackItem) => !item.filtered && item.included !== false;
const short = (text: string, n: number) => (text.length > n ? `${text.slice(0, n)}…` : text);

const THEMES_TOOL = {
	name: 'report_themes',
	description: 'Report the theme of each point.',
	parameters: {
		type: 'object',
		properties: {
			themes: {
				type: 'array',
				items: {
					type: 'object',
					properties: { id: { type: 'string' }, theme: { type: 'string', enum: [...THEMES] } },
					required: ['id', 'theme']
				}
			}
		},
		required: ['themes']
	}
};

const THEMES_PROMPT = `Sort each code review point into the one theme it's most about:
${THEME_GUIDE}
Pick the closest; every point gets exactly one.`;

async function themeFindings(signal: AbortSignal) {
	const done = new Set((db.prepare('SELECT pr, finding FROM finding_themes').all() as { pr: string; finding: string }[]).map((r) => `${r.pr}|${r.finding}`));
	const todo = listRecords()
		.flatMap(({ key, record }) => findingsOf(key, record as unknown as PrRecord))
		.filter((f) => !done.has(`${f.pr}|${f.id}`));
	state.phase = 'themes';
	state.done = 0;
	state.total = todo.length;
	const insert = db.prepare('INSERT OR REPLACE INTO finding_themes (pr, finding, theme) VALUES (?, ?, ?)');
	for (let i = 0; i < todo.length; i += 40) {
		signal.throwIfAborted();
		const batch = todo.slice(i, i + 40);
		const call = await inLane(() =>
			chatWithTool(
				[
					{ role: 'system', content: THEMES_PROMPT },
					{ role: 'user', content: batch.map((f, n) => `[${n}] ${short(f.item.body, 600)}`).join('\n\n') }
				],
				THEMES_TOOL,
				signal,
				modelName()
			)
		);
		const themes = (call.arguments as { themes?: { id?: string; theme?: string }[] }).themes ?? [];
		for (const t of themes) {
			const finding = batch[Number(t.id)];
			if (finding && THEMES.includes(t.theme as Theme)) insert.run(finding.pr, finding.id, t.theme!);
		}
		state.done = Math.min(todo.length, i + batch.length);
	}
}

const GAPS_TOOL = {
	name: 'report_points',
	description: "Report, for each of the other reviewers' points, which panel finding made it, its theme and how much it matters.",
	parameters: {
		type: 'object',
		properties: {
			points: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						id: { type: 'string', description: "The point's id." },
						raises: { type: 'boolean', description: 'Whether it asks for something to change, rather than replying, thanking or asking.' },
						finding: { type: 'string', description: 'The id of the panel finding that makes the same point, if one does; leave out if none.' },
						theme: { type: 'string', enum: [...THEMES] },
						severity: { type: 'string', enum: [...SEVERITIES], description: 'How much the point matters; the lower one when unsure.' }
					},
					required: ['id', 'raises', 'theme', 'severity']
				}
			}
		},
		required: ['points']
	}
};

const GAPS_PROMPT = `People reviewed a pull request after a panel of review agents had. For each of their points, say \
which of the panel's findings makes the same point, if any: the same problem in the same place, not \
just the same topic. Say too whether each asks for something to change at all - a reply, thanks \
or a question doesn't. Sort each point into the one theme it's most about:
${THEME_GUIDE}
and say how much it matters - blocker, major, minor or nit - judging it as a reviewer would.`;

const urlOf = (key: string, id: string) => {
	const [owner, repo, number] = key.split('/');
	const base = `https://github.com/${owner}/${repo}/pull/${number}`;
	const n = id.slice(1);
	return id.startsWith('t') ? `${base}#discussion_r${n}` : id.startsWith('r') ? `${base}#pullrequestreview-${n}` : `${base}#issuecomment-${n}`;
};

async function judgeComments(signal: AbortSignal) {
	const me = await viewerLogin().catch(() => '');
	const done = new Set((db.prepare('SELECT pr, comment FROM gap_comments').all() as { pr: string; comment: string }[]).map((r) => `${r.pr}|${r.comment}`));
	const prs = listRecords()
		.map(({ key, record }) => ({ key, findings: findingsOf(key, record as unknown as PrRecord) }))
		.filter(({ findings }) => findings.some((f) => f.startedAt !== null));
	state.phase = 'gaps';
	state.done = 0;
	state.total = prs.length;
	const insert = db.prepare(
		'INSERT OR REPLACE INTO gap_comments (pr, comment, author, created_at, body, url, theme, severity, matched) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
	);
	for (const { key, findings } of prs) {
		signal.throwIfAborted();
		state.done++;
		const [owner, repo, number] = key.split('/');
		const [comments, meta] = await Promise.all([fetchGitHubComments(owner, repo, number), fetchPrMeta(owner, repo, number)]).catch(() => [null, null] as const);
		if (!comments || !meta) continue;
		const others = (author: string) => author !== me && author !== meta.author;
		// Each thread by what started it, and what was said on the PR as a whole.
		const points = [
			...comments.threads.flatMap((t) => {
				const first = t.entries[0];
				return first ? [{ id: t.id, author: first.author, at: first.createdAt, body: first.body, where: t.path }] : [];
			}),
			...comments.general.map((c) => ({ id: c.id, author: c.author, at: c.createdAt, body: c.body, where: 'the PR as a whole' }))
		].filter((p) => others(p.author) && !done.has(`${key}|${p.id}`));
		// A point is held only to the rounds that had run when it was made:
		// what a later round raised, it may have taken from the point itself.
		// Points with the same rounds before them are judged together.
		const groups = new Map<number, { findings: Finding[]; points: typeof points }>();
		for (const p of points) {
			const before = findings.filter((f) => f.startedAt !== null && f.startedAt < Date.parse(p.at));
			const panelled = new Set(before.map((f) => f.startedAt)).size;
			if (!panelled) continue;
			const group = groups.get(panelled) ?? { findings: before, points: [] };
			group.points.push(p);
			groups.set(panelled, group);
		}
		for (const group of groups.values()) await judge(key, group.findings, group.points, signal, insert);
	}
}

async function judge(
	key: string,
	findings: Finding[],
	points: { id: string; author: string; at: string; body: string; where: string }[],
	signal: AbortSignal,
	insert: ReturnType<typeof db.prepare>
) {
	const call = await inLane(() =>
		chatWithTool(
			[
				{ role: 'system', content: GAPS_PROMPT },
				{
					role: 'user',
					content: [
						`The panel's findings:\n${findings.map((f) => `[${f.id}] ${f.item.path ?? 'the PR'}: ${short(f.item.body, 500)}`).join('\n\n') || '(none)'}`,
						`The other reviewers' points:\n${points.map((p) => `[${p.id}] ${p.author} on ${p.where}: ${short(p.body, 800)}`).join('\n\n')}`
					].join('\n\n')
				}
			],
			GAPS_TOOL,
			signal,
			modelName()
		)
	);
	const judged = (call.arguments as { points?: { id?: string; raises?: boolean; finding?: string; theme?: string; severity?: string }[] }).points ?? [];
	for (const j of judged) {
		const point = points.find((p) => p.id === j.id);
		if (!point || !THEMES.includes(j.theme as Theme)) continue;
		// A reply or thanks is kept, so it isn't judged again, but never counted.
		const severity = j.raises === false ? 'none' : SEVERITIES.includes(j.severity as (typeof SEVERITIES)[number]) ? j.severity! : 'minor';
		const matched = j.finding && findings.some((f) => f.id === j.finding) ? j.finding : null;
		insert.run(key, point.id, point.author, point.at, point.body, urlOf(key, point.id), j.theme!, severity, matched);
	}
}

// Runs both, in the background; asking again while it runs does nothing.
export function startAnalysis(): void {
	if (state.running) return;
	Object.assign(state, { running: true, done: 0, total: 0, error: undefined });
	const controller = new AbortController();
	(async () => {
		await themeFindings(controller.signal);
		await judgeComments(controller.signal);
	})()
		.then(
			() => Object.assign(state, { running: false, phase: undefined, finishedAt: Date.now() }),
			(err) => Object.assign(state, { running: false, phase: undefined, error: (err as Error).message })
		)
		.catch(() => {});
}

export function resetAnalysis(): void {
	if (state.running) throw new Error('An analysis is running; wait for it to finish.');
	db.exec('DELETE FROM finding_themes; DELETE FROM gap_comments;');
	Object.assign(state, { done: 0, total: 0, error: undefined, finishedAt: undefined });
}

export function readAnalysis(): Analysis {
	const records = listRecords().map(({ key, record }) => ({ key, record: record as unknown as PrRecord }));
	// As the Reviewers list counts them: a reviewer since removed goes, with its findings.
	const listed = stillListed();
	const findings = records.flatMap(({ key, record }) => findingsOf(key, record)).filter((f) => listed(f.who));
	const byId = new Map(findings.map((f) => [`${f.pr}|${f.id}`, f]));
	const themeOf = new Map(
		(db.prepare('SELECT pr, finding, theme FROM finding_themes').all() as { pr: string; finding: string; theme: Theme }[]).map((r) => [
			`${r.pr}|${r.finding}`,
			r.theme
		])
	);

	const overall: Analysis['themes']['overall'] = {};
	const byReviewer: Analysis['themes']['byReviewer'] = {};
	for (const f of findings) {
		const theme = themeOf.get(`${f.pr}|${f.id}`);
		if (!theme || !kept(f.item)) continue;
		overall[theme] = (overall[theme] ?? 0) + 1;
		const mine = (byReviewer[f.reviewer] ??= {});
		mine[theme] = (mine[theme] ?? 0) + 1;
	}

	const rows = db.prepare('SELECT pr, theme, severity, matched FROM gap_comments').all() as {
		pr: string;
		theme: Theme;
		severity: string;
		matched: string | null;
	}[];
	// A point's fate, by what became of the finding that made it: one you
	// skipped was still caught, while one the panel discarded itself was set
	// aside. A reply or thanks isn't a point.
	const byTheme: Analysis['gaps']['byTheme'] = {};
	for (const r of rows) {
		if (r.severity === 'none') continue;
		const item = r.matched ? byId.get(`${r.pr}|${r.matched}`)?.item : undefined;
		const verdict = !item ? 'missed' : item.filtered || (!item.included && (item.setAside || item.skipSuggested)) ? 'setAside' : 'caught';
		const t = (byTheme[r.theme] ??= { caught: 0, setAside: 0, missed: 0 });
		t[verdict]++;
	}

	return {
		status: { ...state },
		pending: { findings: findings.filter((f) => !themeOf.has(`${f.pr}|${f.id}`)).length },
		themes: { overall, byReviewer },
		gaps: { byTheme }
	};
}
