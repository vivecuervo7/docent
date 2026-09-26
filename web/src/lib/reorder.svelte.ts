// Reordering a list by dragging a row's grip, or with Alt+↑/↓ on it. The
// row is only draggable while its grip is held, so text in it can still be
// selected. `move` gets the ids in their new order.
export class Reorder {
	dragging = $state<string | null>(null);
	over = $state<string | null>(null);
	armed = $state<string | null>(null);
	#ids: () => string[];
	#move: (ids: string[]) => void;

	constructor(ids: () => string[], move: (ids: string[]) => void) {
		this.#ids = ids;
		this.#move = move;
	}

	arm(id: string) {
		this.armed = id;
		const disarm = () => {
			if (!this.dragging) this.armed = null;
			window.removeEventListener('pointerup', disarm);
		};
		window.addEventListener('pointerup', disarm);
	}

	start(e: DragEvent, id: string) {
		if (this.armed !== id) return e.preventDefault();
		this.dragging = id;
		e.dataTransfer?.setData('text/plain', id);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
	}

	hover(e: DragEvent, id: string) {
		if (!this.dragging) return;
		e.preventDefault();
		this.over = id;
	}

	drop(e: DragEvent, id: string) {
		e.preventDefault();
		const from = this.dragging;
		this.end();
		if (from && from !== id) this.#place(from, this.#ids().indexOf(id));
	}

	end() {
		this.dragging = this.over = this.armed = null;
	}

	key(e: KeyboardEvent, id: string) {
		if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
		e.preventDefault();
		const at = this.#ids().indexOf(id);
		const grip = e.currentTarget as HTMLElement;
		this.#place(id, at + (e.key === 'ArrowUp' ? -1 : 1));
		// Moving the row drops focus; the grip keeps it for the next move.
		requestAnimationFrame(() => grip.focus());
	}

	#place(id: string, index: number) {
		const ids = this.#ids().filter((x) => x !== id);
		if (index < 0 || index > ids.length) return;
		ids.splice(index, 0, id);
		this.#move(ids);
	}
}
