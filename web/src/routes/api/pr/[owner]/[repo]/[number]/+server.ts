import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { fetchPrFiles, fetchPrMeta } from '$lib/github/github.server.js';
import { badRequest, failed, validParams } from '$lib/server/http.js';

export const GET: RequestHandler = async ({ params: { owner, repo, number } }) => {
	if (!validParams(owner, repo, number)) return badRequest('invalid owner, repo, or PR number');
	try {
		const [files, meta] = await Promise.all([fetchPrFiles(owner, repo, number), fetchPrMeta(owner, repo, number)]);
		return json({ files, meta });
	} catch (err) {
		return failed(err);
	}
};
