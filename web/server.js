// A built Docent's server: adapter-node's handler, on plain http.
import http from 'node:http';

// adapter-node takes a request's protocol from a header that a proxy in front
// of it sets, and otherwise assumes https. Docent has no proxy and serves
// http, so every request is told as much, over anything it arrived with.
// Without it, each request's URL, and the origin SvelteKit checks requests'
// Origin against, would claim https. The handler reads which header to look
// at as it loads.
const PROTOCOL_HEADER = 'x-docent-protocol';
process.env.PROTOCOL_HEADER = PROTOCOL_HEADER;
const { handler } = await import('./build/handler.js');

const host = process.env.HOST ?? 'localhost';
const port = Number(process.env.PORT ?? 17321);

const server = http.createServer((req, res) => {
	req.headers[PROTOCOL_HEADER] = 'http';
	handler(req, res, () => {
		res.statusCode = 404;
		res.end();
	});
});

server.on('error', (err) => {
	console.error(`Docent couldn't start: ${err.message}`);
	process.exit(1);
});
server.listen(port, host, () => console.log(`Listening on http://${host}:${port}`));

// Finishes the requests under way, then stops; any still going after half a
// minute are cut off.
for (const signal of ['SIGINT', 'SIGTERM']) {
	process.once(signal, () => {
		server.close(() => process.exit(0));
		server.closeIdleConnections();
		setTimeout(() => server.closeAllConnections(), 30_000).unref();
	});
}
