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
 * ## The two facts have two different homes, and that is the fix this file exists after
 *
 * - **The pinned picture is the chat's**, on its own row (`feature_state.galleryPin`). A
 *   reference the reader pinned to a story is a fact about that story: it has to survive a
 *   cleared browser and be there on the phone, exactly like the notepad's notes.
 * - **The standing window is the device's**, in localStorage: its rectangle (via
 *   `FloatingWindow`) and whether it is up (`popout-memory.ts`). Neither means anything on
 *   another screen, and a window left standing on a desktop would take a phone's whole
 *   screen the moment that story opened.
 *
 * Both used to be in the localStorage record, on the reasoning that a window's state is
 * per-device. That is true of the frame and false of the picture, and the result was a pin
 * made on the desktop being invisible from the phone and the other way round, silently:
 * a device with no record restores nothing and has nothing to report. The notepad had made
 * this split correctly one branch over, citing this feature as its model for the half it
 * kept local.
 *
 * Writes to the row are debounced, because a chat row write broadcasts the `chats` scope and
 * every other device answers it with a chat-list refetch. Paging through a gallery is a
 * burst of clicks, and a refetch per arrow press is the shape that would make.
 */
import { toastStore } from './toast.svelte';
import { registerFloatingPanel } from './floating-panels.svelte';
import { chatStore } from './chat.svelte';
import { characterLibraryStore } from './characterLibrary.svelte';
import { normalizeChatFeatureState, type GalleryPin } from '$lib/types/chat';
import {
	forgetPopoutOpen,
	isPopoutOpenFor,
	prunePopoutMemory,
	rememberPopoutOpen
} from '$lib/utils/popout-memory';

/**
 * How long a pause in paging is before the pin goes to the server.
 *
 * The scene store's figure rather than the notepad's, and for its reason: paging is a burst
 * that ENDS, like a slider drag, so a short debounce costs one write per burst. Typing is a
 * burst that keeps restarting, which is why the notepad waits more than twice as long.
 */
const PERSIST_MS = 250;

class ImagePopoutStore {
	/** Server-relative image paths: one card's whole gallery, in its own order. */
	images = $state<string[]>([]);
	index = $state(0);
	/** Whether the window is standing. Independent of whether anything is loaded. */
	open = $state(false);

	/** Written but not yet persisted, with the chat it belongs to. Null pin means "no pin",
	 *  which is a write like any other and not the absence of one. */
	private pending = $state<{ chatId: string; pin: GalleryPin | null } | null>(null);
	private timer: ReturnType<typeof setTimeout> | null = null;

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

	/** The path on screen, which is what gets pinned. Null when nothing is loaded. */
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
		this.setOpen(true);
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
	 * touched, in memory or on the row, so restoring shows exactly what was there. This is
	 * the notepad's rule rather than the old pop-out's: the one destructive door is `unload`,
	 * and it is a separate button that says so.
	 */
	minimize(): void {
		if (!this.open) return;
		this.setOpen(false);
	}

	/** Stand the window back up. Whatever was loaded is still loaded. */
	restore(): void {
		if (this.open) return;
		this.setOpen(true);
	}

	toggle(): void {
		if (this.open) this.minimize();
		else this.restore();
	}

	/**
	 * Empty the window, leaving the frame standing.
	 *
	 * The other half of the split: this is the one that unpins the picture, so returning to
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

	/** Move the frame and record it against the story, in one place, so the flag and the
	 *  localStorage list cannot drift apart. */
	private setOpen(next: boolean): void {
		this.open = next;
		const chatId = this.boundChatId;
		if (!chatId) return;
		if (next) rememberPopoutOpen(chatId);
		else forgetPopoutOpen(chatId);
	}

	/**
	 * Pin what is on screen to the story it belongs to, debounced.
	 *
	 * Only ever writes the picture. Whether the window is standing went to `setOpen` above and
	 * never reaches the row, which is the whole point of the split: a phone must not inherit a
	 * frame a desktop left up.
	 */
	private remember(): void {
		const chatId = this.boundChatId;
		if (!chatId) return;
		const path = this.currentPath;
		const pin = path && this.sourceId ? { path, sourceId: this.sourceId } : null;
		this.pending = { chatId, pin };
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.flush(), PERSIST_MS);
	}

	/**
	 * Push a pending pin out now.
	 *
	 * Public because the debounce has ends that are not the timer: leaving the story, and the
	 * page going away. `flush` is the house name for this (see `lorebookStore.flush`).
	 */
	async flush(): Promise<void> {
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		const write = this.pending;
		if (!write) return;
		await chatStore.updateChatFeatureState(write.chatId, { galleryPin: write.pin });
		// Only drop what actually went out: a page turn during the round trip left a newer pin
		// here, and clearing it would rewind the row to whatever was sent.
		if (this.pending === write) this.pending = null;
	}

	/**
	 * Put the window where the newly opened chat says it should be.
	 *
	 * Called ONLY when the loaded chat actually changes, never as a reactive invariant. The
	 * difference is load-bearing: an invariant would shut the window in the frame it opened.
	 * A window is only wrong once the reader *moves*, which is exactly this event.
	 *
	 * The outgoing chat's pending pin is flushed first, and that write carries its own id, so
	 * a page turned up to the instant of the switch lands on the story it was made in.
	 *
	 * `null` (the welcome screen, a deleted chat) clears without restoring anything.
	 */
	followChat(chatId: string | null): void {
		if (this.boundChatId === chatId) return;
		void this.flush();
		this.clearLoaded();
		this.open = false;
		this.boundChatId = chatId;
		if (chatId) this.restoreFor(chatId);
	}

	/**
	 * Restore what this story was left with: the frame from this device's own record, the
	 * picture from the chat row, and the SET re-read from the source entry's live gallery
	 * rather than from anything stored, so a path deleted since is a miss to report rather
	 * than a broken image to render.
	 *
	 * The set is loaded even when the frame is down, which costs an array of strings and no
	 * image request, and makes restoring from the title bar instant instead of a second round
	 * through this.
	 */
	private restoreFor(chatId: string): void {
		this.open = isPopoutOpenFor(chatId);

		const chat = chatStore.currentChatState?.chat;
		// The row is the source of truth, but only once the story it belongs to is the one
		// actually loaded: `followChat` fires on that edge, so this is the ordinary case and a
		// mismatch means the rows have not landed yet.
		if (chat?.id !== chatId) return;
		const pin = normalizeChatFeatureState(chat.featureState).galleryPin;
		if (!pin) return;

		const source = characterLibraryStore.entries.find((e) => e.id === pin.sourceId);
		const gallery = source?.identity.gallery ?? [];
		const at = gallery.indexOf(pin.path);
		if (at === -1) {
			// Said out loud rather than passed over in silence: the reader left a picture here
			// and is owed a reason it is not back. The window itself is left exactly as the
			// records described it, so an empty frame stands where a full one would have, and
			// the pin goes so the notice comes once rather than on every visit.
			this.remember();
			toastStore.info('The image left in the gallery window here is no longer in its gallery.');
			return;
		}

		this.images = [...gallery];
		this.index = at;
		this.sourceId = pin.sourceId;
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
	 * the frame. Pins on OTHER chats that sourced the same entry are deliberately left alone:
	 * each of those chats can still be walked back into, and `restoreFor` gives its reader the
	 * same notice at the moment it is worth hearing.
	 */
	forgetEntry(entryId: string): void {
		if (this.sourceId !== entryId) return;
		this.unload();
		toastStore.info('The image in the gallery window was deleted with its gallery.');
	}

	/**
	 * Drop the standing-window record for stories that no longer exist.
	 *
	 * The pinned pictures need no sweep at all: they are a column on the chat row, so deleting
	 * the chat takes them, on every device at once. What is left behind is this device's memory
	 * of whether a frame was up, and a deleted chat's id would sit in it until the cap pushed
	 * it out. Driven from the window's own effect off the live chat list, so one row, a batch,
	 * and a delete arriving from another device are all the same event, and no delete path has
	 * to know this feature exists.
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
