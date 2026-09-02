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
 *
 * The window also belongs to a CHARACTER, because a gallery does. See `followCharacter`.
 */
import { toastStore } from './toast.svelte';
import { characterLibraryStore } from './characterLibrary.svelte';
import { forgetPopout, readPopoutMemory, rememberPopout } from '$lib/utils/popout-memory';

/** The window's accessible name for a character's gallery. One recipe, two callers: the
 *  grid that pops a picture out, and the reopen that has only an id to work from. */
export function galleryLabel(characterName?: string): string {
	const name = characterName?.trim();
	return name ? `${name} gallery` : 'Gallery image';
}

class ImagePopoutStore {
	/** Server-relative image paths, in the order the source surface shows them. */
	images = $state<string[]>([]);
	index = $state(0);
	/** What the set is, for the window's accessible name (e.g. a character's name). */
	label = $state('Image');
	open = $state(false);
	/** The library entry whose gallery this set came from, when it came from one. What makes
	 *  the window follow the reader between stories rather than outstay its character. */
	ownerId = $state<string | null>(null);

	/** The path on screen, which is what gets remembered. Null when there is no window. */
	private get currentPath(): string | null {
		return this.images[this.index] ?? null;
	}

	/**
	 * Show `images[index]` in the window, taking it over if one is already open.
	 *
	 * The set is COPIED, not referenced: the window outlives the surface that named it, so
	 * holding that surface's live array would mean rendering a set nothing is maintaining.
	 * The cost is that the window does not follow later edits to the gallery, which is why
	 * the image element has a missing-file state.
	 */
	show(images: string[], index: number, options: { label?: string; ownerId?: string } = {}): void {
		if (images.length === 0) return;
		const replacing = this.open;
		this.images = [...images];
		this.index = Math.min(Math.max(index, 0), images.length - 1);
		if (options.label) this.label = options.label;
		this.ownerId = options.ownerId ?? null;
		this.open = true;
		this.remember();
		// Only on a genuine takeover. Saying it on the first open would be explaining a
		// window that is already visibly right there.
		if (replacing) toastStore.info('Replaced the image in the pop-out window.');
	}

	/** Wraps, so the set has no dead end to press against at either edge. */
	step(delta: number): void {
		if (this.images.length < 2) return;
		this.index = (this.index + delta + this.images.length) % this.images.length;
		this.remember();
	}

	/**
	 * The reader closed the window. That is a decision about this character, so the picture
	 * is forgotten too and opening their chat again does NOT bring it back: the opposite of
	 * `suspend` below, which is the app closing the window on the reader's behalf.
	 */
	close(): void {
		if (this.ownerId) forgetPopout(this.ownerId);
		this.reset();
	}

	/**
	 * The chat moved to somebody else's story, so the window goes but the picture is kept:
	 * coming back to this character reopens it. Called only by `followCharacter`.
	 */
	private suspend(): void {
		this.reset();
	}

	private reset(): void {
		this.open = false;
		// Dropped rather than kept: a closed window has nothing to page through, and holding
		// the paths would keep a deleted image's name alive for no one to read.
		this.images = [];
		this.index = 0;
		this.ownerId = null;
	}

	/** Record what is on screen against its character, so a reload finds it again. */
	private remember(): void {
		const path = this.currentPath;
		if (this.ownerId && path) rememberPopout(this.ownerId, path);
	}

	/**
	 * Put the window where the newly opened chat's character says it should be: gone if it
	 * belonged to somebody else, back if this character had one open.
	 *
	 * Called ONLY when the active chat's character actually changes, never as a reactive
	 * invariant. The difference is load-bearing: the gallery is in the library, which is
	 * reachable while any chat is open, so popping out character B's picture while chat A is
	 * on screen is an ordinary thing to do and an invariant would shut it again instantly.
	 * A window whose character is not the one being read is only wrong once the reader
	 * *moves*, which is exactly this event.
	 *
	 * `null` (the welcome screen, a deleted chat) suspends without reopening anything.
	 */
	followCharacter(characterId: string | null): void {
		if (this.open && this.ownerId === characterId) return;
		if (this.open) this.suspend();
		if (characterId) this.reopenFor(characterId);
	}

	/**
	 * Reopen the picture this character was left on, read back out of their LIVE gallery
	 * rather than out of any stored set: a path that has since been deleted is then a miss
	 * to report rather than a broken image to render.
	 */
	private reopenFor(characterId: string): void {
		const path = readPopoutMemory()[characterId];
		if (!path) return;

		const entry = characterLibraryStore.entries.find((e) => e.id === characterId);
		const gallery = entry?.identity.gallery ?? [];
		const at = gallery.indexOf(path);
		if (at === -1) {
			// Said out loud rather than passed over in silence: the reader left a window open
			// and is owed a reason it is not there. Forgotten at the same time, so the notice
			// is once and not on every visit.
			forgetPopout(characterId);
			toastStore.info('The image left popped out is no longer in this gallery.');
			return;
		}

		this.show(gallery, at, { label: galleryLabel(entry?.identity.name), ownerId: characterId });
	}
}

export const imagePopoutStore = new ImagePopoutStore();
