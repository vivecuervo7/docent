export function timeAgo(at: number | undefined, now = Date.now()): string {
	if (!at) return '';
	const minutes = Math.round((now - at) / 60000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.round(hours / 24);
	return days < 30 ? `${days}d ago` : new Date(at).toLocaleDateString();
}

export function elapsed(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// A PR's address from a GitHub link: https://github.com/owner/repo/pull/123
export function parsePrUrl(input: string): { owner: string; repo: string; number: string } | null {
	const match = input.trim().match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
	return match ? { owner: match[1], repo: match[2], number: match[3] } : null;
}
