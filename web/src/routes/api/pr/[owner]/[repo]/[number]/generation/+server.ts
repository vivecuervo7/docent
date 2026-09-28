import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { dismissGeneration, getGeneration, startGeneration, type Reuse } from '$lib/server/generation.js';
import { badRequest, bodyOf, noContent, reviewModel, validParams } from '$lib/server/http.js';
import type { ConversationSummary, Slice } from '$lib/server/types.js';

const invalid = () => badRequest('invalid owner, repo, or PR number');

export const POST: RequestHandler = async ({ params: { owner, repo, number }, request }) => {
	if (!validParams(owner, repo, number)) return invalid();
	const body = await bodyOf(request);
	const reuse: Reuse = {};
	if (Array.isArray(body.reuse?.slices)) reuse.slices = body.reuse.slices as Slice[];
	if (Array.isArray(body.reuse?.conversation?.reviewers)) reuse.conversation = body.reuse.conversation as ConversationSummary;
	const fileNotes = body.reuse?.fileNotes;
	if (fileNotes && typeof fileNotes === 'object' && !Array.isArray(fileNotes)) reuse.fileNotes = fileNotes as Reuse['fileNotes'];
	return json({ generation: startGeneration(owner, repo, number, reuse, reviewModel(body)) });
};

export const GET: RequestHandler = ({ params: { owner, repo, number } }) => {
	if (!validParams(owner, repo, number)) return invalid();
	return json({ generation: getGeneration(owner, repo, number) });
};

export const DELETE: RequestHandler = ({ params: { owner, repo, number } }) => {
	if (!validParams(owner, repo, number)) return invalid();
	dismissGeneration(owner, repo, number);
	return noContent();
};
