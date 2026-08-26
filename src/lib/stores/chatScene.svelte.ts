/**
 * Which scene the open chat wears.
 *
 * A chat either follows the app's background and ambient mix or carries a whole scene of
 * its own, stored on its own row (`feature_state`, architecture/chat-sessions.md). A whole
 * scene rather than a patch: with every field answered in one place nothing on screen has
 * to say which half of a picture is inherited, and flipping the switch on seeds the chat
 * from what is already on screen, so the press itself changes nothing.
 *
 * Switching back off KEEPS the chat's scene. The switch is a switch, not a way to lose an
 * afternoon's tuning, and it is what spares this control the destructive-act ladder.
 *
 * Writes are debounced because a chat row write broadcasts the `chats` scope, which every
 * other device answers with a chat-list refetch: a slider drag would send one per frame.
 * The pending scene is what the app reads meanwhile, so the drag still paints at full rate,
 * and the write carries the chat id it started on, so switching chats mid-flight lands it
 * on the story it was made for.
 */

import { chatStore } from '$lib/stores/chat.svelte';
import { normalizeChatFeatureState, type ChatScene } from '$lib/types/chat';
import type { AmbientConfig } from '$lib/types/ambient';
import type { BackgroundConfig } from '$lib/types/background';

const PERSIST_MS = 250;

class ChatSceneStore {
	/** Written but not yet persisted, with the chat it belongs to. */
	private pending = $state<{ chatId: string; scene: ChatScene } | null>(null);
	private timer: ReturnType<typeof setTimeout> | null = null;

	/** The open chat's own scene, in force or merely kept, or null if it has never had one. */
	scene = $derived.by((): ChatScene | null => {
		const chatId = chatStore.activeChatId;
		if (!chatId) return null;
		if (this.pending?.chatId === chatId) return this.pending.scene;
		return chatStore.featureState(chatId).scene;
	});

	/** The scene the workspace and the settings cards are on, or null while the app's is. */
	active = $derived(this.scene?.enabled ? this.scene : null);

	/** Whether there is a chat to give a scene to at all. */
	canScope = $derived(chatStore.activeChatId !== null);

	/** How many other chats an app-wide change will not reach. */
	otherChatsWithScene = $derived.by((): number => {
		const openId = chatStore.activeChatId;
		return chatStore.chats.filter(
			(chat) =>
				chat.id !== openId && normalizeChatFeatureState(chat.featureState).scene?.enabled === true
		).length;
	});

	/** Put this chat on its own scene, seeding a chat that has never had one from what is
	 *  already on screen. An existing scene comes back as it was left. */
	adopt(seed: { background: BackgroundConfig; ambient: AmbientConfig }): void {
		const existing = this.scene;
		this.write(existing ? { ...existing, enabled: true } : { enabled: true, ...seed });
	}

	/** Hand the chat back to the app's scene, keeping its own for the way back. */
	release(): void {
		const existing = this.scene;
		if (existing) this.write({ ...existing, enabled: false });
	}

	/** Replace the open chat's scene. Called by the ambient and background stores whenever
	 *  a control writes while a chat scene is in force. */
	write(next: ChatScene): void {
		const chatId = chatStore.activeChatId;
		// The callers all gate on `active` or `canScope`, so no open chat here is a bug in
		// one of them rather than a state worth absorbing.
		if (!chatId) throw new Error('No chat is open, so there is no scene to write');
		this.pending = { chatId, scene: next };
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.flush(), PERSIST_MS);
	}

	private async flush(): Promise<void> {
		this.timer = null;
		const write = this.pending;
		if (!write) return;
		await chatStore.updateChatFeatureState(write.chatId, { scene: write.scene });
		// Only drop what actually went out: a drag that carried on during the round trip
		// left a newer scene here, and clearing it would snap the slider back.
		if (this.pending === write) this.pending = null;
	}
}

export const chatSceneStore = new ChatSceneStore();
