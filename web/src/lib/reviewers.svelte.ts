import type { AgentReviewer } from './types';

// What reviewers are called: after their persona - "general" when it has
// none - or external reviewer, so the name says what they look for
// ("security", or "security-1" and "security-2" when there are two). Only
// your own agent over MCP goes by the random name each was given
// ("bronze-viper"), which also stays what an agent names a reviewer by.

// Personas and external reviewers, as the panel loads them.
export const known = $state<{ personas: { id: string; name: string }[]; externals: { id: string; name: string }[] }>({
	personas: [],
	externals: []
});

// Sessions were saved as "persona:<id>" before personas meant Docent's own
// reviewer; the ids carried over.
export const sessionId = (value: string | undefined) =>
	value?.startsWith('session:') ? value.slice('session:'.length) : value?.startsWith('persona:') ? value.slice('persona:'.length) : null;

const slug = (name: string) =>
	name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

// What a reviewer runs as, when that names it: its external reviewer, or
// its persona on Docent's reviewer.
function kindOf(r: AgentReviewer): string | null {
	const runs = r.planned ?? r.ranWith;
	const session = sessionId(runs);
	if (session) {
		const external = known.externals.find((e) => e.id === session);
		return external ? slug(external.name) || null : null;
	}
	if (runs === 'external') return null;
	if (r.persona === 'auto') return 'auto';
	const persona = r.persona ? known.personas.find((p) => p.id === r.persona) : undefined;
	return (persona && slug(persona.name)) || 'general';
}

export function reviewerLabel(reviewers: AgentReviewer[], id: string): string {
	const r = reviewers.find((a) => a.id === id);
	if (!r) return id;
	const kind = kindOf(r);
	if (!kind) return r.name ?? r.id;
	const same = reviewers.filter((a) => kindOf(a) === kind);
	return same.length > 1 ? `${kind}-${same.indexOf(r) + 1}` : kind;
}

// Whether a reviewer's name already says its persona or external reviewer.
export const namedByKind = (r: AgentReviewer) => kindOf(r) !== null;
