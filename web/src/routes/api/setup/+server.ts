import type { RequestHandler } from './$types';
import { mcpUrl } from '#lib/api/http.server.js';
import { setupCheck } from '#lib/features/settings/setupChecks.server.js';

// What's set up on this machine, as last checked unless `?fresh` asks for it
// checked again now.
export const GET: RequestHandler = async ({ url }) => {
	mcpUrl(url);
	return Response.json(await (url.searchParams.has('fresh') ? setupCheck.fresh() : setupCheck.get()));
};
