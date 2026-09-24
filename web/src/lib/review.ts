import type { PrRecord, Slice } from './types';

// What counts as reviewed: the hunks the reviewer ticked, plus - while
// "Review tests automatically" is on - test files whose note says what they
// test. The reviewer's own tick or untick always wins. Worked out, never
// saved, so turning the option off brings those files straight back.

export function autoReviewedKeys(record: PrRecord, on: boolean): Set<string> {
	const keys = new Set<string>();
	if (!on || !record.fileNotes) return keys;
	for (const slice of record.slices ?? []) {
		for (const note of record.fileNotes[slice.id] ?? []) {
			if (note.kind !== 'tests') continue;
			for (const hunk of slice.hunks) {
				if (hunk.startsWith(`${note.path}#`) && !(hunk in record.reviewed)) keys.add(hunk);
			}
		}
	}
	return keys;
}

export function effectiveReviewed(record: PrRecord, autoReviewTests: boolean): Record<string, boolean> {
	const auto = autoReviewedKeys(record, autoReviewTests);
	if (!auto.size) return record.reviewed;
	const merged = { ...record.reviewed };
	for (const key of auto) merged[key] = true;
	return merged;
}

export function isSliceReviewed(slice: Slice, reviewed: Record<string, boolean>): boolean {
	return slice.hunks.length > 0 && slice.hunks.every((key) => reviewed[key]);
}

// Hunks no slice claims, as one last slice so nothing goes unread.
export function everythingElse(hunkKeys: string[], slices: Slice[]): Slice | null {
	const claimed = new Set(slices.flatMap((s) => s.hunks));
	const hunks = hunkKeys.filter((k) => !claimed.has(k));
	return hunks.length
		? { id: 'everything-else', title: 'Everything else', summary: 'Changes no slice above covers.', hunks }
		: null;
}

// Viewing preferences, kept in this browser.
export function readPref(key: string, fallback: boolean): boolean {
	try {
		const value = localStorage.getItem(key);
		return value === null ? fallback : value === 'true';
	} catch {
		return fallback;
	}
}

export function writePref(key: string, value: boolean) {
	try {
		localStorage.setItem(key, String(value));
	} catch {
		// Not kept, which only means the default next time.
	}
}
