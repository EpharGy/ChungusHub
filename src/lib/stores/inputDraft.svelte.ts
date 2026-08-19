/**
 * Composer drafts, one per chat, persisted server-side so an unsent message
 * survives reloads and follows the user across devices.
 *
 * Writes ride the shared `DebouncedWriter`, keyed by chat id so a pending write for one
 * chat is never lost by switching to another before it fires, and committed when the tab
 * goes away so the last half-second of typing survives a close or a backgrounding rather
 * than replaying on wake.
 */
import { db } from '$lib/services/database';
import { DebouncedWriter } from '$lib/utils/debounced-write';
import { generalSettingsStore } from '$lib/stores/general-settings.svelte';

const SAVE_DEBOUNCE_MS = 500;

class InputDraftStore {
	private writer = new DebouncedWriter(SAVE_DEBOUNCE_MS, (chatId) => this.commit(chatId));
	// The text each pending write will send. Unlike every other store on the writer, a
	// composer draft is not held in reactive state anywhere, so the value has to wait here.
	private pending = new Map<string, string>();

	// The latest draft pushed from another device. InputArea watches this and
	// adopts it when it matches the open chat and the user isn't mid-typing.
	remote = $state<{ chatId: string; content: string } | null>(null);

	async load(chatId: string): Promise<string> {
		if (!generalSettingsStore.saveDrafts) return '';
		// A not-yet-committed local write is newer than whatever the server has.
		const pending = this.pending.get(chatId);
		if (pending !== undefined) return pending;
		const row = await db.getChatDraft(chatId);
		return row?.content ?? '';
	}

	schedule(chatId: string, content: string): void {
		if (!generalSettingsStore.saveDrafts) return;
		this.pending.set(chatId, content);
		this.writer.schedule(chatId);
	}

	/** Drop the draft (message sent), cancelling any pending write first. */
	clear(chatId: string): void {
		this.writer.cancel(chatId);
		this.pending.delete(chatId);
		void db.deleteChatDraft(chatId);
	}

	private async commit(chatId: string): Promise<void> {
		const content = this.pending.get(chatId);
		this.pending.delete(chatId);
		if (content === undefined) return;
		// An emptied box means "no draft", not an empty draft row.
		if (content.trim()) await db.upsertChatDraft(chatId, content);
		else await db.deleteChatDraft(chatId);
	}

	/** Another device changed a draft; surface the active chat's current value. */
	async syncReload(activeChatId: string | null): Promise<void> {
		if (!activeChatId || !generalSettingsStore.saveDrafts) return;
		const row = await db.getChatDraft(activeChatId);
		this.remote = { chatId: activeChatId, content: row?.content ?? '' };
	}
}

export const inputDraftStore = new InputDraftStore();
