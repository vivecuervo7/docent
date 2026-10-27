import { prUrl, readOk, sendJson } from '../../api/client';
import type { AgentReview, PrRef } from '../../types';

// The PR's agent reviewers each have their own review on the backend.
const reviewUrl = (ref: PrRef, reviewer: string, action?: string) =>
	`${prUrl(ref)}/agent-review${action ? `/${action}` : ''}?reviewer=${reviewer}`;

export async function getAgentReview(ref: PrRef, reviewer: string): Promise<AgentReview | null> {
	return (await readOk<{ review: AgentReview | null }>(await fetch(reviewUrl(ref, reviewer)))).review;
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

// The review panel a new PR starts with: a model or "external" per reviewer,
// and whether each starts switched off.
type PanelEntry = { runs: string; persona?: string; off?: boolean };
export async function getDefaultPanel(): Promise<PanelEntry[] | null> {
	return (await readOk<{ panel: PanelEntry[] | null }>(await fetch('/api/panel/default'))).panel;
}

export async function setDefaultPanel(panel: PanelEntry[]): Promise<PanelEntry[] | null> {
	const res = await sendJson('/api/panel/default', { panel }, 'PUT');
	return (await readOk<{ panel: PanelEntry[] | null }>(res)).panel;
}
