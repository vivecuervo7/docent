import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { defaultPanel, setDefaultPanel } from '$lib/storage/settings.server.js';
import { badRequest, bodyOf } from '$lib/server/http.js';

// The review panel a new PR starts with, the same for every repo.
export const GET: RequestHandler = () => json({ panel: defaultPanel() });

export const PUT: RequestHandler = async ({ request }) => {
	const panel = (await bodyOf(request)).panel;
	const valid = (e: unknown) => {
		const { runs, persona } = (e ?? {}) as Record<string, unknown>;
		return typeof runs === 'string' && !!runs.trim() && runs.length <= 200 && (persona === undefined || (typeof persona === 'string' && persona.length <= 40));
	};
	if (!Array.isArray(panel) || panel.length === 0 || panel.length > 10 || !panel.every(valid)) return badRequest('invalid panel');
	setDefaultPanel(panel.map((e: { runs: string; persona?: string }) => ({ runs: e.runs.trim(), ...(e.persona ? { persona: e.persona } : {}) })));
	return json({ panel: defaultPanel() });
};
