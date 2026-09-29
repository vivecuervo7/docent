import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { badRequest, bodyOf, noContent, validParams } from '$lib/server/http.js';
import { deleteRecord, getRecord, keyFor, putRecord, VersionConflict } from '$lib/storage/store.server.js';

const invalid = () => badRequest('invalid owner, repo, or PR number');

export const GET: RequestHandler = ({ params: { owner, repo, number } }) => {
	if (!validParams(owner, repo, number)) return invalid();
	return json(getRecord(keyFor(owner, repo, number)));
};

// The version is the one the change was made from; a stale one gets a 409
// with the record as it is now, to redo the change on.
export const PUT: RequestHandler = async ({ params: { owner, repo, number }, request }) => {
	const { record, version } = await bodyOf(request);
	if (!validParams(owner, repo, number) || typeof record !== 'object' || record === null || !Number.isInteger(version)) {
		return badRequest('invalid record');
	}
	try {
		return json({ version: putRecord(keyFor(owner, repo, number), record, version) });
	} catch (err) {
		if (err instanceof VersionConflict) return json(err.current, { status: 409 });
		throw err;
	}
};

export const DELETE: RequestHandler = ({ params: { owner, repo, number } }) => {
	if (!validParams(owner, repo, number)) return invalid();
	deleteRecord(keyFor(owner, repo, number));
	return noContent();
};
