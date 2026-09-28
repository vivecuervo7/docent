import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { resolveModel, setEditorModel } from '$lib/server/config.js';
import { editorModel } from '$lib/server/grouping.js';
import { badRequest, bodyOf } from '$lib/server/http.js';
import { listModelOptions } from '$lib/server/modelProvider.js';

// The model the panel's editor uses, and the models it could.
export const GET: RequestHandler = async () => json({ options: await listModelOptions(), selected: await editorModel() });

export const PUT: RequestHandler = async ({ request }) => {
	const model = (await bodyOf(request)).model;
	if (typeof model !== 'string' || !model.trim() || !resolveModel(model.trim())) return badRequest('invalid model');
	setEditorModel(model.trim());
	return json({ selected: model.trim() });
};
