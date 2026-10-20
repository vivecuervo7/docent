// Viewing preferences, kept in this browser.
export function readPref(key: string, fallback: boolean): boolean {
	try {
		const value = localStorage.getItem(key);
		return value === null ? fallback : value === 'true';
	} catch {
		return fallback;
	}
}

export function writePref(key: string, value: boolean) {
	try {
		localStorage.setItem(key, String(value));
	} catch {
		// Not kept, which only means the default next time.
	}
}

// A preference that's one of a few choices.
export function readChoice<T extends string>(key: string, fallback: T, choices: readonly T[]): T {
	try {
		const value = localStorage.getItem(key);
		return choices.includes(value as T) ? (value as T) : fallback;
	} catch {
		return fallback;
	}
}

export function writeChoice(key: string, value: string) {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Not kept, which only means the default next time.
	}
}
