import { listModels, selectModel } from '$lib/api/client';
import type { ModelOption } from '$lib/types';

// The models Docent can use and the one it does: one answer the menu at the
// top and Settings share, so choosing in either shows in both. The list as
// last seen in this browser is there from the first paint.
const KEPT = 'docent.models';
type Listing = { options: ModelOption[]; selected: string };
let current = $state<Listing | null>(kept());
let listed: Promise<Listing | null> | null = null;

function kept() {
	try {
		return JSON.parse(localStorage.getItem(KEPT) ?? 'null');
	} catch {
		return null;
	}
}

export const models = {
	get current() {
		return current;
	}
};

// Listed once, and again with `fresh`, as after a provider changes or setup
// is checked again. The latest listing is what later calls get, and one that
// failed isn't kept, so the next call tries again. Gives back what was listed,
// or null if it failed.
export function loadModels(fresh = false): Promise<Listing | null> {
	if (!fresh && listed) return listed;
	const run: Promise<Listing | null> = listModels(fresh)
		.then((answer) => {
			current = answer;
			try {
				localStorage.setItem(KEPT, JSON.stringify(answer));
			} catch {
				// Not kept: the menu waits for the list next time.
			}
			return answer;
		})
		.catch(() => {
			if (listed === run) listed = null;
			return null;
		});
	listed = run;
	return run;
}

export async function chooseModel(model: string): Promise<void> {
	if (!current || model === current.selected) return;
	const previous = current.selected;
	current.selected = model;
	const selected = await selectModel(model).catch(() => previous);
	// A new answer once the server has it, so what follows Docent's model
	// (an unset editor) reads it again then, not only while it was saving.
	if (current) current = { ...current, selected };
}
