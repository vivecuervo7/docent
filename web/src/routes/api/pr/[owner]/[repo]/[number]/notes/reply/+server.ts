import type { RequestHandler } from './$types';
import { badRequest, bodyOf, heldOpen, mcpUrl, validParams } from '$lib/api/http.server.js';
import { replyToNote, type NoteContext, type NoteMessage } from '$lib/features/reading/threadReplies.server.js';

// Answers a question (or writes up a remark) about lines the reviewer
// selected. Held open until the model replies; see notes.ts for the lane.
export const POST: RequestHandler = async ({ params: { owner, repo, number }, request, url }) => {
	const body = await bodyOf(request);
	const context = body.context as NoteContext | undefined;
	const messages = body.messages as NoteMessage[] | undefined;
	const model = body.model;
	if (
		!validParams(owner, repo, number) ||
		typeof context?.path !== 'string' ||
		typeof context?.code !== 'string' ||
		!Array.isArray(messages) ||
		messages.length === 0 ||
		(model !== undefined && (typeof model !== 'string' || !model || model.length > 200))
	) {
		return badRequest('invalid note');
	}
	return heldOpen(async (signal) => ({
		text: await replyToNote(context, messages, signal, model, { pr: `${owner}/${repo}#${number}`, mcpUrl: mcpUrl(url) })
	}));
};
