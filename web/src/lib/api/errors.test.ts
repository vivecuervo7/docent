import { error } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { messageOf } from './errors.js';

describe('messageOf', () => {
	it("reads a remote function's error from its body", () => {
		let thrown: unknown;
		try {
			error(409, 'An analysis is running; wait for it to finish.');
		} catch (err) {
			thrown = err;
		}
		expect(messageOf(thrown)).toBe('An analysis is running; wait for it to finish.');
	});

	it("reads any other error's message, or what was thrown", () => {
		expect(messageOf(new Error('Network down'))).toBe('Network down');
		expect(messageOf('odd')).toBe('odd');
	});
});
