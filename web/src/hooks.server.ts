import { json, type Handle } from '@sveltejs/kit';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

// MCP answers only requests addressed to this machine by name, so a site the
// browser has open can't reach it by pointing its own domain here.
export const handle: Handle = ({ event, resolve }) => {
	if (event.url.pathname === '/mcp' && !LOCAL_HOSTS.includes(hostnameOf(event.request.headers.get('host')))) {
		return json({ jsonrpc: '2.0', error: { code: -32000, message: 'Invalid Host' }, id: null }, { status: 403 });
	}
	return resolve(event);
};

function hostnameOf(host: string | null): string {
	try {
		return host ? new URL(`http://${host}`).hostname : '';
	} catch {
		return '';
	}
}
