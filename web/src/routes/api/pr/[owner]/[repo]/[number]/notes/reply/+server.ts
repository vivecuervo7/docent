import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { badRequest, bodyOf, mcpUrl, validParams } from '$lib/api/http.server.js';
import { replyToNote, type NoteContext, type NoteMessage } from '$lib/features/reading/threadReplies.server.js';
import { changeRound } from '$lib/storage/rounds.server.js';

// Answers a question (or writes up a remark) in one of your threads, or
// about a finding. The answer is made here and saved into the review - the
// thread or finding marked as awaiting it until then - so it lands whether
// or not the page is still open. Answers at once.
export const POST: RequestHandler = async ({ params: { owner, repo, number }, request, url }) => {
	const body = await bodyOf(request);
	const context = body.context as NoteContext | undefined;
	const messages = body.messages as NoteMessage[] | undefined;
	const model = body.model;
	const target = body.target as { note?: unknown; finding?: { reviewer?: unknown; id?: unknown } } | undefined;
	const round = Number.isInteger(body.round) ? (body.round as number) : undefined;
	const note = typeof target?.note === 'string' ? target.note : undefined;
	const finding =
		typeof target?.finding?.reviewer === 'string' && typeof target.finding.id === 'string'
			? { reviewer: target.finding.reviewer, id: target.finding.id }
			: undefined;
	if (
		!validParams(owner, repo, number) ||
		typeof context?.path !== 'string' ||
		typeof context?.code !== 'string' ||
		!Array.isArray(messages) ||
		messages.length === 0 ||
		(!note && !finding) ||
		(model !== undefined && (typeof model !== 'string' || !model || model.length > 200))
	) {
		return badRequest('invalid note');
	}

	// What's answered: the thread, or the finding; gone if it was deleted meanwhile.
	type Answered = { messages?: { role: string; text: string; at: number }[]; awaiting?: boolean; replyError?: string };
	const answer = (change: (target: Answered) => void) =>
		changeRound(owner, repo, number, round, (record) => {
			if (note) {
				const found = (record.notes as (Answered & { id: string })[] | undefined)?.find((n) => n.id === note);
				if (found) change(found);
			} else if (finding) {
				const draft = (record.feedback as Record<string, { items: (Answered & { id: string })[] } | undefined> | undefined)?.[finding.reviewer];
				const found = draft?.items.find((i) => i.id === finding.id);
				if (found) change(found);
			}
		});

	answer((t) => {
		t.awaiting = true;
		delete t.replyError;
	});
	replyToNote(context, messages, new AbortController().signal, model, { pr: `${owner}/${repo}#${number}`, mcpUrl: mcpUrl(url) })
		.then(
			(text) =>
				answer((t) => {
					t.messages = [...(t.messages ?? []), { role: 'assistant', text, at: Date.now() }];
					delete t.awaiting;
				}),
			(err) =>
				answer((t) => {
					delete t.awaiting;
					t.replyError = (err as Error).message;
				})
		)
		.catch((err) => console.error(`[reply] ${(err as Error).message}`));
	return json({ asked: true });
};
