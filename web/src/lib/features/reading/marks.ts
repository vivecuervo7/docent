import { groupsOf, isShown, reviewerName } from '../panel/findings';
import { isNewFinding, isUnread, type GitHubComments, type GitHubThread, type LineRef, type Note, type PrRecord, type Severity } from '../../types';

// Anything with a pin on the diff: a reviewer's thread, an agent's finding,
// or a thread someone left on GitHub.
export interface Mark {
	id: string;
	kind: 'note' | 'finding' | 'github';
	path: string;
	start: LineRef;
	end: LineRef;
	who: string;
	body: string;
	rationale?: string;
	included?: boolean;
	// A thread's own record, for its messages and hunk.
	note?: Note;
	// A GitHub thread, as GitHub has it.
	github?: GitHubThread;
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
	// Why the editor filtered it out, when filtered findings are shown.
	filtered?: string;
	severity?: Severity;
	// What the reviewers it's grouped with disagree with it about.
	disputed?: string[];
}

// A finding with no lines to sit on: about a whole file, or, with no path,
// the whole PR.
export type LooseMark = Omit<Mark, 'path' | 'start' | 'end'> & { path?: string };

// The panel's findings as shown, each as a mark: with its lines, or loose.
// With `filtered`, those the editor filtered out too.
function findingMarks(record: PrRecord, filtered = false): (LooseMark & { start?: LineRef; end?: LineRef })[] {
	const { membersOf, joined, exists } = groupsOf(record);
	return Object.entries(record.feedback)
		.filter(([key]) => key.startsWith('agent-'))
		.flatMap(([key, draft]) =>
			(draft?.items ?? [])
				.filter((item) => (isShown(item) || (filtered && !!item.filtered)) && !joined(key, item))
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
					...(item.filtered ? { filtered: item.filtered } : {}),
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
export function looseMarksFrom(record: PrRecord, filtered = false): LooseMark[] {
	return findingMarks(record, filtered).filter((m) => !m.start);
}

export function marksFrom(record: PrRecord, filtered = false): Mark[] {
	const findings = findingMarks(record, filtered).filter((m): m is Mark => !!m.path && !!m.start);
	// A thread about something said on GitHub opens from that thread's pin.
	const notes = record.notes.flatMap((note): Mark[] =>
		note.start && note.end && !note.github
			? [{ id: note.id, kind: 'note', path: note.path, start: note.start, end: note.end, who: 'You', body: note.messages[0]?.text ?? '', note }]
			: []
	);
	return [...notes, ...findings];
}

// GitHub's threads that sit on lines at the PR's head, each with your
// thread about it, if you've begun one.
export function githubMarksFrom(comments: GitHubComments | null, record: PrRecord): Mark[] {
	return (comments?.threads ?? []).flatMap((t): Mark[] => {
		if (!t.start || !t.end) return [];
		const note = record.notes.find((n) => n.github === t.id);
		return [
			{
				id: t.id,
				kind: 'github',
				path: t.path,
				start: t.start,
				end: t.end,
				who: t.entries[0]?.author ?? '',
				body: t.entries[0]?.body ?? '',
				github: t,
				...(note ? { note, unread: isUnread(note) } : {})
			}
		];
	});
}

// GitHub's threads on a file without lines to sit on: outdated, or about
// the whole file.
export function looseGitHubThreads(comments: GitHubComments | null, path: string): GitHubThread[] {
	return (comments?.threads ?? []).filter((t) => t.path === path && !t.start);
}

// Your threads without lines: on a whole file, or with no path on the PR.
export function looseNotesFrom(record: PrRecord): Note[] {
	return record.notes.filter((note) => !note.start && !note.github);
}
