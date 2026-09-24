import { bundledLanguages, createHighlighter, type BundledLanguage, type Highlighter } from 'shiki';
import type { Hunk, Range, Row } from './parse';

// Syntax colours from Shiki. Each hunk is highlighted as two blocks of code,
// its old side and its new side, so a line keeps the context of the lines
// around it (a comment or string spanning lines colours correctly).

export interface Token {
	content: string;
	color?: string;
}

const THEME = 'github-dark-default';

const BY_EXTENSION: Record<string, string> = {
	ts: 'typescript',
	mts: 'typescript',
	cts: 'typescript',
	tsx: 'tsx',
	js: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	jsx: 'jsx',
	json: 'json',
	md: 'markdown',
	css: 'css',
	svelte: 'svelte',
	yml: 'yaml',
	yaml: 'yaml',
	bicep: 'bicep',
	bicepparam: 'bicep',
	sh: 'bash',
	cs: 'csharp',
	html: 'html',
	py: 'python',
	sql: 'sql'
};

export function languageFor(path: string): BundledLanguage | null {
	const ext = path.split('.').pop()?.toLowerCase() ?? '';
	const lang = BY_EXTENSION[ext];
	return lang && lang in bundledLanguages ? (lang as BundledLanguage) : null;
}

let highlighter: Promise<Highlighter> | null = null;

async function load(lang: BundledLanguage): Promise<Highlighter> {
	highlighter ??= createHighlighter({ themes: [THEME], langs: [] });
	const h = await highlighter;
	if (!h.getLoadedLanguages().includes(lang)) await h.loadLanguage(lang);
	return h;
}

// Shiki's colours pulled most of the way toward the plain code colour, so
// the syntax stays legible without every keyword competing with the changes
// and findings.
const BASE = [0xc9, 0xc6, 0xbf];
const KEEP = 0.45;
const muted = new Map<string, string>();

function mute(color: string | undefined): string | undefined {
	if (!color || !/^#[0-9a-f]{6}/i.test(color)) return color;
	let out = muted.get(color);
	if (!out) {
		const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
		out = `#${rgb.map((c, i) => Math.round(c * KEEP + BASE[i] * (1 - KEEP)).toString(16).padStart(2, '0')).join('')}`;
		muted.set(color, out);
	}
	return out;
}

export async function highlightHunks(hunks: Hunk[], path: string): Promise<Map<string, Token[]>> {
	const lang = languageFor(path);
	const tokens = new Map<string, Token[]>();
	if (!lang) return tokens;
	const h = await load(lang);
	const side = (rows: Row[]) => {
		const lines = h.codeToTokens(rows.map((r) => r.text).join('\n'), { lang, theme: THEME }).tokens;
		rows.forEach((row, i) => tokens.set(row.key, (lines[i] ?? []).map((t) => ({ content: t.content, color: mute(t.color) }))));
	};
	for (const hunk of hunks) {
		// Context lines take their colours from the new side.
		side(hunk.rows.filter((r) => r.kind === 'del' || r.kind === 'context'));
		side(hunk.rows.filter((r) => r.kind === 'add' || r.kind === 'context'));
	}
	return tokens;
}

export interface Segment {
	text: string;
	color?: string;
	edit: boolean;
}

// A line's syntax tokens, split wherever a word edit starts or ends.
export function segments(text: string, tokens: Token[] | undefined, edits: Range[] | undefined): Segment[] {
	const base = tokens?.length ? tokens : [{ content: text }];
	if (!edits?.length) return base.map((t) => ({ text: t.content, color: t.color, edit: false }));
	const inEdit = (at: number) => edits.some(([s, e]) => at >= s && at < e);
	const cuts = new Set(edits.flat());
	const out: Segment[] = [];
	let at = 0;
	for (const token of base) {
		let start = 0;
		for (let i = 1; i <= token.content.length; i++) {
			if (i === token.content.length || cuts.has(at + i)) {
				const piece = token.content.slice(start, i);
				if (piece) out.push({ text: piece, color: token.color, edit: inEdit(at + start) });
				start = i;
			}
		}
		at += token.content.length;
	}
	return out;
}
