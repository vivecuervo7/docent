import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { fetchFileContentAtRef, fetchPrBaseSha } from '$lib/github/github.server.js';
import { badRequest, failed, validParams } from '$lib/api/http.server.js';

export const GET: RequestHandler = async ({ params: { owner, repo, number }, url }) => {
	const path = url.searchParams.get('path');
	if (!validParams(owner, repo, number) || !path) return badRequest('invalid owner, repo, number, or path');
	try {
		const baseSha = await fetchPrBaseSha(owner, repo, number);
		return json({ content: await fetchFileContentAtRef(owner, repo, baseSha, path) });
	} catch (err) {
		return failed(err);
	}
};
