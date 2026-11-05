export function timeAgo(at: number | undefined, now = Date.now()): string {
	if (!at) return '';
	const minutes = Math.round((now - at) / 60000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.round(hours / 24);
	return days < 30 ? `${days}d ago` : shortDate(at);
}

// A day as the rest of Docent writes it, "21 Oct", with its year when it
// isn't this one; and the time too, if asked.
export function shortDate(at: number | string, { time = false } = {}): string {
	const date = new Date(at);
	const year = date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' as const };
	return date.toLocaleString(undefined, { day: 'numeric', month: 'short', ...year, ...(time ? { hour: 'numeric', minute: '2-digit' } : {}) });
}

export function elapsed(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// A PR's address from a link on `host`: https://github.com/owner/repo/pull/123
export function parsePrUrl(input: string, host: string): { owner: string; repo: string; number: string } | null {
	const match = input.trim().match(/^(?:https?:\/\/)?([^/\s]+)\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
	return match && match[1].toLowerCase() === host.toLowerCase() ? { owner: match[2], repo: match[3], number: match[4] } : null;
}

// A count with its noun: "1 finding", "3 findings".
export function plural(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}
