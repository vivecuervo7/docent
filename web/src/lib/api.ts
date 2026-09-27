import type { AgentReview, FeedbackItem, Generation, LineRef, ModelOption, Note, PrFile, PrMeta, PrRecord, PrRef, PrSummary, Reuse, Slice } from './types';
import { isUnread } from './types';
import { reviewerLabel } from './reviewers.svelte';

// Calls to Docent's backend, which this app shares with the React app.

export async function readOk<T>(res: Response): Promise<T> {
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
	return body as T;
}

const prUrl = (ref: PrRef) => `/api/pr/${ref.owner}/${ref.repo}/${ref.number}`;

export async function fetchPr(ref: PrRef): Promise<{ files: PrFile[]; meta: PrMeta | null }> {
	const { files, meta } = await readOk<{ files: PrFile[]; meta?: PrMeta }>(await fetch(prUrl(ref)));
	return { files, meta: meta ?? null };
}

// Preparing a review (slices, conversation, summary, file notes) runs as a
// background generation on the backend.
export const generationUrl = (ref: PrRef) => `${prUrl(ref)}/generation`;

export async function getGeneration(ref: PrRef): Promise<Generation | null> {
	return (await readOk<{ generation: Generation | null }>(await fetch(generationUrl(ref)))).generation;
}

export async function startGeneration(ref: PrRef, reuse: Reuse, model?: string): Promise<Generation> {
	const res = await fetch(generationUrl(ref), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ reuse, model })
	});
	return (await readOk<{ generation: Generation }>(res)).generation;
}

export async function stopGeneration(ref: PrRef): Promise<Generation | null> {
	return (await readOk<{ generation: Generation | null }>(await fetch(`${generationUrl(ref)}/stop`, { method: 'POST' })))
		.generation;
}

export async function dismissGeneration(ref: PrRef): Promise<void> {
	await fetch(generationUrl(ref), { method: 'DELETE' }).catch(() => {});
}

export async function listGenerations(): Promise<(PrRef & { generation: Generation })[]> {
	return (await readOk<{ generations: (PrRef & { generation: Generation })[] }>(await fetch('/api/generations')))
		.generations;
}

export async function listModels(): Promise<{ options: ModelOption[]; selected: string }> {
	return readOk(await fetch('/api/models'));
}

export async function selectModel(model: string): Promise<string> {
	const res = await fetch('/api/models/selected', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model })
	});
	return (await readOk<{ selected: string }>(res)).selected;
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
	included?: boolean;
	// A thread's own record, for its messages and hunk.
	note?: Note;
	// The agent reviewer a finding came from.
	reviewer?: string;
	// Whether the reviewer has kept or skipped the finding yet.
	decided?: boolean;
	// A finding with an answer to a question the reviewer hasn't read yet.
	unread?: boolean;
	// Other findings making the same point, grouped under this one.
	alsoBy?: { reviewer: string; id: string; who: string; body: string; rationale?: string; path?: string; line?: number }[];
	// The lead of a group it was separated from.
	separatedFrom?: { who: string };
	// What it assumes, when nothing settles it.
	speculative?: string;
	// The PR thread already raising it.
	onPr?: string;
	impact?: string;
	skipSuggested?: string;
	severity?: import('./types').Severity;
	// What the reviewers it's grouped with disagree with it about.
	disputed?: string[];
}

// How many reviewers raised a group's point: "Raised by 3 reviewers", or a
// reviewer repeating itself, "Raised twice by amber-ferret".
export function raisedBy(who: string, alsoBy: { who: string }[]): string {
	const reviewers = new Set([who, ...alsoBy.map((a) => a.who)]).size;
	if (reviewers > 1) return `Raised by ${reviewers} reviewers`;
	const times = alsoBy.length + 1;
	return `Raised ${times === 2 ? 'twice' : `${times} times`} by ${who}`;
}

// Whether a panel finding is shown: once the editor has been through it,
// unless it filtered it out.
export const isShown = (item: Pick<FeedbackItem, 'edited' | 'editFailed' | 'filtered'>) =>
	(!!item.edited || !!item.editFailed) && !item.filtered;

// Findings that joined another as the same point, by the lead they joined;
// a finding whose lead has gone stands on its own again. Only findings
// shown count.
export function groupsOf(record: PrRecord) {
	const items = Object.entries(record.feedback)
		.filter(([key]) => key.startsWith('agent-'))
		.flatMap(([reviewer, draft]) => (draft?.items ?? []).filter(isShown).map((item) => ({ reviewer, item })));
	const exists = (reviewer: string, id: string) => items.some((x) => x.reviewer === reviewer && x.item.id === id);
	const members = new Map<string, typeof items>();
	for (const x of items) {
		const j = x.item.joins;
		if (!j || !exists(j.reviewer, j.id)) continue;
		const key = `${j.reviewer}/${j.id}`;
		members.set(key, [...(members.get(key) ?? []), x]);
	}
	const joined = (reviewer: string, item: { joins?: { reviewer: string; id: string } }) =>
		!!item.joins && exists(item.joins.reviewer, item.joins.id);
	return { membersOf: (reviewer: string, id: string) => members.get(`${reviewer}/${id}`) ?? [], joined, exists };
}

// A reviewer's name, as the panel shows it.
export function reviewerName(record: PrRecord, id: string): string {
	return reviewerLabel(record.agentReviewers, id);
}

export function marksFrom(record: PrRecord): Mark[] {
	const { membersOf, joined, exists } = groupsOf(record);
	const findings = Object.entries(record.feedback)
		.filter(([key]) => key.startsWith('agent-'))
		.flatMap(([key, draft]) =>
			(draft?.items ?? [])
				.filter((item) => item.path && item.start && isShown(item) && !joined(key, item))
				.map(
					(item): Mark => ({
						id: item.id,
						kind: 'finding',
						path: item.path!,
						start: item.start!,
						end: item.end ?? item.start!,
						who: reviewerName(record, key),
						body: item.body,
						rationale: item.rationale,
						...(item.speculative ? { speculative: item.speculative } : {}),
						...(item.onPr ? { onPr: item.onPr } : {}),
						...(item.impact ? { impact: item.impact } : {}),
						...(item.skipSuggested ? { skipSuggested: item.skipSuggested } : {}),
						...(item.severity ? { severity: item.severity } : {}),
						included: item.included,
						decided: item.decided,
						unread: isUnread(item),
						reviewer: key,
						alsoBy: membersOf(key, item.id).map(({ reviewer, item: m }) => ({
							reviewer,
							id: m.id,
							who: reviewerName(record, reviewer),
							body: m.body,
							rationale: m.rationale,
							path: m.path,
							line: m.start?.line
						})),
						...(item.separatedFrom && exists(item.separatedFrom.reviewer, item.separatedFrom.id)
							? { separatedFrom: { who: reviewerName(record, item.separatedFrom.reviewer) } }
							: {}),
						...(() => {
							const disputed = membersOf(key, item.id).flatMap(({ item: m }) => (m.disputed ? [m.disputed] : []));
							return disputed.length ? { disputed } : {};
						})()
					})
				)
		);
	const notes = record.notes.map(
		(note): Mark => ({
			id: note.id,
			kind: 'note',
			path: note.path,
			start: note.start,
			end: note.end,
			who: 'You',
			body: note.messages[0]?.text ?? '',
			note
		})
	);
	return [...notes, ...findings];
}

// The PR's agent reviewers each have their own review on the backend.
const reviewUrl = (ref: PrRef, reviewer: string, action?: string) =>
	`${prUrl(ref)}/agent-review${action ? `/${action}` : ''}?reviewer=${reviewer}`;

export async function getAgentReview(ref: PrRef, reviewer: string): Promise<AgentReview | null> {
	return (await readOk<{ review: AgentReview | null }>(await fetch(reviewUrl(ref, reviewer)))).review;
}

export async function startAgentReview(
	ref: PrRef,
	reviewer: string,
	body: {
		mode: 'builtin' | 'external' | 'session';
		model?: string;
		persona?: string;
		session?: string;
		context: { title?: string; summary: PrSummary | null; slices: Slice[] };
	}
): Promise<AgentReview> {
	const res = await fetch(reviewUrl(ref, reviewer), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	return (await readOk<{ review: AgentReview }>(res)).review;
}

export async function endAgentReview(ref: PrRef, reviewer: string, action: 'stop' | 'finish'): Promise<AgentReview | null> {
	return (await readOk<{ review: AgentReview | null }>(await fetch(reviewUrl(ref, reviewer, action), { method: 'POST' })))
		.review;
}

// Lets the backend forget a review that's over; `force` stops a running one
// first, for a reviewer being removed.
export async function dismissAgentReview(ref: PrRef, reviewer: string, force = false): Promise<void> {
	await fetch(`${reviewUrl(ref, reviewer)}${force ? '&force=1' : ''}`, { method: 'DELETE' }).catch(() => {});
}

// The review panel a new PR starts with: a model or "external" per reviewer.
export async function getDefaultPanel(): Promise<{ runs: string; persona?: string }[] | null> {
	return (await readOk<{ panel: { runs: string; persona?: string }[] | null }>(await fetch('/api/panel/default'))).panel;
}

export async function setDefaultPanel(panel: { runs: string; persona?: string }[]): Promise<{ runs: string; persona?: string }[] | null> {
	const res = await fetch('/api/panel/default', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ panel })
	});
	return (await readOk<{ panel: { runs: string; persona?: string }[] | null }>(res)).panel;
}
