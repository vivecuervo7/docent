import type { GitHubThread, ThreadCheck } from '../../types';

// GitHub threads as they're gone through: by what checking them found.

export type Verdict = NonNullable<ThreadCheck['verdict']>;

export const VERDICTS: { verdict: Verdict; label: string }[] = [
	{ verdict: 'addressed', label: 'Look addressed' },
	{ verdict: 'not-yet', label: 'Not yet resolved' },
	{ verdict: 'unclear', label: 'Unclear if resolved' }
];

// A check made before the latest commits, which may have dealt with more.
export function isStale(check: ThreadCheck | undefined, head: string | undefined): boolean {
	return !!check?.verdict && !!check.head && !!head && check.head !== head;
}

// A check still standing: one made since the thread's last reply.
export function checkOf(checks: Record<string, ThreadCheck> | undefined, thread: GitHubThread): ThreadCheck | undefined {
	const check = checks?.[thread.id];
	return check && check.entries === thread.entries.length ? check : undefined;
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
