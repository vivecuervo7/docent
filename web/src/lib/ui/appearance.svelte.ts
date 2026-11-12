// How Docent looks, kept in this browser: how far toward high contrast, from
// 0 (as designed) to 1. app.html applies it before the first paint; this
// keeps the page in step once it's running.
const KEY = 'docent.contrast';

function read(): number {
	try {
		const n = Number(localStorage.getItem(KEY));
		return Number.isFinite(n) && n > 0 ? Math.min(1, n) : 0;
	} catch {
		return 0;
	}
}

let contrast = $state(read());

export const appearance = {
	get contrast() {
		return contrast;
	}
};

export function chooseContrast(value: number) {
	contrast = Math.max(0, Math.min(1, value));
	try {
		localStorage.setItem(KEY, String(contrast));
	} catch {
		// Not kept, which only means as designed next time.
	}
	if (contrast) document.documentElement.style.setProperty('--contrast', String(contrast));
	else document.documentElement.style.removeProperty('--contrast');
}
