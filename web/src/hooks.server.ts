import { json, type Handle } from '@sveltejs/kit';
// Keeps the stats from the start, so no review saved before they're first
// opened goes unrecorded.
import '$lib/features/stats/stats.server.js';
import { persistent } from '$lib/storage/persistent.server.js';

// Background work nothing waits on - saving a finished job, say - that fails
// anyway is logged, rather than stopping the server.
persistent('unhandled-rejections', () => process.on('unhandledRejection', (err) => console.error('[unhandled]', err)));

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
