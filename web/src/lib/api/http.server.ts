import { DEFAULT_REVIEWER, REVIEWER_RE } from '../features/panel/agentReviews.server.js';
import { rememberMcpUrl } from './mcpUrl.server.js';

// What Docent's API routes share: checking a PR's owner, repo and number,
// reading a JSON body, and answering with an error.

const OWNER_REPO_RE = /^[A-Za-z0-9._-]+$/;
const NUMBER_RE = /^[0-9]+$/;

export function validParams(owner: string, repo: string, number: string): boolean {
	return OWNER_REPO_RE.test(owner) && OWNER_REPO_RE.test(repo) && NUMBER_RE.test(number);
}

export const badRequest = (error: string) => Response.json({ error }, { status: 400 });
export const notFound = (error: string) => Response.json({ error }, { status: 404 });
export const noContent = () => new Response(null, { status: 204 });
export const forbidden = (error: string) => Response.json({ error }, { status: 403 });

// Whether a request says it came from one of Docent's own pages, for the
// routes that save or run a command: a page on any other site, and an agent,
// which sends no Origin, are refused. The hook in hooks.server.ts has already
// refused other machines' names.
export const fromThisApp = (request: Request, url: URL) => request.headers.get('origin') === url.origin;

// A failure from GitHub or a model, reported to the page.
export const failed = (err: unknown) => Response.json({ error: (err as Error).message }, { status: 502 });

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
export const mcpUrl = (url: URL) => rememberMcpUrl(`${url.origin}/mcp`);
