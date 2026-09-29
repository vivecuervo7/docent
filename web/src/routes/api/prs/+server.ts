import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { listRecords } from '$lib/storage/store.server.js';

// Saved reviews: one record per PR, owned here rather than in the browser so
// agents can read and write them too. See store.ts.
export const GET: RequestHandler = () =>
	json({
		prs: listRecords().flatMap(({ key, record }) => {
			const [owner, repo, number] = key.split('/');
			return owner && repo && number ? [{ owner, repo, number, record }] : [];
		})
	});
