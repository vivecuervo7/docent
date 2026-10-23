import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { removeProvider, updateProvider } from '$lib/storage/settings.server.js';
import { providerFields, publicProvider } from '$lib/features/settings/fields.server.js';
import { bodyOf, forbidden, fromThisApp, noContent, notFound } from '$lib/api/http.server.js';

export const PUT: RequestHandler = async ({ params: { id }, request, url }) => {
	const body = await bodyOf(request);
	if (typeof body.apiKeyCommand === 'string' && body.apiKeyCommand.trim() && !fromThisApp(request, url)) return forbidden('A key command can only be saved from Docent on this machine.');
	const checked = providerFields(body, true);
	if ('error' in checked) return json(checked, { status: 400 });
	const provider = updateProvider(id, checked.fields);
	if (!provider) return notFound('No such provider.');
	return json({ provider: publicProvider(provider) });
};

export const DELETE: RequestHandler = ({ params: { id } }) => (removeProvider(id) ? noContent() : notFound('No such provider.'));
