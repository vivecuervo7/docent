import { loadPr } from '$lib/api';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ params, fetch }) => ({
	...params,
	...(await loadPr(fetch, params.owner, params.repo, params.number))
});
