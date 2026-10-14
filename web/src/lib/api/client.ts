import type { ModelOption, PrCommit, PrFile, PrMeta, PrRef } from '../types';
// Calls to Docent's backend, the API routes under routes/api.

export async function readOk<T>(res: Response): Promise<T> {
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
	return body as T;
}

export const prUrl = (ref: PrRef) => `/api/pr/${ref.owner}/${ref.repo}/${ref.number}`;

// With `round`, an earlier round's files.
export async function fetchPr(ref: PrRef, round?: number): Promise<{ files: PrFile[]; meta: PrMeta | null }> {
	const { files, meta } = await readOk<{ files: PrFile[]; meta?: PrMeta }>(await fetch(round === undefined ? prUrl(ref) : `${prUrl(ref)}?round=${round}`));
	return { files, meta: meta ?? null };
}

export async function fetchCommits(ref: PrRef): Promise<PrCommit[]> {
	return (await readOk<{ commits: PrCommit[] }>(await fetch(`${prUrl(ref)}/commits`))).commits;
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
