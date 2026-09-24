// What this app reads from Docent's existing backend, which it shares with
// the React app: the PR's files from GitHub, and the saved review record.

export interface PrFile {
	filename: string;
	status: string;
	additions: number;
	deletions: number;
	patch?: string;
}

export interface LineRef {
	side: 'old' | 'new';
	line: number;
}

export interface Slice {
	id: string;
	title: string;
	summary: string;
	hunks: string[];
}

export interface FileNote {
	path: string;
	kind: 'tests' | 'context';
	note: string;
	quality?: string;
}

interface FeedbackItem {
	id: string;
	body: string;
	included: boolean;
	path?: string;
	start?: LineRef;
	end?: LineRef;
	rationale?: string;
}

interface Note {
	id: string;
	path: string;
	start: LineRef;
	end: LineRef;
	messages: { role: 'user' | 'assistant'; text: string }[];
}

export interface PrRecord {
	slices: Slice[] | null;
	fileNotes: Record<string, FileNote[]> | null;
	notes: Note[];
	feedback: Record<string, { items: FeedbackItem[] } | undefined>;
	agentReviewers?: { id: string; ranWith?: string }[];
}

// Anything with a pin on the diff: a reviewer's thread, or an agent's finding.
export interface Mark {
	id: string;
	kind: 'note' | 'finding';
	path: string;
	start: LineRef;
	end: LineRef;
	who: string;
	body: string;
	rationale?: string;
	replies?: string[];
	included?: boolean;
}

function agentName(id: string, ranWith: string | undefined): string {
	if (ranWith === 'external') return 'Your agent';
	if (ranWith) return ranWith.replace(/^claude-code:/, '').split('/').pop()!;
	return id === 'agent-1' || id === 'agent' ? 'Agent' : `Agent ${id.slice('agent-'.length)}`;
}

export function marksFrom(record: PrRecord): Mark[] {
	const ranWith = new Map((record.agentReviewers ?? []).map((r) => [r.id, r.ranWith]));
	const findings = Object.entries(record.feedback ?? {})
		.filter(([key]) => key.startsWith('agent'))
		.flatMap(([key, draft]) =>
			(draft?.items ?? [])
				.filter((item) => item.path && item.start)
				.map(
					(item): Mark => ({
						id: item.id,
						kind: 'finding',
						path: item.path!,
						start: item.start!,
						end: item.end ?? item.start!,
						who: agentName(key, ranWith.get(key)),
						body: item.body,
						rationale: item.rationale,
						included: item.included
					})
				)
		);
	const notes = (record.notes ?? []).map(
		(note): Mark => ({
			id: note.id,
			kind: 'note',
			path: note.path,
			start: note.start,
			end: note.end,
			who: 'You',
			body: note.messages[0]?.text ?? '',
			replies: note.messages.slice(1).map((m) => m.text)
		})
	);
	return [...notes, ...findings];
}

async function json<T>(res: Response): Promise<T> {
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
	return body as T;
}

export async function loadPr(fetcher: typeof fetch, owner: string, repo: string, number: string) {
	const [pr, stored] = await Promise.all([
		fetcher(`/api/pr/${owner}/${repo}/${number}`).then((r) => json<{ files: PrFile[]; meta?: { title?: string } }>(r)),
		fetcher(`/api/prs/${owner}/${repo}/${number}`).then((r) => json<{ record: PrRecord }>(r))
	]);
	return { files: pr.files, title: pr.meta?.title ?? `#${number}`, record: stored.record };
}
