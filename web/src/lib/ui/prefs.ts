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
