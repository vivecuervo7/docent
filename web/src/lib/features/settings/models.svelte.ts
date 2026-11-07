import { listModels, selectModel } from '$lib/api/client';
import type { ModelOption } from '$lib/types';

// The models Docent can use and the one it does: one answer the menu at the
// top and Settings share, so choosing in either shows in both. The list as
// last seen in this browser is there from the first paint.
const KEPT = 'docent.models';
let current = $state<{ options: ModelOption[]; selected: string } | null>(kept());
let listed: Promise<void> | null = null;

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

// Listed once; `fresh` lists them again, as after a provider changes.
export function loadModels(fresh = false): Promise<void> {
	if (!fresh && listed) return listed;
	const run = listModels(fresh)
		.then((answer) => {
			current = answer;
			try {
				localStorage.setItem(KEPT, JSON.stringify(answer));
			} catch {
				// Not kept: the menu waits for the list next time.
			}
		})
		.catch(() => {});
	if (!fresh) listed = run;
	return run;
}

export async function chooseModel(model: string): Promise<void> {
	if (!current || model === current.selected) return;
	const previous = current.selected;
	current.selected = model;
	current.selected = await selectModel(model).catch(() => previous);
}
