/**
 * The user's live text selection inside the active roleplay chat.
 *
 * Mirrors how an IDE feeds the editor selection to the model: the moment the user
 * highlights text in a message, that becomes the Chungus Assistant's auto-attached
 * context, pointing the assistant at the exact spot to look at or edit, instead of the
 * whole chat. It collapses back to nothing as soon as the selection clears, so it
 * only ever reflects what is highlighted right now.
 */

/** Hard cap on the excerpt we carry: a long highlight still points; it doesn't dump. */
export const MAX_SELECTION_CHARS = 2000;

export interface ChatSelectionState {
	/** The chat the selection lives in. */
	chatId: string;
	/** Message the selection starts in: the anchor the assistant reads around / edits. */
	anchorMessageId: string;
	/** The selected excerpt, trimmed and capped to MAX_SELECTION_CHARS. */
	text: string;
	/** Whether the excerpt was cut to fit the cap. */
	truncated: boolean;
	/** How many message bubbles the selection spans (1 = within a single message). */
	spanCount: number;
	/** Word count of the selection. Drives the "N words selected" chip for short picks. */
	wordCount: number;
	/** Visual line count of the highlight. Drives the "N lines selected" chip for big picks. */
	lineCount: number;
}

class ChatSelectionStore {
	chatId = $state<string | null>(null);
	anchorMessageId = $state<string | null>(null);
	text = $state('');
	truncated = $state(false);
	spanCount = $state(0);
	wordCount = $state(0);
	lineCount = $state(0);

	/** True when there is a real, non-empty selection to attach. */
	get active(): boolean {
		return !!this.chatId && !!this.anchorMessageId && this.text.length > 0;
	}

	set(sel: ChatSelectionState): void {
		this.chatId = sel.chatId;
		this.anchorMessageId = sel.anchorMessageId;
		this.text = sel.text;
		this.truncated = sel.truncated;
		this.spanCount = sel.spanCount;
		this.wordCount = sel.wordCount;
		this.lineCount = sel.lineCount;
	}

	clear(): void {
		if (!this.chatId && !this.text) return;
		this.chatId = null;
		this.anchorMessageId = null;
		this.text = '';
		this.truncated = false;
		this.spanCount = 0;
		this.wordCount = 0;
		this.lineCount = 0;
	}
}

export const chatSelection = new ChatSelectionStore();
