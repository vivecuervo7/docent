import type { ModelOption, PrFile, PrMeta, PrRef } from '../types';
// Calls to Docent's backend, the API routes under routes/api.

export async function readOk<T>(res: Response): Promise<T> {
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
	return body as T;
}

// The answer to a call the backend holds open until a model replies; see
// heldOpen in api/http.server.ts.
export async function readHeld<T>(res: Response): Promise<T> {
	const body = await readOk<{ result?: T; error?: string }>(res);
	if (body.error !== undefined) throw new Error(body.error);
	return body.result as T;
}

export const prUrl = (ref: PrRef) => `/api/pr/${ref.owner}/${ref.repo}/${ref.number}`;

export async function fetchPr(ref: PrRef): Promise<{ files: PrFile[]; meta: PrMeta | null }> {
	const { files, meta } = await readOk<{ files: PrFile[]; meta?: PrMeta }>(await fetch(prUrl(ref)));
	return { files, meta: meta ?? null };
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
