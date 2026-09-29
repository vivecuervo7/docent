import { prUrl, readOk } from '../../api/client';
import type { AgentReview, PrRef, PrSummary, Slice } from '../../types';

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
