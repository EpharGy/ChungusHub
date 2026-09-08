/**
 * The one gallery window: a picture from somebody's gallery, kept on screen while you work.
 *
 * It lives in a store rather than beside anything that opens it because it outlives every
 * such surface. The window is mounted once at the shell's top level and reads from here.
 *
 * There is exactly ONE window, deliberately. A second would need a z-order between the two, a
 * placement key each and a rule for which one the arrows belong to, and none of that is worth
 * it for a picture you are keeping on screen while you work. Choosing another image takes the
 * window over.
 *
 * The window is a fixture of the CHAT being read, not of the picture. See `followChat`.
 *
 * ## The window being up and a picture being loaded are two different facts
 *
 * They used to be one boolean, because there was one way in (pop a picture out of the
 * library's viewer) and one way out (close, which forgot it). Browsing from inside the window
 * makes that shape wrong: the reader can want the frame with nothing in it, and can want the
 * picture kept while the frame is away. So:
 *
 * - **`open`** is whether the window is standing. `minimize` and `restore` move it, and the
 *   title bar entry toggles it, exactly like the notepad's.
 * - **`images` / `sourceId`** are what is loaded. `show` fills them, `unload` empties them,
 *   and neither touches whether the window is up.
 *
 * Both are remembered per chat, in one record (`popout-memory.ts`). Nothing here destroys a
 * picture as a side effect of putting the window away, which is the whole complaint that
 * started this: closing used to mean walking back through the library to find the image again.
 */
import { toastStore } from './toast.svelte';
import { registerFloatingPanel } from './floating-panels.svelte';
import { chatStore } from './chat.svelte';
import { characterLibraryStore } from './characterLibrary.svelte';
import {
	forgetPopout,
	prunePopoutMemory,
	readPopoutMemory,
	rememberPopout
} from '$lib/utils/popout-memory';

class ImagePopoutStore {
	/** Server-relative image paths: one card's whole gallery, in its own order. */
	images = $state<string[]>([]);
	index = $state(0);
	/** Whether the window is standing. Independent of whether anything is loaded. */
	open = $state(false);

	/**
	 * The chat that was on screen when this window was made: the story it belongs to, and the
	 * only thing that decides when it goes away and comes back.
	 *
	 * Deliberately NOT the picture's owner, and deliberately not that chat's CHARACTER either.
	 * A reader who opens character A's art while reading a story about B wants that picture for
	 * as long as they are reading that story, and wants it gone the moment they leave it,
	 * including when they leave for another of B's own chats, because a character with six
	 * stories running is six separate rooms and a reference pinned up in one of them is not a
	 * fact about all six. The window is furniture of the story; the picture in it is only what
	 * got put on the shelf.
	 */
	boundChatId = $state<string | null>(null);

	/** The library entry whose gallery this set came from, which may be anybody, a persona
	 *  included. Kept because it is the only way to rebuild the set on the way back in. */
	sourceId = $state<string | null>(null);

	/** That entry's name, for the window's title. Held rather than looked up so the title
	 *  survives the card being renamed out from under a window already on screen. */
	sourceName = $state<string | null>(null);

	/** Whether a picture is loaded, as opposed to the window merely being up. */
	hasImage = $derived(this.images.length > 0);

	/** Whether there is a story for a window to belong to. False on the welcome screen, which
	 *  is what disables the title bar entry there: a picture pinned to no chat is pinned to
	 *  nothing, and the next story to open would take it away with nothing to bring it back. */
	canScope = $derived(chatStore.currentChatState?.chat != null);

	/** The path on screen, which is what gets remembered. Null when nothing is loaded. */
	private get currentPath(): string | null {
		return this.images[this.index] ?? null;
	}

	/**
	 * Load a card's gallery, showing `index`, and stand the window up.
	 *
	 * The set is COPIED, not referenced: the window outlives the surface that named it, so
	 * holding a live array would mean rendering a set nothing is maintaining. The cost is that
	 * the window does not follow later edits to the gallery, which is why the image element has
	 * a missing-file state.
	 *
	 * No notice on a takeover any more. There used to be one, because a pop-out arrived from a
	 * viewer somewhere else in the app and replacing one silently was a surprise. Picking from
	 * the window's own browser is not a surprise: the reader is looking at the window while it
	 * happens.
	 */
	show(images: string[], index: number, options: { sourceId?: string; name?: string } = {}): void {
		if (images.length === 0) return;
		this.images = [...images];
		this.index = Math.min(Math.max(index, 0), images.length - 1);
		this.sourceId = options.sourceId ?? null;
		this.sourceName = options.name?.trim() || null;
		this.boundChatId = chatStore.currentChatState?.chat.id ?? null;
		this.open = true;
		this.remember();
	}

	/** Wraps, so the set has no dead end to press against at either edge. */
	step(delta: number): void {
		if (this.images.length < 2) return;
		this.index = (this.index + delta + this.images.length) % this.images.length;
		this.remember();
	}

	/**
	 * Put the window away, keeping the picture.
	 *
	 * What the header's minimise button and the title bar entry both do. The picture is not
	 * touched, in memory or in the record, so restoring shows exactly what was there. This is
	 * the notepad's rule rather than the old pop-out's: the one destructive door is `unload`,
	 * and it is a separate button that says so.
	 */
	minimize(): void {
		if (!this.open) return;
		this.open = false;
		this.remember();
	}

	/** Stand the window back up. Whatever was loaded is still loaded. */
	restore(): void {
		if (this.open) return;
		this.open = true;
		this.remember();
	}

	toggle(): void {
		if (this.open) this.minimize();
		else this.restore();
	}

	/**
	 * Empty the window, leaving the frame standing.
	 *
	 * The other half of the split: this is the one that forgets the picture, so returning to
	 * this story does not bring it back. The window stays up, showing nothing, because the
	 * reader who pressed it is looking at the window and is most likely about to pick another.
	 */
	unload(): void {
		this.clearLoaded();
		this.remember();
	}

	private clearLoaded(): void {
		// Dropped rather than kept: an empty window has nothing to page through, and holding
		// the paths would keep a deleted image's name alive for no one to read.
		this.images = [];
		this.index = 0;
		this.sourceId = null;
		this.sourceName = null;
	}

	/**
	 * Write the current state against the story it belongs to.
	 *
	 * Total over the three shapes a record can take, which is why every mutator above can end
	 * with a bare call to it: a picture (with the window up or down), a standing window with
	 * nothing in it, and neither, which is not a record at all and is removed rather than
	 * stored as a row that can never affect anything.
	 */
	private remember(): void {
		const chatId = this.boundChatId;
		if (!chatId) return;
		const path = this.currentPath;
		if (path && this.sourceId) {
			rememberPopout(chatId, { path, sourceId: this.sourceId, open: this.open });
		} else if (this.open) {
			rememberPopout(chatId, { open: true });
		} else {
			forgetPopout(chatId);
		}
	}

	/**
	 * Put the window where the newly opened chat says it should be.
	 *
	 * Called ONLY when the loaded chat actually changes, never as a reactive invariant. The
	 * difference is load-bearing: an invariant would shut the window in the frame it opened.
	 * A window is only wrong once the reader *moves*, which is exactly this event.
	 *
	 * `null` (the welcome screen, a deleted chat) clears without restoring anything.
	 */
	followChat(chatId: string | null): void {
		if (this.boundChatId === chatId) return;
		// Nothing is written on the way out: every mutator already recorded the old chat's
		// state as it happened, so there is nothing here the record does not have.
		this.clearLoaded();
		this.open = false;
		this.boundChatId = chatId;
		if (chatId) this.restoreFor(chatId);
	}

	/**
	 * Restore what this story was left with, reading the picture back out of its SOURCE
	 * entry's live gallery rather than out of any stored set: a path deleted since is then a
	 * miss to report rather than a broken image to render.
	 *
	 * The set is loaded even when the record says the window is down, which costs an array of
	 * strings and no image request, and makes restoring from the title bar instant instead of
	 * a second round through this.
	 */
	private restoreFor(chatId: string): void {
		const remembered = readPopoutMemory()[chatId];
		if (!remembered) return;

		this.open = remembered.open;
		if (!remembered.path || !remembered.sourceId) return;

		const source = characterLibraryStore.entries.find((e) => e.id === remembered.sourceId);
		const gallery = source?.identity.gallery ?? [];
		const at = gallery.indexOf(remembered.path);
		if (at === -1) {
			// Said out loud rather than passed over in silence: the reader left a picture here
			// and is owed a reason it is not back. The window itself is left exactly as the
			// record described it, so an empty frame stands where a full one would have.
			this.remember();
			toastStore.info('The image left in the gallery window here is no longer in its gallery.');
			return;
		}

		this.images = [...gallery];
		this.index = at;
		this.sourceId = remembered.sourceId;
		this.sourceName = source?.identity.name?.trim() || null;
	}

	/**
	 * The library entry this window's set came from has been deleted, taking its image files
	 * with it. Empty the window and say so.
	 *
	 * This is the one thing a chat-keyed binding cannot notice on its own: deleting a character
	 * happens *inside* the story you are reading, so the chat never changes and the edge above
	 * never fires. Without this the window sits there showing files the delete already swept.
	 *
	 * Unloads rather than putting the window away, because what has gone is the picture and not
	 * the frame. Records for OTHER chats that sourced the same entry are deliberately left
	 * alone: each of those chats can still be walked back into, and `restoreFor` gives its
	 * reader the same notice at the moment it is worth hearing.
	 */
	forgetEntry(entryId: string): void {
		if (this.sourceId !== entryId) return;
		this.unload();
		toastStore.info('The image in the gallery window was deleted with its gallery.');
	}

	/**
	 * Drop remembered windows for stories that no longer exist.
	 *
	 * The record is capped, so it can never grow without bound; this is what stops it going
	 * STALE, which the cap alone does not: twenty pictures pinned to twenty deleted chats is
	 * within the cap and is still twenty rows of nothing. Driven from the window's own effect
	 * off the live chat list, so a delete anywhere (one row, a batch, another device) is swept
	 * without every delete path having to know this feature exists.
	 */
	pruneTo(liveChatIds: ReadonlySet<string>): void {
		prunePopoutMemory(liveChatIds);
	}
}

export const imagePopoutStore = new ImagePopoutStore();

/**
 * The gallery window's entry in the title bar.
 *
 * An ordinary toggle now, and the same shape as the notepad's. It used to be the one entry
 * that could not open its own panel, because a pop-out could only be made by finding a picture
 * in the library's viewer and there was nothing for a cold press to do. The window browses for
 * its own images, so there is.
 *
 * `disabled` rather than `available` off-chat, for the notepad's reason: hiding it would shift
 * the whole centred cluster sideways the moment a chat opened.
 */
registerFloatingPanel({
	id: 'image-popout',
	order: 20,
	label: 'Gallery',
	icon: 'image',
	isOpen: () => imagePopoutStore.open,
	toggle: () => imagePopoutStore.toggle(),
	disabled: () => !imagePopoutStore.canScope,
	// A picture is loaded and the window is down: otherwise indistinguishable from an empty
	// one, and the reader put it there on purpose.
	badge: () => imagePopoutStore.hasImage,
	tooltip: () => {
		if (!imagePopoutStore.canScope) return 'Gallery · open a chat to pin an image';
		if (imagePopoutStore.open) return 'Hide the gallery window (the image is kept)';
		const name = imagePopoutStore.sourceName;
		if (imagePopoutStore.hasImage) return name ? `Gallery · ${name}` : 'Gallery · an image is pinned';
		return 'Gallery';
	}
});
