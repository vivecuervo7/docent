import { describe, expect, it } from 'vitest';
import { gitFailure } from './gitError';

describe('gitFailure', () => {
	it('says a killed command timed out', () => {
		const err = { killed: true, signal: 'SIGTERM', code: null, message: 'Command failed: git cat-file blob abc:a.ts\n' };
		expect(gitFailure(err, 'reading a.ts', 120_000)).toBe('Git timed out after 120s reading a.ts.');
	});

	it("keeps git's complaints and drops its advice", () => {
		const err = {
			code: 128,
			message: [
				'Command failed: git cat-file blob abc:d/b.txt',
				"fatal: '/x/gone' does not appear to be a git repository",
				'fatal: Could not read from remote repository.',
				'',
				'Please make sure you have the correct access rights',
				'and the repository exists.',
				"fatal: '/x/gone' does not appear to be a git repository",
				'fatal: could not fetch 587be6b from promisor remote',
				''
			].join('\n')
		};
		expect(gitFailure(err, 'reading d/b.txt', 120_000)).toBe(
			"Git failed reading d/b.txt: '/x/gone' does not appear to be a git repository; Could not read from remote repository.; could not fetch 587be6b from promisor remote"
		);
	});

	it('falls back to the last line, or the exit code', () => {
		expect(gitFailure({ code: 2, message: 'Command failed: git grep\nsomething odd\n' }, 'searching', 120_000)).toBe('Git failed searching: something odd');
		expect(gitFailure({ code: 2, message: 'Command failed: git grep\n' }, 'searching', 120_000)).toBe('Git failed searching: exit code 2');
	});

	it('cuts a long complaint short', () => {
		const out = gitFailure({ code: 128, message: `Command failed: git x\nfatal: ${'a'.repeat(500)}` }, 'reading', 120_000);
		expect(out.length).toBeLessThan(340);
		expect(out.endsWith('…')).toBe(true);
	});
});
