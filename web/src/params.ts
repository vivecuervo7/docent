import { defineParams } from '@sveltejs/kit/params';

// A round of a PR's review in its URL: "round-2". None is the latest.
const matchRound = (param: string) => /^round-[1-9]\d*$/.test(param);

export const params = defineParams({
	round: (param) => (matchRound(param) ? param : undefined)
});
