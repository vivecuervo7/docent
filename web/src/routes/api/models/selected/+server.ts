import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { modelName, setModelName } from '$lib/storage/settings.server.js';
import { badRequest, bodyOf } from '$lib/api/http.server.js';

export const PUT: RequestHandler = async ({ request }) => {
	const model = (await bodyOf(request)).model;
	if (typeof model !== 'string' || !model.trim()) return badRequest('invalid model');
	setModelName(model.trim());
	return json({ selected: modelName() });
};
