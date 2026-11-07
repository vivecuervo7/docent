import type { Handle } from '@sveltejs/kit/hooks';

// Keeps the stats from the start, so no review saved before they're first
// opened goes unrecorded.
import '#lib/features/stats/stats.server.js';
import { persistent } from '#lib/storage/persistent.server.js';
// Marks work left under way by the last run as interrupted.
import '#lib/storage/interrupted.server.js';
// Marks rounds posted before posting marked them done.
import '#lib/storage/postedDone.server.js';
import { modelOptions } from '#lib/models/modelProvider.server.js';
import { setupCheck } from '#lib/features/settings/setupChecks.server.js';
import { refusal } from '#lib/api/requestGuard.server.js';

// What's installed and which models there are, looked at once the server
// starts, so the first page to ask has an answer waiting.
persistent('checks-warmed', () => {
	modelOptions.fresh().catch(() => {});
	setupCheck.fresh().catch(() => {});
	return true;
});

// Background work nothing waits on - saving a finished job, say - that fails
// anyway is logged, rather than stopping the server.
persistent('unhandled-rejections', () => process.on('unhandledRejection', (err) => console.error('[unhandled]', err)));

// Every request SvelteKit answers, pages included, as a domain rebound to
// this machine would otherwise be served as if it were Docent's own. (The
// built files under _app and static/ are served before this runs; they're
// the same for anyone.) See requestGuard.server.ts.
export const handle: Handle = async ({ event, resolve }) => {
	// Only server.js tells a built Docent it's on http. Started any other way
	// it takes itself to be https, and every change its own pages make would
	// be refused as coming from elsewhere.
	if (event.url.protocol !== 'http:') return new Response('Start a built Docent with `npm start`, which serves it on http.', { status: 500 });
	const refused = refusal(event.request, event.url);
	if (refused && event.url.pathname === '/mcp') return Response.json({ jsonrpc: '2.0', error: { code: -32000, message: refused }, id: null }, { status: 403 });
	if (refused) return Response.json({ error: refused }, { status: 403 });
	const response = await resolve(event);
	// No other site may show Docent in a frame, where clicks it tricks the
	// user into would come from Docent's own page.
	response.headers.set('content-security-policy', "frame-ancestors 'none'");
	return response;
};
