import type { GitHubThread, PrFile, ThreadCheck } from '../../types';

// GitHub threads as the Overview goes through them: by what checking them
// against the round found.

export type Verdict = NonNullable<ThreadCheck['verdict']>;

export const VERDICTS: { verdict: Verdict; label: string }[] = [
	{ verdict: 'addressed', label: 'Look addressed' },
	{ verdict: 'not-yet', label: 'Not yet resolved' },
	{ verdict: 'unclear', label: 'Unclear' }
];

// A check still standing: one made since the thread's last reply.
export function checkOf(checks: Record<string, ThreadCheck> | undefined, thread: GitHubThread): ThreadCheck | undefined {
	const check = checks?.[thread.id];
	return check && check.entries === thread.entries.length ? check : undefined;
}

// Whether the round changed a thread's lines, or its file when they've moved.
export function touchedBy(files: PrFile[], thread: GitHubThread): boolean {
	const file = files.find((f) => f.filename === thread.path);
	if (!file) return false;
	if (!file.rangeLines || !thread.start || !thread.end) return true;
	const { line: a } = thread.start;
	const { line: b } = thread.end;
	return file.rangeLines.new.some((n) => n >= a && n <= b);
}

export function threadWhere(thread: GitHubThread): string {
	const file = thread.path.split('/').pop();
	if (thread.start && thread.end) {
		const { line: a } = thread.start;
		const { line: b } = thread.end;
		return `${file}:${a === b ? a : `${a}–${b}`}`;
	}
	return file ?? thread.path;
}

// The first line of what started it.
export const gist = (thread: GitHubThread) => thread.entries[0]?.body.trim().split('\n')[0] ?? '';
