import { groupsOf, isShown, reviewerName } from '../panel/findings';
import { isNewFinding, isUnread, type LineRef, type Note, type PrRecord, type Severity } from '../../types';

// Anything with a pin on the diff: a reviewer's thread, or an agent's finding.
export interface Mark {
	id: string;
	kind: 'note' | 'finding';
	path: string;
	start: LineRef;
	end: LineRef;
	who: string;
	body: string;
	rationale?: string;
	included?: boolean;
	// A thread's own record, for its messages and hunk.
	note?: Note;
	// The agent reviewer a finding came from.
	reviewer?: string;
	// Whether the reviewer has kept or skipped the finding yet.
	decided?: boolean;
	// A finding with an answer to a question the reviewer hasn't read yet.
	unread?: boolean;
	// Other findings making the same point, grouped under this one.
	alsoBy?: { reviewer: string; id: string; who: string; body: string; rationale?: string; path?: string; line?: number; disputed?: string }[];
	// The lead of a group it was separated from.
	separatedFrom?: { who: string };
	// What it assumes, when nothing settles it.
	speculative?: string;
	// The PR thread already raising it.
	onPr?: string;
	setAside?: string;
	impact?: string;
	impactLevel?: string;
	checked?: string;
	checkedVerdict?: string;
	skipSuggested?: string;
	severity?: Severity;
	// What the reviewers it's grouped with disagree with it about.
	disputed?: string[];
}

// A finding with no lines to sit on: about a whole file, or, with no path,
// the whole PR.
export type LooseMark = Omit<Mark, 'path' | 'start' | 'end'> & { path?: string };

// The panel's findings as shown, each as a mark: with its lines, or loose.
function findingMarks(record: PrRecord): (LooseMark & { start?: LineRef; end?: LineRef })[] {
	const { membersOf, joined, exists } = groupsOf(record);
	return Object.entries(record.feedback)
		.filter(([key]) => key.startsWith('agent-'))
		.flatMap(([key, draft]) =>
			(draft?.items ?? [])
				.filter((item) => isShown(item) && !joined(key, item))
				.map((item) => ({
					id: item.id,
					kind: 'finding' as const,
					...(item.path ? { path: item.path } : {}),
					...(item.path && item.start ? { start: item.start, end: item.end ?? item.start } : {}),
					who: reviewerName(record, key),
					body: item.body,
					rationale: item.rationale,
					...(item.speculative ? { speculative: item.speculative } : {}),
					...(item.onPr ? { onPr: item.onPr } : {}),
					...(item.setAside ? { setAside: item.setAside } : {}),
					...(item.impact ? { impact: item.impact, impactLevel: item.impactLevel } : {}),
					...(item.checked ? { checked: item.checked, checkedVerdict: item.checkedVerdict } : {}),
					...(item.skipSuggested ? { skipSuggested: item.skipSuggested } : {}),
					...(item.severity ? { severity: item.severity } : {}),
					included: item.included,
					decided: item.decided,
					unread: isUnread(item) || isNewFinding(item),
					reviewer: key,
					alsoBy: membersOf(key, item.id).map(({ reviewer, item: m }) => ({
						reviewer,
						id: m.id,
						who: reviewerName(record, reviewer),
						body: m.body,
						rationale: m.rationale,
						path: m.path,
						line: m.start?.line,
						...(m.disputed ? { disputed: m.disputed } : {})
					})),
					...(item.separatedFrom && exists(item.separatedFrom.reviewer, item.separatedFrom.id)
						? { separatedFrom: { who: reviewerName(record, item.separatedFrom.reviewer) } }
						: {}),
					...(() => {
						const disputed = membersOf(key, item.id).flatMap(({ item: m }) => (m.disputed ? [m.disputed] : []));
						return disputed.length ? { disputed } : {};
					})()
				}))
		);
}

// The findings without lines, for a file's header or the PR's overview.
export function looseMarksFrom(record: PrRecord): LooseMark[] {
	return findingMarks(record).filter((m) => !m.start);
}

export function marksFrom(record: PrRecord): Mark[] {
	const findings = findingMarks(record).filter((m): m is Mark => !!m.path && !!m.start);
	const notes = record.notes.map(
		(note): Mark => ({
			id: note.id,
			kind: 'note',
			path: note.path,
			start: note.start,
			end: note.end,
			who: 'You',
			body: note.messages[0]?.text ?? '',
			note
		})
	);
	return [...notes, ...findings];
}
