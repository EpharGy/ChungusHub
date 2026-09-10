/**
 * Whether the frameworks panel is standing, and nothing else.
 *
 * Deliberately thin. Everything the panel SHOWS is derived fresh from the books, the chat and
 * the path (`frameworks/panel.ts`), so there is no view state to keep in step: the only thing
 * worth remembering between sessions is whether the window was up.
 *
 * That flag is per device, in `localStorage`, for the reason the floating window's rectangle
 * is: "there is a window open" is a fact about the screen in front of you, not about the
 * story. It is a single boolean rather than the notepad's list of chats, because this panel is
 * about whichever chat is loaded and has nothing to remember per story.
 *
 * Whether the panel is filtered to entries that fired is kept the same way, and DEFAULTS ON.
 * The everyday question is "what is the model being told right now", and a book of fifty
 * characters answers it unreadably when every entry is listed. Unticking it is the
 * troubleshooting view, and it is the only one that can show a marker whose entry never fires.
 *
 * Which BOOKS are folded shut is kept on the same terms and for the same reason. It is keyed
 * on book id rather than on the chat, so a reader who never wants to see a large reference
 * book expanded stops folding it away in every story. A book id that no longer exists costs
 * nothing: it names no group, so it is never read.
 */
import { registerFloatingPanel } from '$lib/stores/floating-panels.svelte';
import { chatStore } from '$lib/stores/chat.svelte';

const KEY = 'framework-panel-open';
const COLLAPSED_KEY = 'framework-panel-collapsed';
const ONLY_FIRED_KEY = 'framework-panel-only-fired';

/** Reading it can throw outright in a private window or with site data blocked, so every
 *  access is guarded and an unreadable store simply reads as closed. */
function read(): boolean {
	try {
		return localStorage.getItem(KEY) === '1';
	} catch {
		return false;
	}
}

function write(open: boolean): void {
	try {
		localStorage.setItem(KEY, open ? '1' : '0');
	} catch {
		// A browser that will not store this is not a reason to lose the window that is open.
	}
}

/** Stored as JSON, so anything that is not an array of strings is treated as nothing folded.
 *  A panel that threw on startup because a stored value was edited would be worse than one
 *  that opens with every book expanded. */
/** Absent means ON, which is the default. Only an explicit "0" turns it off, so a reader who
 *  never touches it gets the filtered view on every device. */
function readOnlyFired(): boolean {
	try {
		return localStorage.getItem(ONLY_FIRED_KEY) !== '0';
	} catch {
		return true;
	}
}

function writeOnlyFired(on: boolean): void {
	try {
		localStorage.setItem(ONLY_FIRED_KEY, on ? '1' : '0');
	} catch {
		// As with the open flag: not being able to remember it is not a reason to refuse it.
	}
}

function readCollapsed(): string[] {
	try {
		const raw = localStorage.getItem(COLLAPSED_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
	} catch {
		return [];
	}
}

function writeCollapsed(ids: string[]): void {
	try {
		localStorage.setItem(COLLAPSED_KEY, JSON.stringify(ids));
	} catch {
		// As above: not being able to remember the fold is not a reason to refuse to fold.
	}
}

class FrameworkPanelStore {
	/** Seeded closed and restored on mount: reading storage at module scope runs during the
	 *  static build, where there is no `localStorage` at all. */
	open = $state(false);
	/** Book ids folded shut. Expanded is the default, so a new book is visible the first time
	 *  a reader meets it rather than hidden behind a fold they never chose. */
	collapsed = $state<string[]>([]);
	/** Restrict the panel to entries whose text reached the prompt. See the note above on why
	 *  this starts on. */
	onlyFired = $state(true);
	private restored = false;

	/** Called once by the window, which is mounted for the app's whole life. */
	restore(): void {
		if (this.restored) return;
		this.restored = true;
		this.open = read();
		this.collapsed = readCollapsed();
		this.onlyFired = readOnlyFired();
	}

	setOnlyFired(on: boolean): void {
		this.onlyFired = on;
		writeOnlyFired(on);
	}

	isCollapsed(bookId: string): boolean {
		return this.collapsed.includes(bookId);
	}

	toggleBook(bookId: string): void {
		this.collapsed = this.isCollapsed(bookId)
			? this.collapsed.filter((id) => id !== bookId)
			: [...this.collapsed, bookId];
		writeCollapsed(this.collapsed);
	}

	set(open: boolean): void {
		this.open = open;
		write(open);
	}

	toggle(): void {
		this.set(!this.open);
	}
}

export const frameworkPanelStore = new FrameworkPanelStore();

/**
 * The title bar entry, so the panel can actually be raised.
 *
 * It went without one for a while, which made it a window nothing opened: the code was all
 * there and the only way in was a slash command nobody had a reason to guess at. Every other
 * floating panel registers here, and a panel that does not is a panel that does not exist.
 *
 * `disabled` rather than hidden when there is no chat, the same choice the notepad makes: a
 * button that vanishes shifts the whole cluster sideways the moment a chat opens, and a greyed
 * one that says why is the cheaper explanation.
 */
registerFloatingPanel({
	id: 'frameworks',
	order: 40,
	label: 'Frameworks',
	icon: 'sliders',
	isOpen: () => frameworkPanelStore.open,
	toggle: () => frameworkPanelStore.toggle(),
	disabled: () => !chatStore.activeChat,
	tooltip: () =>
		chatStore.activeChat
			? 'Frameworks: what the markers in this chat are doing'
			: 'Frameworks: open a chat first'
});
