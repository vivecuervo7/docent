import { prUrl, readOk } from '../../api/client';
import type { Generation, PrRef, Reuse } from '../../types';

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
