import { describe, expect, it } from 'vitest';
import { filesInDiff } from './diffFiles';

const diff = [
	'diff --git a/src/a.ts b/src/a.ts',
	'index 1..2 100644',
	'--- a/src/a.ts',
	'+++ b/src/a.ts',
	'@@ -1,2 +1,2 @@',
	' keep',
	'-old',
	'+new',
	'diff --git a/gone.ts b/gone.ts',
	'deleted file mode 100644',
	'--- a/gone.ts',
	'+++ /dev/null',
	'@@ -1 +0,0 @@',
	'-bye',
	'diff --git a/old/name.ts b/new/name.ts',
	'similarity index 90%',
	'rename from old/name.ts',
	'rename to new/name.ts',
	'--- a/old/name.ts',
	'+++ b/new/name.ts',
	'@@ -3 +3 @@',
	'-x',
	'+y',
	'diff --git a/moved.ts b/elsewhere.ts',
	'similarity index 100%',
	'rename from moved.ts',
	'rename to elsewhere.ts',
	'diff --git a/logo.png b/logo.png',
	'new file mode 100644',
	'Binary files /dev/null and b/logo.png differ',
	'diff --git "a/with space.ts" "b/with space.ts"',
	'new file mode 100644',
	'--- /dev/null',
	'+++ "b/with space.ts"',
	'@@ -0,0 +1 @@',
	'+hello',
	''
].join('\n');

describe('filesInDiff', () => {
	const files = filesInDiff(diff);
	const named = (name: string) => files.find((f) => f.filename === name);

	it('lists every file, by where it is now', () => {
		expect(files.map((f) => f.filename)).toEqual(['src/a.ts', 'gone.ts', 'new/name.ts', 'elsewhere.ts', 'logo.png', 'with space.ts']);
	});

	it('gives each its patch from the first hunk, and counts its lines', () => {
		expect(named('src/a.ts')).toEqual({ filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 1, patch: '@@ -1,2 +1,2 @@\n keep\n-old\n+new' });
	});

	it('says how each changed', () => {
		expect(named('gone.ts')?.status).toBe('removed');
		expect(named('new/name.ts')).toMatchObject({ status: 'renamed', previous_filename: 'old/name.ts' });
		expect(named('logo.png')).toMatchObject({ status: 'added', additions: 0 });
		expect(named('with space.ts')?.status).toBe('added');
	});

	it('gives no patch where there are no lines to show', () => {
		expect(named('elsewhere.ts')?.patch).toBeUndefined();
		expect(named('logo.png')?.patch).toBeUndefined();
	});
});
