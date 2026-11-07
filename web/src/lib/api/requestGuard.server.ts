// Docent runs on this machine for whoever sits at it, so it answers only
// requests addressed to this machine by name. A site the browser has open
// can still send requests here, two ways:
//
// - By pointing a domain of its own at this machine (DNS rebinding), so the
//   request arrives with that domain as its Host. SvelteKit's own cross-site
//   check can't catch this: it compares the request's Origin with the
//   server's, and the server's is worked out from that same Host. Refusing
//   any Host but this machine's is what stops it.
// - By sending a request straight to localhost, where its Origin gives it
//   away. Agents send no Origin, so a change is refused here only when an
//   Origin says it came from somewhere else. (In a built Docent, SvelteKit
//   itself still refuses a bodiless change with no Origin before this runs;
//   agents' JSON requests are unaffected.)

import type { Handle } from '@sveltejs/kit/hooks';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const UNCHANGING = new Set(['GET', 'HEAD', 'OPTIONS']);

// Why a request is refused, or null when it may go ahead.
export function refusal(request: Request, url: URL): string | null {
	if (!LOCAL_HOSTNAMES.has(hostnameOf(request.headers.get('host')))) return 'Docent only answers requests addressed to this machine.';
	const origin = request.headers.get('origin');
	if (!UNCHANGING.has(request.method) && origin !== null && origin !== url.origin) return 'Docent only accepts changes from its own pages.';
	return null;
}

// The hook in hooks.server.ts: it runs for every request SvelteKit answers,
// pages included, as a domain rebound to this machine would otherwise be
// served as if it were Docent's own. (The built files under _app and static/
// are served before it; they're the same for anyone.)
export const guard: Handle = async ({ event, resolve }) => {
	const problem = problemWith(event.request, event.url);
	if (problem && event.url.pathname === '/mcp') {
		return Response.json({ jsonrpc: '2.0', error: { code: -32000, message: problem.message }, id: null }, { status: problem.status });
	}
	if (problem) return Response.json({ error: problem.message }, { status: problem.status });
	const response = await resolve(event);
	// No other site may show Docent in a frame, where clicks it tricks the
	// user into would come from Docent's own page.
	response.headers.set('content-security-policy', "frame-ancestors 'none'");
	return response;
};

function problemWith(request: Request, url: URL): { status: number; message: string } | null {
	// Only server.js tells a built Docent it's on http. Started any other way
	// it takes itself to be https, and every change its own pages make would
	// be refused as coming from elsewhere.
	if (url.protocol !== 'http:') return { status: 500, message: 'Start a built Docent with `npm start`, which serves it on http.' };
	const refused = refusal(request, url);
	return refused ? { status: 403, message: refused } : null;
}

function hostnameOf(host: string | null): string {
	try {
		return host ? new URL(`http://${host}`).hostname : '';
	} catch {
		return '';
	}
}
