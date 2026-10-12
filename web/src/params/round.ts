import type { ParamMatcher } from '@sveltejs/kit';

// A round of a PR's review in its URL: "round-2". None is the latest.
export const match: ParamMatcher = (param) => /^round-[1-9]\d*$/.test(param);
