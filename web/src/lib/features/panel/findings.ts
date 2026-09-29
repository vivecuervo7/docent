import type { FeedbackItem, PrRecord } from '../../types';
import { reviewerLabel } from './reviewers.svelte';

// How the panel's findings are shown: which are, how they group, and who
// raised them.

// How many reviewers raised a group's point: "Raised by 3 reviewers", or a
// reviewer repeating itself, "Raised twice by amber-ferret".
export function raisedBy(who: string, alsoBy: { who: string }[]): string {
	const reviewers = new Set([who, ...alsoBy.map((a) => a.who)]).size;
	if (reviewers > 1) return `Raised by ${reviewers} reviewers`;
	const times = alsoBy.length + 1;
	return `Raised ${times === 2 ? 'twice' : `${times} times`} by ${who}`;
}

// Whether a panel finding is shown: once the editor has been through it,
// unless it filtered it out.
export const isShown = (item: Pick<FeedbackItem, 'edited' | 'editFailed' | 'filtered'>) =>
	(!!item.edited || !!item.editFailed) && !item.filtered;

// Findings that joined another as the same point, by the lead they joined;
// a finding whose lead has gone stands on its own again. Only findings
// shown count.
export function groupsOf(record: PrRecord) {
	const items = Object.entries(record.feedback)
		.filter(([key]) => key.startsWith('agent-'))
		.flatMap(([reviewer, draft]) => (draft?.items ?? []).filter(isShown).map((item) => ({ reviewer, item })));
	const exists = (reviewer: string, id: string) => items.some((x) => x.reviewer === reviewer && x.item.id === id);
	const members = new Map<string, typeof items>();
	for (const x of items) {
		const j = x.item.joins;
		if (!j || !exists(j.reviewer, j.id)) continue;
		const key = `${j.reviewer}/${j.id}`;
		members.set(key, [...(members.get(key) ?? []), x]);
	}
	const joined = (reviewer: string, item: { joins?: { reviewer: string; id: string } }) =>
		!!item.joins && exists(item.joins.reviewer, item.joins.id);
	return { membersOf: (reviewer: string, id: string) => members.get(`${reviewer}/${id}`) ?? [], joined, exists };
}

// A reviewer's name, as the panel shows it.
export function reviewerName(record: PrRecord, id: string): string {
	return reviewerLabel(record.agentReviewers, id);
}
