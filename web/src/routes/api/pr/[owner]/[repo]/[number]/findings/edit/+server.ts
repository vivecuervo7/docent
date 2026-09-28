import type { RequestHandler } from './$types';
import { editFindings } from '$lib/server/grouping.js';
import { badRequest, bodyOf, heldOpen, mcpUrl, validParams } from '$lib/server/http.js';

// The panel's editor, over new findings: which repeat a point already made,
// and, unless the reviewer sifted their own, which to filter out.
export const POST: RequestHandler = async ({ params: { owner, repo, number }, request, url }) => {
	const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
	const valid = (list: unknown) =>
		Array.isArray(list) &&
		list.length <= 300 &&
		list.every(
			(f) =>
				f &&
				text(f.id, 100) &&
				text(f.who, 200) &&
				text(f.location, 1000) &&
				text(f.body, 20_000) &&
				(f.rationale === undefined || text(f.rationale, 20_000)) &&
				(f.severity === undefined || text(f.severity, 20)) &&
				(f.setAside === undefined || text(f.setAside, 2000))
		);
	const { slice, fresh, shown, filter } = await bodyOf(request);
	if (!validParams(owner, repo, number) || !valid(fresh) || !valid(shown) || (slice !== undefined && !text(slice, 100))) {
		return badRequest('invalid findings');
	}
	return heldOpen(async (signal) => {
		if (!fresh.length) return { edits: {} };
		const edits = await editFindings(owner, repo, number, { slice, fresh, shown, filter: filter === true, mcpUrl: mcpUrl(url) }, signal);
		return { edits: Object.fromEntries(edits) };
	});
};
