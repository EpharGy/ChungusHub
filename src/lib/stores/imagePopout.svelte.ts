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
 * The window is also a fixture of the CHAT being read, not of the picture. See `followChat`.
 */
import { toastStore } from './toast.svelte';
import { chatStore } from './chat.svelte';
import { characterLibraryStore } from './characterLibrary.svelte';
import {
	forgetPopout,
	prunePopoutMemory,
	readPopoutMemory,
	rememberPopout
} from '$lib/utils/popout-memory';

/** The window's accessible name for an entry's gallery. One recipe, two callers: the grid
 *  that pops a picture out, and the reopen that has only an id to work from. */
export function galleryLabel(entryName?: string): string {
	const name = entryName?.trim();
	return name ? `${name} gallery` : 'Gallery image';
}

class ImagePopoutStore {
	/** Server-relative image paths, in the order the source surface shows them. */
	images = $state<string[]>([]);
	index = $state(0);
	/** What the set is, for the window's accessible name (e.g. a character's name). */
	label = $state('Image');
	open = $state(false);

	/**
	 * The chat that was on screen when this window was made: the story it belongs to, and
	 * the only thing that decides when it goes away and comes back.
	 *
	 * Deliberately NOT the picture's owner, and deliberately not that chat's CHARACTER
	 * either. A reader who opens character A's art while reading a story about B wants that
	 * picture for as long as they are reading that story, and wants it gone the moment they
	 * leave it, including when they leave for another of B's own chats, because a character
	 * with six stories running is six separate rooms and a reference pinned up in one of them
	 * is not a fact about all six. The window is furniture of the story; the picture in it is
	 * only what got put on the shelf.
	 *
	 * Null when the pop-out was made with no chat open, which is a window belonging to
	 * nobody: the next story to open takes the shelf away and nothing brings it back.
	 */
	boundChatId = $state<string | null>(null);

	/** The library entry whose gallery this set came from, which may be anybody, a persona
	 *  included. Kept because it is the only way to rebuild the set on the way back in. */
	sourceId = $state<string | null>(null);

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
	 *
	 * Which story the window belongs to is read from the open chat HERE rather than passed
	 * in, so no call site can get it wrong and no surface offering a pop-out has to know
	 * chats exist. It reads the LOADED chat rather than the one being navigated to, matching
	 * what the window's own effect watches: keyed on anything else, the two would disagree
	 * for the couple of hundred milliseconds a chat takes to arrive.
	 */
	show(images: string[], index: number, options: { label?: string; sourceId?: string } = {}): void {
		if (images.length === 0) return;
		const replacing = this.open;
		this.images = [...images];
		this.index = Math.min(Math.max(index, 0), images.length - 1);
		if (options.label) this.label = options.label;
		this.sourceId = options.sourceId ?? null;
		this.boundChatId = chatStore.currentChatState?.chat.id ?? null;
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
	 * The reader closed the window. That is a decision about this story, so the picture is
	 * forgotten too and coming back to that chat does NOT bring it back: the opposite of
	 * `suspend` below, which is the app closing the window on the reader's behalf.
	 */
	close(): void {
		if (this.boundChatId) forgetPopout(this.boundChatId);
		this.reset();
	}

	/**
	 * The reader moved to another story, so the window goes but the picture is kept: coming
	 * back to this one reopens it. Called only by `followChat`.
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
		this.boundChatId = null;
		this.sourceId = null;
	}

	/** Record what is on screen against the story it was opened in, so a reload finds it
	 *  again. Both halves are needed: without the source there is no set to rebuild. */
	private remember(): void {
		const path = this.currentPath;
		if (this.boundChatId && this.sourceId && path) {
			rememberPopout(this.boundChatId, { path, sourceId: this.sourceId });
		}
	}

	/**
	 * Put the window where the newly opened chat says it should be: gone if it was made
	 * while reading another story, back if this one had one open.
	 *
	 * Called ONLY when the loaded chat actually changes, never as a reactive invariant. The
	 * difference is load-bearing: the gallery is in the library, which is reachable while any
	 * chat is open, so popping a picture out there is an ordinary thing to do and an
	 * invariant would shut the window in the frame it opened. A window is only wrong once the
	 * reader *moves*, which is exactly this event.
	 *
	 * `null` (the welcome screen, a deleted chat) suspends without reopening anything.
	 */
	followChat(chatId: string | null): void {
		if (this.open && this.boundChatId === chatId) return;
		if (this.open) this.suspend();
		if (chatId) this.reopenFor(chatId);
	}

	/**
	 * Reopen the picture this story was left on, read back out of its SOURCE entry's live
	 * gallery rather than out of any stored set: a path deleted since is then a miss to
	 * report rather than a broken image to render. The source is whoever the picture came
	 * from, which is routinely nobody in this chat.
	 */
	private reopenFor(chatId: string): void {
		const remembered = readPopoutMemory()[chatId];
		if (!remembered) return;

		const source = characterLibraryStore.entries.find((e) => e.id === remembered.sourceId);
		const gallery = source?.identity.gallery ?? [];
		const at = gallery.indexOf(remembered.path);
		if (at === -1) {
			// Said out loud rather than passed over in silence: the reader left a window open
			// and is owed a reason it is not there. Forgotten at the same time, so the notice
			// is once and not on every visit.
			forgetPopout(chatId);
			toastStore.info('The image left popped out here is no longer in its gallery.');
			return;
		}

		// `show` reads the bound chat off the loaded chat, which the caller has already moved
		// to `chatId`: this runs on the edge, after the switch.
		this.show(gallery, at, {
			label: galleryLabel(source?.identity.name),
			sourceId: remembered.sourceId
		});
	}

	/**
	 * The library entry this window's set came from has been deleted, taking its image files
	 * with it. Close the window and say so.
	 *
	 * This is the one thing a chat-keyed binding cannot notice on its own: deleting a
	 * character happens *inside* the story you are reading, so the chat never changes and the
	 * edge above never fires. Without this the window sits there showing files the delete
	 * already swept, and the only thing that ever tells the reader is a missing-file panel.
	 *
	 * Closes rather than suspends, because the picture is not coming back: returning to this
	 * story must not try to reopen it. Records for OTHER chats that sourced the same entry
	 * are deliberately left alone: each of those chats can still be walked back into, and
	 * `reopenFor` gives its reader the same notice at the moment it is worth hearing.
	 */
	forgetEntry(entryId: string): void {
		if (!this.open || this.sourceId !== entryId) return;
		this.close();
		toastStore.info('The popped-out image was deleted with its gallery.');
	}

	/**
	 * Drop remembered pictures for stories that no longer exist.
	 *
	 * The record is capped, so it can never grow without bound; this is what stops it going
	 * STALE, which the cap alone does not: twenty pictures pinned to twenty deleted chats is
	 * within the cap and is still twenty rows of nothing. Driven from the window's own effect
	 * off the live chat list, so a delete anywhere (one row, a batch, another device) is
	 * swept without every delete path having to know this feature exists.
	 */
	pruneTo(liveChatIds: ReadonlySet<string>): void {
		prunePopoutMemory(liveChatIds);
	}
}

export const imagePopoutStore = new ImagePopoutStore();
