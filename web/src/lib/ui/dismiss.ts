// Closes something open on a press anywhere outside it - outside what
// `inside` matches, as a selector or a test - and on Escape unless that's
// left to something else. Gives back the clean-up, for an $effect to return.
export function onDismiss(close: () => void, inside: string | ((target: Element) => boolean), { escape = true } = {}): () => void {
	const within = typeof inside === 'string' ? (target: Element) => !!target.closest(inside) : inside;
	const press = (e: PointerEvent) => !within(e.target as Element) && close();
	const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
	window.addEventListener('pointerdown', press);
	if (escape) window.addEventListener('keydown', key);
	return () => {
		window.removeEventListener('pointerdown', press);
		window.removeEventListener('keydown', key);
	};
}
