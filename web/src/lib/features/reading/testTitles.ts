// The lines that name a test, read from the code itself, so a test file can
// fold to its scenarios without trusting a model to count lines. Covers the
// common frameworks; a file none of these match returns nothing, and the
// file note's lines are used instead.

// An attribute or annotation that marks the declaration after it as a test.
const MARKER = /^\s*(\[(Test|Fact|Theory|TestCase|TestMethod|DataTestMethod)\b[^\]]*\]|@(Test|ParameterizedTest|RepeatedTest)\b|#\[(tokio::)?test\])/;

// A line that is itself a test's title, or the group or fixture holding tests.
const TITLES = [
	// JavaScript and TypeScript: describe(...), it.only(...), test.each(...)(...)
	/^\s*(describe|context|suite|it|test)(\.(only|skip|each|concurrent|todo|failing)\b[^(]*)?\s*\(/,
	// Python
	/^\s*(async\s+)?def\s+test\w*\s*\(/,
	/^\s*class\s+Test\w*/,
	// Go
	/^func\s+Test\w*\s*\(/,
	// A C#, Java or Kotlin test class
	/^\s*(public\s+|internal\s+)?((sealed|abstract|static|partial|open)\s+)*class\s+\w*Tests?\b/,
	/\[TestFixture\b|\[TestClass\b|@(Nested|DisplayName)\b/
];

const blank = (text: string) => !text.trim() || MARKER.test(text) || /^\s*\[.*\]\s*$/.test(text) || /^\s*@\w+/.test(text);

// The new-file line numbers of test titles among a file's rows, in order.
export function testTitleLines(rows: { kind: string; new?: number; text: string }[]): Set<number> {
	const lines = rows.filter((r) => r.kind !== 'del' && r.new !== undefined);
	const out = new Set<number>();
	lines.forEach((r, i) => {
		if (TITLES.some((re) => re.test(r.text))) out.add(r.new!);
		// After a marker, the test is the next line that isn't another attribute.
		if (MARKER.test(r.text)) {
			const decl = lines.slice(i + 1).find((next) => !blank(next.text));
			if (decl) out.add(decl.new!);
		}
	});
	return out;
}
