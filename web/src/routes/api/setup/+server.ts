import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { mcpUrl } from '$lib/api/http.server.js';
import { checkSetup } from '$lib/features/settings/setupChecks.server.js';

// What's set up on this machine, for the Getting started page.
export const GET: RequestHandler = async ({ url }) => json(await checkSetup(mcpUrl(url)));
