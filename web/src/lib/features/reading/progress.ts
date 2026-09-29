import type { Slice } from '../../types';

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
