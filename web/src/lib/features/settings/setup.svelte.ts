import { readOk } from '#lib/api/client.js';

// What's set up on this machine, as last checked: one answer every page
// shares, so the header and Getting started agree, and moving between pages
// doesn't run the checks again. Undefined until the first answer comes.
export interface SetupCheck {
	gh: { installed: boolean; login?: string; name?: string; avatar?: string };
	claude: { installed: boolean; version?: string };
	codex: { installed: boolean; version?: string };
	// Added here, or at another address that needs replacing.
	mcp: Record<'claude' | 'codex', { added: boolean; elsewhere?: string }>;
}

let current = $state<SetupCheck | null | undefined>(undefined);
let first: Promise<void> | null = null;

export const setup = {
	get current() {
		return current;
	}
};

// The answer as last checked, fetched once; `fresh` checks everything again now.
export function checkSetup(fresh = false): Promise<void> {
	if (!fresh && first) return first;
	const run = fetch(fresh ? '/api/setup?fresh' : '/api/setup')
		.then((res) => readOk<SetupCheck>(res))
		.then(
			(answer) => {
				current = answer;
			},
			(err) => {
				if (current === undefined) current = null;
				throw err;
			}
		);
	if (!fresh) first = run.catch(() => {});
	return run;
}
