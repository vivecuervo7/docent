import { persistent } from './persistent.server.js';

// A slow check's last answer - what's installed, which models there are -
// given straight away while it's run again behind it, so a page shows what
// was last known rather than waiting. `fresh` waits for a new answer, for
// a page that's asked to look again.
export function lastKnown<T>(name: string, run: () => Promise<T>) {
	const slot = persistent(`last-known.${name}`, () => ({ value: undefined as T | undefined, pending: null as Promise<T> | null }));
	const fresh = (): Promise<T> =>
		(slot.pending ??= run()
			.then((value) => (slot.value = value))
			.finally(() => (slot.pending = null)));
	return {
		fresh,
		get(): Promise<T> {
			if (slot.value === undefined) return fresh();
			fresh().catch(() => {});
			return Promise.resolve(slot.value);
		}
	};
}
