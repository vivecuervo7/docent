import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { removeProvider, updateProvider } from '$lib/storage/settings.server.js';
import { providerFields, publicProvider } from '$lib/server/fields.js';
import { bodyOf, noContent, notFound } from '$lib/api/http.server.js';

export const PUT: RequestHandler = async ({ params: { id }, request }) => {
	const checked = providerFields(await bodyOf(request), true);
	if ('error' in checked) return json(checked, { status: 400 });
	const provider = updateProvider(id, checked.fields);
	if (!provider) return notFound('No such provider.');
	return json({ provider: publicProvider(provider) });
};

export const DELETE: RequestHandler = ({ params: { id } }) => (removeProvider(id) ? noContent() : notFound('No such provider.'));
