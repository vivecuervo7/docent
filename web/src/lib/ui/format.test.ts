import { describe, expect, it } from 'vitest';
import { shortDate, timeAgo } from './format';

const NOW = new Date(2026, 9, 28, 12, 0).getTime();
const ago = (ms: number) => timeAgo(NOW - ms, NOW);

describe('timeAgo', () => {
	it('counts up from just now to days', () => {
		expect(ago(10_000)).toBe('just now');
		expect(ago(5 * 60_000)).toBe('5m ago');
		expect(ago(3 * 3_600_000)).toBe('3h ago');
		expect(ago(9 * 86_400_000)).toBe('9d ago');
	});

	it('gives a date past a month', () => {
		expect(ago(40 * 86_400_000)).toBe(shortDate(NOW - 40 * 86_400_000));
	});
});

describe('shortDate', () => {
	it('gives a year only when it isn\'t this one', () => {
		const thisYear = new Date(new Date().getFullYear(), 0, 5).getTime();
		expect(shortDate(thisYear)).not.toMatch(/\d{4}/);
		expect(shortDate(new Date(2020, 0, 5).getTime())).toMatch(/2020/);
	});
});
