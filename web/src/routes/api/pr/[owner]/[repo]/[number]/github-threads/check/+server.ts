import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { badRequest, bodyOf, mcpUrl, reviewModel, validParams } from '$lib/api/http.server.js';
import { checkThread, type ThreadToCheck } from '$lib/features/threads/checkThreads.server.js';
import { changeRound } from '$lib/storage/rounds.server.js';

// Checks whether the round addresses GitHub threads, each saved into the
// round as it's made - marked as checking until then - so the checks land
// whether or not the page is still open. Answers at once.
// `entries` is how many comments a thread had, so a reply since shows.
export const POST: RequestHandler = async ({ params: { owner, repo, number }, request, url }) => {
	const body = await bodyOf(request);
	const threads = body.threads as { id: string; entries: number; context: ThreadToCheck }[] | undefined;
	const round = Number.isInteger(body.round) ? (body.round as number) : undefined;
	const valid =
		Array.isArray(threads) &&
		threads.length > 0 &&
		threads.length <= 200 &&
		threads.every(
			(t) =>
				t &&
				typeof t.id === 'string' &&
				/^t\d{1,20}$/.test(t.id) &&
				Number.isInteger(t.entries) &&
				typeof t.context?.path === 'string' &&
				typeof t.context.github === 'string' &&
				typeof t.context.code === 'string' &&
				typeof t.context.fileDiff === 'string'
		);
	if (!validParams(owner, repo, number) || !valid) return badRequest('invalid threads');

	type Checks = Record<string, Record<string, unknown>>;
	const save = (id: string, check: Record<string, unknown>) =>
		changeRound(owner, repo, number, round, (record) => {
			record.threadChecks = { ...(record.threadChecks as Checks | undefined), [id]: check };
		});
	const model = reviewModel(body);
	const access = { pr: `${owner}/${repo}#${number}`, mcpUrl: mcpUrl(url) };
	for (const { id, entries, context } of threads) {
		save(id, { checking: true, at: Date.now(), entries });
		checkThread(context, new AbortController().signal, model, access).then(
			(verdict) => save(id, { ...verdict, at: Date.now(), entries }),
			(err) => save(id, { error: (err as Error).message, at: Date.now(), entries })
		);
	}
	return json({ started: threads.length });
};
