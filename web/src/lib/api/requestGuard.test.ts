import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { guard, refusal } from './requestGuard.server.js';

const request = (method: string, headers: Record<string, string>) => new Request('http://localhost:17321/api/prs', { method, headers });
const url = new URL('http://localhost:17321/api/prs');

describe('refusal', () => {
	it('lets this machine through by any of its names, on any port', () => {
		for (const host of ['localhost:17321', '127.0.0.1:17400', '[::1]:17321', 'localhost']) {
			expect(refusal(request('GET', { host }), url)).toBeNull();
		}
	});

	it('refuses a Host that names another machine, as a rebound domain does', () => {
		for (const host of ['evil.test', 'evil.test:17321', 'localhost.evil.test', '192.168.1.5:17321']) {
			expect(refusal(request('GET', { host }), url)).not.toBeNull();
		}
	});

	it('refuses a request with no Host, or one that is not a host at all', () => {
		expect(refusal(request('GET', {}), url)).not.toBeNull();
		expect(refusal(request('GET', { host: 'local host' }), url)).not.toBeNull();
	});

	it('lets a change through from its own page, by any method', () => {
		for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
			expect(refusal(request(method, { host: 'localhost:17321', origin: 'http://localhost:17321' }), url)).toBeNull();
		}
	});

	// SvelteKit itself still refuses a bodiless one in a built Docent; an
	// agent's JSON request, like /mcp's, goes through.
	it('leaves a change with no Origin to the route, as agents send none', () => {
		expect(refusal(request('POST', { host: 'localhost:17321' }), url)).toBeNull();
	});

	it('refuses a change from another origin, including an opaque one', () => {
		for (const origin of ['http://evil.test', 'https://localhost:17321', 'http://localhost:9999', 'null']) {
			for (const method of ['POST', 'PUT', 'DELETE']) {
				expect(refusal(request(method, { host: 'localhost:17321', origin }), url)).not.toBeNull();
			}
		}
	});

	it('lets a read through whatever its Origin, as reads change nothing', () => {
		for (const method of ['GET', 'HEAD', 'OPTIONS']) {
			expect(refusal(request(method, { host: 'localhost:17321', origin: 'http://evil.test' }), url)).toBeNull();
		}
	});
});

describe('guard', () => {
	// Only the parts of a request event the guard reads.
	const run = (href: string, method = 'GET', headers: Record<string, string> = { host: 'localhost:17321' }) => {
		const url = new URL(href);
		const event = { url, request: new Request(url, { method, headers }) } as RequestEvent;
		return guard({ event, resolve: async () => new Response('page') });
	};

	it('answers what it lets through, and forbids other sites to frame it', async () => {
		const response = await run('http://localhost:17321/');
		expect(await response.text()).toBe('page');
		expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
	});

	it('refuses with an error the page reads, or a JSON-RPC one on /mcp', async () => {
		const page = await run('http://localhost:17321/api/prs', 'GET', { host: 'evil.test' });
		expect(page.status).toBe(403);
		expect((await page.json()).error).toMatch(/this machine/);
		const mcp = await run('http://localhost:17321/mcp', 'POST', { host: 'evil.test' });
		expect(mcp.status).toBe(403);
		expect((await mcp.json()).error.code).toBe(-32000);
	});

	it('says to start with npm start when the server takes itself to be https, in either shape', async () => {
		const page = await run('https://localhost:17321/');
		expect(page.status).toBe(500);
		expect((await page.json()).error).toMatch(/npm start/);
		const mcp = await run('https://localhost:17321/mcp', 'POST');
		expect(mcp.status).toBe(500);
		expect((await mcp.json()).error.message).toMatch(/npm start/);
	});
});
