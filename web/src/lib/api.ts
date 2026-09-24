import type { Generation, LineRef, ModelOption, PrFile, PrMeta, PrRecord, PrRef, Reuse } from './types';

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

export async function startGeneration(ref: PrRef, reuse: Reuse): Promise<Generation> {
	const res = await fetch(generationUrl(ref), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ reuse })
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

export async function listModels(): Promise<{ options: ModelOption[]; selected: string; error?: string }> {
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
	replies?: string[];
	included?: boolean;
}

function agentName(id: string, ranWith: string | undefined): string {
	if (ranWith === 'external') return 'Your agent';
	if (ranWith) return ranWith.replace(/^claude-code:/, '').split('/').pop()!;
	return id === 'agent-1' ? 'Agent' : `Agent ${id.slice('agent-'.length)}`;
}

export function marksFrom(record: PrRecord): Mark[] {
	const ranWith = new Map(record.agentReviewers.map((r) => [r.id as string, r.ranWith]));
	const findings = Object.entries(record.feedback)
		.filter(([key]) => key.startsWith('agent-'))
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
	const notes = record.notes.map(
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
