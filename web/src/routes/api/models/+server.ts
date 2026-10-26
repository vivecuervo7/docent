import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { modelName, setModelName } from '$lib/storage/settings.server.js';
import { modelOptions } from '$lib/models/modelProvider.server.js';

// The models that can be picked right now, and which one Docent uses. When
// the picked one isn't among them (its provider was removed, or none was
// ever picked), the first that is takes its place. They're as last listed,
// unless `?fresh` asks for them listed again now.
export const GET: RequestHandler = async ({ url }) => {
	const options = await (url.searchParams.has('fresh') ? modelOptions.fresh() : modelOptions.get());
	let selected = modelName();
	if (options.length && !options.some((o) => o.id === selected)) {
		selected = options[0].id;
		setModelName(selected);
	}
	return json({ options, selected });
};
