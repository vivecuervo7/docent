import { json } from '@sveltejs/kit';
import { DEFAULT_REVIEWER, REVIEWER_RE } from '../server/agentReview.js';

// What Docent's API routes share: checking a PR's owner, repo and number,
// reading a JSON body, and answering with an error.

const OWNER_REPO_RE = /^[A-Za-z0-9._-]+$/;
const NUMBER_RE = /^[0-9]+$/;

export function validParams(owner: string, repo: string, number: string): boolean {
	return OWNER_REPO_RE.test(owner) && OWNER_REPO_RE.test(repo) && NUMBER_RE.test(number);
}

export const badRequest = (error: string) => json({ error }, { status: 400 });
export const notFound = (error: string) => json({ error }, { status: 404 });
export const noContent = () => new Response(null, { status: 204 });

// A failure from GitHub or a model, reported to the page.
export const failed = (err: unknown) => json({ error: (err as Error).message }, { status: 502 });

// A call held open until a model answers, stopped if the page goes first.
// SvelteKit's request.signal only fires when the page goes before its body
// is read, so the answer is streamed instead: SvelteKit cancels the stream
// when the connection closes. The status is sent before the answer is known,
// so a failure comes back in the body; the page reads it with readHeld.
export function heldOpen(work: (signal: AbortSignal) => Promise<unknown>): Response {
	const controller = new AbortController();
	const body = new ReadableStream<Uint8Array>({
		start(stream) {
			work(controller.signal)
				.then(
					(result) => ({ result }),
					(err) => ({ error: (err as Error).message })
				)
				.then((out) => {
					if (controller.signal.aborted) return;
					stream.enqueue(new TextEncoder().encode(JSON.stringify(out)));
					stream.close();
				});
		},
		cancel: () => controller.abort()
	});
	return new Response(body, { headers: { 'Content-Type': 'application/json' } });
}

// The request's JSON body, or an empty one.
export async function bodyOf(request: Request): Promise<Record<string, any>> {
	try {
		const body = await request.json();
		return body && typeof body === 'object' ? body : {};
	} catch {
		return {};
	}
}

// The review's own model, when the request names one; otherwise the model
// picked on the start page is used.
export function reviewModel(body: Record<string, any>): string | undefined {
	const model = body?.model;
	return typeof model === 'string' && model.trim() && model.length <= 200 ? model.trim() : undefined;
}

// Which of the PR's reviewer entries a request is about: `?reviewer=agent-2`,
// or the first one.
export function reviewerParam(url: URL): string | null {
	const reviewer = url.searchParams.get('reviewer') ?? DEFAULT_REVIEWER;
	return REVIEWER_RE.test(reviewer) ? reviewer : null;
}

// Docent's MCP endpoint, as a session started from this request reaches it.
export const mcpUrl = (url: URL) => `${url.origin}/mcp`;
