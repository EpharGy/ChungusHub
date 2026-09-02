/**
 * The reader's notes about the story they are in, and the one window that shows them.
 *
 * Two halves with two different homes, and the split is the whole design:
 *
 * - **The notes are the chat's**, on its own row (`feature_state.notepad`,
 *   architecture/chat-sessions.md). Per chat, not per character: a character with six stories
 *   running has six sets of notes, because what is being tracked is who is in the room and
 *   what they owe each other in THIS one. Server-side, so notes survive a cleared browser and
 *   are there on the phone.
 * - **The window is the device's**, in localStorage: its rectangle (via `FloatingWindow`) and
 *   whether it is standing (`notepad-memory.ts`). Neither means anything on another screen.
 *
 * Writes are debounced, because a chat row write broadcasts the `chats` scope and every other
 * device answers it with a chat-list refetch: a keystroke each would be a refetch each. The
 * pending text is what the window reads meanwhile, so typing paints at full speed, and the
 * write carries the chat id it started on, so leaving mid-sentence still lands it on the
 * story it was written for.
 *
 * Unlike the image pop-out this shares a window shell with, the notepad HAS a launcher: the
 * title bar's button. That changes one thing and only one - closing is cheap, because it is
 * always one click from coming back - so the X puts the window away and never touches a word
 * of what is in it. No door here destroys notes except Clear, which asks first.
 */

import { chatStore } from '$lib/stores/chat.svelte';
import { NOTEPAD_LIMIT, normalizeChatFeatureState } from '$lib/types/chat';
import {
	forgetNotepadOpen,
	isNotepadOpenFor,
	pruneNotepadMemory,
	rememberNotepadOpen
} from '$lib/utils/notepad-memory';

/**
 * How long a pause in typing is before the note goes to the server.
 *
 * Longer than the scene store's 250ms, and for the opposite reason: a slider drag is a burst
 * that ends, so a short debounce there costs one write. Typing is a burst that keeps
 * restarting, so a short debounce here bills a write per word. Six hundred milliseconds is
 * about the gap between sentences, which puts the write where the reader has stopped to think
 * rather than where they were mid-word.
 */
const PERSIST_MS = 600;

class NotepadStore {
	/** Written but not yet persisted, with the chat it belongs to. */
	private pending = $state<{ chatId: string; text: string } | null>(null);
	private timer: ReturnType<typeof setTimeout> | null = null;

	/** Whether the window is standing. The localStorage record is owned by `show` and
	 *  `close` below rather than by an effect over this, so the flag and the record cannot
	 *  drift apart. */
	open = $state(false);

	/**
	 * The chat ON SCREEN, deliberately not the chat being navigated to.
	 *
	 * `activeChatId` is claimed the moment a row is clicked and the rows land a couple of
	 * hundred milliseconds later, so notes keyed on the id would swap at the click and leave
	 * the story still on screen wearing a stranger's notes. Keyed on the loaded chat, the
	 * story and its notes arrive together. Same reasoning, same choice, as `chatScene`.
	 */
	private openChat = $derived(chatStore.currentChatState?.chat ?? null);

	/** Whether there is a story to take notes on at all. False on the welcome screen. */
	canScope = $derived(this.openChat !== null);

	/** The open chat's notes: what has been typed if a write is in flight, what is stored
	 *  otherwise. Empty string when nothing is open, so the window never renders null. */
	text = $derived.by((): string => {
		const chat = this.openChat;
		if (!chat) return '';
		if (this.pending?.chatId === chat.id) return this.pending.text;
		return normalizeChatFeatureState(chat.featureState).notepad;
	});

	/** Whether this story has notes waiting, which is what the title bar's button marks
	 *  itself with. Without it a closed notepad is indistinguishable from an empty one, and
	 *  a page written last week is a page nobody is ever told about again. */
	hasNotes = $derived(this.text.trim().length > 0);

	/** Room left before the clamp. The window shows it only once it is close, so the number
	 *  is a warning rather than a running commentary on someone's typing. */
	remaining = $derived(NOTEPAD_LIMIT - this.text.length);

	/** The title bar's button. Opening remembers, so returning to this story brings the
	 *  window back; closing forgets, so it does not. */
	toggle(): void {
		if (this.open) this.close();
		else this.show();
	}

	show(): void {
		const chatId = this.openChat?.id;
		if (!chatId) return; // no story, no notes; the button is disabled for this too
		this.open = true;
		rememberNotepadOpen(chatId);
	}

	/**
	 * The reader put the window away. That is a decision about this story, so returning to it
	 * does NOT bring the window back - the opposite of the switch below, which is the app
	 * closing the window on the reader's behalf.
	 *
	 * **Nothing is written and nothing is lost.** The notes stay on the row; only the window
	 * goes. Any keystroke still in flight is pushed out first, because a close is exactly the
	 * moment someone stops typing and stops watching.
	 */
	close(): void {
		const chatId = this.openChat?.id;
		void this.flush();
		this.open = false;
		if (chatId) forgetNotepadOpen(chatId);
	}

	/**
	 * Put the window where the newly opened chat says it should be: gone unless that story
	 * was left with one standing, in which case back.
	 *
	 * Called ONLY when the loaded chat actually changes, never as a reactive invariant, for
	 * the reason the pop-out's twin documents at length: an invariant re-asserted every tick
	 * fights the frame in which something opens. A window is only wrong once the reader moves.
	 *
	 * The outgoing chat's pending text is flushed first, and that write carries its own id,
	 * so a note typed up to the instant of the switch lands on the story it was about.
	 */
	followChat(chatId: string | null): void {
		void this.flush();
		this.open = chatId ? isNotepadOpenFor(chatId) : false;
	}

	/**
	 * Drop the standing-window record for stories that no longer exist.
	 *
	 * The notes themselves need no sweep at all: they are a column on the chat row, so
	 * deleting the chat takes them, on every device at once. What is left behind is this
	 * device's memory of whether a window was up, and a deleted chat's id would sit in it
	 * until the cap pushed it out. Driven from the window's own effect off the live chat
	 * list, so one row, a batch, and a delete arriving from another device are all the same
	 * event, and no delete path has to know this feature exists.
	 */
	pruneTo(liveChatIds: ReadonlySet<string>): void {
		pruneNotepadMemory(liveChatIds);
	}

	/** Replace the open chat's notes, clamped. The only door text comes in by. */
	write(next: string): void {
		// The chat on screen, never the one being navigated to: a keystroke must land on the
		// story whose notes the reader is looking at while they type them.
		const chatId = this.openChat?.id;
		// The window only renders with a chat open, so no chat here is a bug in a caller
		// rather than a state worth absorbing.
		if (!chatId) throw new Error('No chat is open, so there are no notes to write');
		this.pending = { chatId, text: next.slice(0, NOTEPAD_LIMIT) };
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.flush(), PERSIST_MS);
	}

	/** Throw the open chat's notes away. Raised behind a confirmation by its one caller: the
	 *  text is not recoverable and, unlike everything else this window does, not visible
	 *  after the fact either. */
	clear(): void {
		this.write('');
		void this.flush();
	}

	/**
	 * Push any pending text out now.
	 *
	 * Public because the debounce has four ends and only one of them is the timer: closing
	 * the window, leaving the story, leaving the page, and clicking away from the textarea.
	 * `flush` is the house name for this (see `lorebookStore.flush`, which the title bar
	 * already calls for the same reason).
	 */
	async flush(): Promise<void> {
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		const write = this.pending;
		if (!write) return;
		await chatStore.updateChatFeatureState(write.chatId, { notepad: write.text });
		// Only drop what actually went out: typing that carried on during the round trip left
		// newer text here, and clearing it would rewind the window to whatever was sent.
		if (this.pending === write) this.pending = null;
	}
}

export const notepadStore = new NotepadStore();
