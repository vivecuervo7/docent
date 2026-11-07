import type { ModelOption, PrCommit, PrFile, PrMeta, PrRef } from '../types';
// Calls to Docent's backend, the API routes under routes/api.

export async function readOk<T>(res: Response): Promise<T> {
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
	return body as T;
}

export const prUrl = (ref: PrRef) => `/api/pr/${ref.owner}/${ref.repo}/${ref.number}`;

// A request with a JSON body.
export function sendJson(url: string, body: unknown, method: string = 'POST'): Promise<Response> {
	return fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

// With `round`, an earlier round's files.
export async function fetchPr(ref: PrRef, round?: number): Promise<{ files: PrFile[]; meta: PrMeta | null }> {
	const { files, meta } = await readOk<{ files: PrFile[]; meta?: PrMeta }>(await fetch(round === undefined ? prUrl(ref) : `${prUrl(ref)}?round=${round}`));
	return { files, meta: meta ?? null };
}

export async function fetchCommits(ref: PrRef): Promise<PrCommit[]> {
	return (await readOk<{ commits: PrCommit[] }>(await fetch(`${prUrl(ref)}/commits`))).commits;
}

// As last listed, unless `fresh` asks for them listed again now.
export async function listModels(fresh = false): Promise<{ options: ModelOption[]; selected: string }> {
	return readOk(await fetch(fresh ? '/api/models?fresh' : '/api/models'));
}

export async function selectModel(model: string): Promise<string> {
	const res = await fetch('/api/models/selected', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model })
	});
	return (await readOk<{ selected: string }>(res)).selected;
}
