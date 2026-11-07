import { listModels, selectModel } from '#lib/api/client.js';
import type { ModelOption } from '#lib/types.js';

// The models Docent can use and the one it does: one answer the menu at the
// top and Settings share, so choosing in either shows in both. The list as
// last seen in this browser is there from the first paint.
const KEPT = 'docent.models';
type Listing = { options: ModelOption[]; selected: string };
let current = $state<Listing | null>(kept());
let listed: Promise<Listing | null> | null = null;
// Listings started, and the newest one shown, so one that finishes after a
// newer one isn't shown over it.
let started = 0;
let newestShown = 0;
// The choice being saved, and choices saved so far, so a listing from before
// them doesn't put the old choice back.
let saving: string | null = null;
let saves = 0;

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

function keep(listing: Listing) {
	current = listing;
	try {
		localStorage.setItem(KEPT, JSON.stringify(listing));
	} catch {
		// Not kept: the menu waits for the list next time.
	}
}

// Listed once, and again with `fresh`, as after a provider changes or setup
// is checked again. The newest listing that succeeds is shown and kept, and
// later calls get the latest one; one that failed isn't kept, so the next call
// tries again. Gives back what was listed, or null if it failed.
export function loadModels(fresh = false): Promise<Listing | null> {
	if (!fresh && listed) return listed;
	const run = ++started;
	const at = saves;
	const listing: Promise<Listing | null> = listModels(fresh)
		.then((answer) => {
			if (run > newestShown) {
				newestShown = run;
				keep({ ...answer, selected: saving ?? (at === saves || !current ? answer.selected : current.selected) });
			}
			return answer;
		})
		.catch(() => {
			if (listed === listing) listed = null;
			return null;
		});
	listed = listing;
	return listing;
}

export async function chooseModel(model: string): Promise<void> {
	if (!current || model === current.selected) return;
	const previous = current.selected;
	saving = model;
	current.selected = model;
	const selected = await selectModel(model).catch(() => null);
	saving = null;
	if (selected !== null) saves++;
	// A new answer once the server has it, so what follows Docent's model
	// (an unset editor) reads it again then, not only while it was saving.
	if (current) keep({ ...current, selected: selected ?? previous });
}
