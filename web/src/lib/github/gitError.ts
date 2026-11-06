// What went wrong in a git command that failed, short enough to hand a
// model: that it timed out, or git's own complaints without its advice.
export function gitFailure(err: unknown, doing: string, timeoutMs: number): string {
	const e = err as { killed?: boolean; code?: number | string | null; message?: string };
	if (e.killed) return `Git timed out after ${Math.round(timeoutMs / 1000)}s ${doing}.`;
	// The message is "Command failed: <command>" with git's stderr below it.
	const lines = (e.message ?? '')
		.split('\n')
		.slice(1)
		.map((l) => l.trim())
		.filter(Boolean);
	const complaints = [...new Set(lines.filter((l) => /^(fatal|error):/.test(l)).map((l) => l.replace(/^(fatal|error):\s*/, '')))];
	let detail = complaints.length ? complaints.join('; ') : (lines.at(-1) ?? `exit code ${e.code ?? 'unknown'}`);
	if (detail.length > 300) detail = `${detail.slice(0, 300)}…`;
	return `Git failed ${doing}: ${detail}`;
}
