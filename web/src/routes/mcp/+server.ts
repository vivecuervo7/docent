import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildServer } from '$lib/mcp/mcp.server.js';

// MCP, for the reviewer's own agent and external reviewers' sessions. Local
// only: hooks.server.ts refuses other hosts, so sites the browser has open
// can't reach it. Stateless, with a fresh server per request.
export const POST: RequestHandler = async ({ request }) => {
	const server = buildServer();
	try {
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true,
			maxRequestBodySize: 20 * 1024 * 1024
		});
		await server.connect(transport);
		const response = await transport.handleRequest(request);
		await transport.close();
		await server.close();
		return response;
	} catch {
		return json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }, { status: 500 });
	}
};

const notAllowed: RequestHandler = () => json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }, { status: 405 });
export const GET = notAllowed;
export const DELETE = notAllowed;
