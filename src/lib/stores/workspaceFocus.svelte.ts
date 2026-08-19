/**
 * What the user currently has open in the workspace, beyond the active chat.
 *
 * The library entry open in its editor, and the lorebook open in the Lorebook view. Both
 * live in this tiny standalone store (not in their views' local component state), so the
 * signal survives the view unmounting where it must. The assistant input reads this to
 * auto-attach "the thing you're editing" as context.
 *
 * The two focuses release differently, on purpose. The entry focus outlives its view and
 * is released by `uiStore.closeLibrary()`: the dock, not the editor component, owns when
 * the user has left the Library. The lorebook focus is released by the Lorebook view's own
 * unmount: that view exists exactly while its overlay is open, so unmounting IS the user
 * navigating away, and without the release the assistant would keep pointing at a book
 * long since closed.
 */
class WorkspaceFocusStore {
	/** Library entry id open (or most-recently open) in the editor; null when none. */
	entryId = $state<string | null>(null);

	/** Lorebook id open in the Lorebook view; null when the view is closed. */
	lorebookId = $state<string | null>(null);

	setEntry(id: string | null): void {
		this.entryId = id;
	}

	setLorebook(id: string | null): void {
		this.lorebookId = id;
	}
}

export const workspaceFocus = new WorkspaceFocusStore();
