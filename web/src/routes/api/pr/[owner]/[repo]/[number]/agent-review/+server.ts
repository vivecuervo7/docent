import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import {
	dismissAgentReview,
	getAgentReview,
	openExternalReview,
	startBuiltinReview,
	startSessionReview,
	type ReviewContext
} from '$lib/server/agentReview.js';
import { externalReviewers, personas } from '$lib/storage/settings.server.js';
import { badRequest, bodyOf, mcpUrl, noContent, reviewerParam, validParams } from '$lib/api/http.server.js';
import type { Slice } from '$lib/server/types.js';

// The agent review: Docent's own reviewer ("builtin"), one of the reviewer's
// external reviewers ("session"), or waiting for the reviewer's own agent to
// submit findings over MCP ("external").
export const POST: RequestHandler = async ({ params: { owner, repo, number }, request, url }) => {
	const body = await bodyOf(request);
	const mode = body.mode;
	const reviewer = reviewerParam(url);
	const model = body.model;
	const session = mode === 'session' ? externalReviewers.list().find((p) => p.id === body.session) : undefined;
	// A persona's instructions, for Docent's reviewer; none means the default.
	const persona = mode === 'builtin' && body.persona ? personas.list().find((p) => p.id === body.persona) : undefined;
	if (
		!validParams(owner, repo, number) ||
		!reviewer ||
		(mode !== 'builtin' && mode !== 'external' && mode !== 'session') ||
		(mode === 'session' && !session) ||
		(model !== undefined && (typeof model !== 'string' || !model || model.length > 200))
	) {
		return badRequest('invalid PR, reviewer, mode or model');
	}
	const context: ReviewContext = {
		title: typeof body.context?.title === 'string' ? body.context.title : undefined,
		summary: body.context?.summary ?? null,
		slices: Array.isArray(body.context?.slices) ? (body.context.slices as Slice[]) : null
	};
	const review =
		mode === 'builtin'
			? startBuiltinReview(owner, repo, number, context, reviewer, model, persona?.instructions, mcpUrl(url))
			: session
				? startSessionReview(owner, repo, number, context, session, mcpUrl(url), reviewer)
				: openExternalReview(owner, repo, number, context, reviewer);
	return json({ review });
};

export const GET: RequestHandler = ({ params: { owner, repo, number }, url }) => {
	const reviewer = reviewerParam(url);
	if (!validParams(owner, repo, number) || !reviewer) return badRequest('invalid PR or reviewer');
	return json({ review: getAgentReview(owner, repo, number, reviewer) });
};

export const DELETE: RequestHandler = ({ params: { owner, repo, number }, url }) => {
	const reviewer = reviewerParam(url);
	if (!validParams(owner, repo, number) || !reviewer) return badRequest('invalid PR or reviewer');
	// `?force=1` when the reviewer entry itself is removed, stopping it if running.
	dismissAgentReview(owner, repo, number, reviewer, url.searchParams.get('force') === '1');
	return noContent();
};
