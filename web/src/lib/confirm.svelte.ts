// Asking before something that can't be undone, in the app's own dialog
// rather than the browser's. `ask` resolves true once confirmed.

interface Question {
	title: string;
	body?: string;
	// The confirming button's label, e.g. "Delete".
	action: string;
	resolve: (confirmed: boolean) => void;
}

export const question = $state<{ current: Question | null }>({ current: null });

export function ask(options: Omit<Question, 'resolve'>): Promise<boolean> {
	question.current?.resolve(false);
	return new Promise((resolve) => {
		question.current = { ...options, resolve };
	});
}

export function answer(confirmed: boolean) {
	question.current?.resolve(confirmed);
	question.current = null;
}
