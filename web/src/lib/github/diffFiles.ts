import type { PrFile } from './github.server.js';

// A diff of many files - the PR's whole diff from GitHub, or one from git -
// as GitHub lists a PR's files: each with its patch from its first hunk on,
// or none for a binary file, and how it changed.

export function filesInDiff(diff: string): PrFile[] {
	return diff.split(/^(?=diff --git )/m).flatMap((section): PrFile[] => {
		const lines = section.replace(/\n$/, '').split('\n');
		const first = lines.findIndex((l) => l.startsWith('@@'));
		const header = first < 0 ? lines : lines.slice(0, first);
		const moved = valueOf(header, 'rename from ');
		// A moved file is named by where it went; a deleted one only on its old side.
		const filename = valueOf(header, 'rename to ') ?? pathIn(header, '+++ b/') ?? pathIn(header, '--- a/') ?? binaryPath(header);
		if (!filename) return [];
		const patch = first < 0 ? undefined : lines.slice(first).join('\n');
		const rows = patch?.split('\n') ?? [];
		return [
			{
				filename,
				status: header.some((l) => l.startsWith('new file mode'))
					? 'added'
					: header.some((l) => l.startsWith('deleted file mode'))
						? 'removed'
						: moved
							? 'renamed'
							: 'modified',
				additions: rows.filter((l) => l.startsWith('+')).length,
				deletions: rows.filter((l) => l.startsWith('-')).length,
				...(patch ? { patch } : {}),
				...(moved ? { previous_filename: moved } : {})
			}
		];
	});
}

// Git quotes a path with unusual characters, and ends one with spaces in a tab.
const unquote = (path: string) => (path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path);

function valueOf(header: string[], prefix: string): string | undefined {
	const line = header.find((l) => l.startsWith(prefix));
	return line ? unquote(line.slice(prefix.length)) : undefined;
}

// The path on a "+++ b/..." or "--- a/..." line.
function pathIn(header: string[], marker: '+++ b/' | '--- a/'): string | undefined {
	const [sign, side] = marker.split(' ');
	const line = header.find((l) => l.startsWith(marker) || l.startsWith(`${sign} "${side}`));
	const path = line?.slice(sign.length + 1).replace(/\t$/, '');
	return path?.startsWith('"') ? path.slice(side.length + 1, -1) : path?.slice(side.length);
}

function binaryPath(header: string[]): string | undefined {
	const match = header.find((l) => l.startsWith('Binary files '))?.match(/^Binary files (?:a\/(.+?)|\/dev\/null) and (?:b\/(.+?)|\/dev\/null) differ$/);
	return match?.[2] ?? match?.[1];
}
