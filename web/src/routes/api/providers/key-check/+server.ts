import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { badRequest, bodyOf, forbidden, fromThisApp } from '$lib/api/http.server.js';
import { checkKeyCommand } from '$lib/models/providerKey.server.js';

// Whether a key command gives a key, for Settings; the key itself stays here.
export const POST: RequestHandler = async ({ request, url }) => {
	if (!fromThisApp(request, url)) return forbidden('A key command can only be checked from Docent on this machine.');
	const { command } = await bodyOf(request);
	if (typeof command !== 'string' || !command.trim() || command.length > 500) return badRequest('Give it a command to run.');
	return json(await checkKeyCommand(command.trim()));
};
