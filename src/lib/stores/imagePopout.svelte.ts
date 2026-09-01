/**
 * The one popped-out image window.
 *
 * It lives in a store rather than beside the grid that opened it because the surface that
 * opens it goes away: the gallery is inside the library entry editor, so a window parented
 * to it would die the moment the editor closed, which is the entire thing a pop-out exists
 * to avoid. The window is mounted once at the shell's top level and reads from here.
 *
 * There is exactly ONE window, deliberately. A second would need a z-order between the two,
 * a placement key each and a rule for which one the arrows belong to, and none of that is
 * worth it for a picture you are keeping on screen while you work. Opening another image
 * takes over the window, and says so, so the reader is never left wondering which of two
 * clicks the window is showing.
 */
import { toastStore } from './toast.svelte';

class ImagePopoutStore {
	/** Server-relative image paths, in the order the source surface shows them. */
	images = $state<string[]>([]);
	index = $state(0);
	/** What the set is, for the window's accessible name (e.g. a character's name). */
	label = $state('Image');
	open = $state(false);

	/**
	 * Show `images[index]` in the window, taking it over if one is already open.
	 *
	 * The set is COPIED, not referenced: the window outlives the surface that named it, so
	 * holding that surface's live array would mean rendering a set nothing is maintaining.
	 * The cost is that the window does not follow later edits to the gallery, which is why
	 * the image element has a missing-file state.
	 */
	show(images: string[], index: number, label?: string): void {
		if (images.length === 0) return;
		const replacing = this.open;
		this.images = [...images];
		this.index = Math.min(Math.max(index, 0), images.length - 1);
		if (label) this.label = label;
		this.open = true;
		// Only on a genuine takeover. Saying it on the first open would be explaining a
		// window that is already visibly right there.
		if (replacing) toastStore.info('Replaced the image in the pop-out window.');
	}

	/** Wraps, so the set has no dead end to press against at either edge. */
	step(delta: number): void {
		if (this.images.length < 2) return;
		this.index = (this.index + delta + this.images.length) % this.images.length;
	}

	close(): void {
		this.open = false;
		// Dropped rather than kept: a closed window has nothing to page through, and holding
		// the paths would keep a deleted image's name alive for no one to read.
		this.images = [];
		this.index = 0;
	}
}

export const imagePopoutStore = new ImagePopoutStore();
