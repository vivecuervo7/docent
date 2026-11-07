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

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const UNCHANGING = new Set(['GET', 'HEAD', 'OPTIONS']);

// Why a request is refused, or null when it may go ahead.
export function refusal(request: Request, url: URL): string | null {
	if (!LOCAL_HOSTNAMES.has(hostnameOf(request.headers.get('host')))) return 'Docent only answers requests addressed to this machine.';
	const origin = request.headers.get('origin');
	if (!UNCHANGING.has(request.method) && origin !== null && origin !== url.origin) return 'Docent only accepts changes from its own pages.';
	return null;
}

function hostnameOf(host: string | null): string {
	try {
		return host ? new URL(`http://${host}`).hostname : '';
	} catch {
		return '';
	}
}
