import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The palette worked out as the browser would at each step toward high
// contrast: text gains contrast and stays readable, and what's raised above
// the ground never gets closer to it than as designed.

const css = readFileSync(new URL('../../app.css', import.meta.url), 'utf8').replace(/\s+/g, ' ');

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => {
	const h = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join('') : hex.slice(1);
	return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
};
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklab([r, g, b]: Rgb): Rgb {
	[r, g, b] = [r, g, b].map(linear);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	];
}
function fromOklab([L, a, b]: Rgb): Rgb {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
	].map((c) => Math.min(1, Math.max(0, gamma(c)))) as Rgb;
}
const mix = (a: Rgb, b: Rgb, t: number): Rgb => {
	const [x, y] = [toOklab(a), toOklab(b)];
	return fromOklab(x.map((v, i) => v + (y[i] - v) * t) as Rgb);
};

// A colour as the page shows it `toward` of the way to high contrast.
function colour(name: string, toward: number): Rgb {
	const value = css.match(new RegExp(`--${name}: ([^;]+);`))?.[1];
	if (!value) throw new Error(`--${name} isn't in app.css`);
	const moving = value.match(/^color-mix\(in oklab, (#\w+|var\(--[\w-]+\)), (#\w+) var\(--toward\)\)$/);
	if (moving) return mix(start(moving[1]), rgb(moving[2]), toward);
	if (/^#\w+$/.test(value)) return rgb(value);
	throw new Error(`--${name} is neither a colour nor a move toward high contrast: ${value}`);
}
const start = (v: string) => (v.startsWith('var(') ? colour(v.slice(6, -1), 0) : rgb(v));

const luminance = (c: Rgb) => {
	const [r, g, b] = c.map(linear);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: Rgb, b: Rgb) => {
	const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
	return (x + 0.05) / (y + 0.05);
};

const STEPS = [0, 0.25, 0.5, 0.75, 1];
// Text tiers on the ground, and the least each needs (WCAG's 4.5 for text, 3
// for the faint hints).
const TEXT: [string, number][] = [
	['text', 4.5],
	['muted', 4.5],
	['faint', 3]
];
// What's raised above the ground: highlights, cards, menus, popovers, code.
const RAISED = [
	'surface',
	'surface-2',
	'code-bg',
	'hunk-bg',
	'agent-card',
	'agent-pill',
	'agent-menu',
	'agent-quote',
	'agent-hover',
	'agent-menu-active',
	'popover',
	'popover-raised'
];
// Outlines on what they edge: the agents', and what floats over the page.
const OUTLINES: [string, string][] = [
	['float-line', 'surface'],
	['float-line', 'surface-2'],
	['agent-card-line', 'agent-card'],
	['popover-line', 'popover'],
	['agent-menu-line', 'agent-menu']
];

describe('the palette toward high contrast', () => {
	it('is the palette as designed at 0', () => {
		expect(colour('bg', 0).map((c) => Math.round(c * 255))).toEqual([0x12, 0x13, 0x15]);
		expect(colour('text', 0).map((c) => Math.round(c * 255))).toEqual([0xe8, 0xe6, 0xe1]);
	});

	for (const [name, least] of TEXT) {
		it(`gives ${name} more contrast at every step, and enough`, () => {
			const at = STEPS.map((t) => ratio(colour(name, t), colour('bg', t)));
			for (let i = 1; i < at.length; i++) expect(at[i], `${name} at ${STEPS[i]}`).toBeGreaterThan(at[i - 1]);
			expect(Math.min(...at)).toBeGreaterThanOrEqual(least);
		});
	}

	for (const name of RAISED) {
		it(`keeps ${name} at least as far from the ground as designed`, () => {
			const designed = ratio(colour(name, 0), colour('bg', 0));
			for (const t of STEPS) expect(ratio(colour(name, t), colour('bg', t)), `at ${t}`).toBeGreaterThanOrEqual(designed - 1e-9);
		});
	}

	for (const [line, on] of OUTLINES) {
		it(`firms up ${line} on ${on} as contrast rises`, () => {
			const at = STEPS.map((t) => ratio(colour(line, t), colour(on, t)));
			for (let i = 1; i < at.length; i++) expect(at[i], `at ${STEPS[i]}`).toBeGreaterThanOrEqual(at[i - 1]);
		});
	}
});
