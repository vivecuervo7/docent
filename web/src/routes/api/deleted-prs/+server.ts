import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { badRequest, bodyOf, failed, validParams } from '$lib/api/http.server.js';
import { keyFor, listDeleted, restoreRecord } from '$lib/storage/store.server.js';

// Reviews deleted in the last week, and putting one back.
export const GET: RequestHandler = () =>
	json({
		deleted: listDeleted().map(({ key, title, deletedAt }) => {
			const [owner, repo, number] = key.split('/');
			return { owner, repo, number, title, deletedAt };
		})
	});

export const POST: RequestHandler = async ({ request }) => {
	const { owner, repo, number, deletedAt } = await bodyOf(request);
	if (!validParams(String(owner), String(repo), String(number)) || typeof deletedAt !== 'number') return badRequest('invalid review');
	try {
		restoreRecord(keyFor(String(owner), String(repo), String(number)), deletedAt);
		return json({ restored: true });
	} catch (err) {
		return failed(err);
	}
};
