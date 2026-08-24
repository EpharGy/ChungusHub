/**
 * The EchoChamber engine: a reply lands, a crowd reacts to it.
 *
 * Shaped after the Sprites engine, which solves the same problem: one background call per
 * reply, whose result belongs to a single message row and whose failure has to be visible
 * somewhere. What differs is where the result goes. A sprite label is a column; a feed is
 * a list of generated lines, so it rides the chat's `feature_state` blob instead
 * (`echochamber/feed-state.ts` explains why that and not a table of its own).
 *
 * Ownership follows the rest of the app: the chat row belongs to the chat store, so this
 * writes through `chatStore.updateChatFeatureState` and lets its serialized read-merge-write
 * settle the ordering, rather than patching a chat in place.
 *
 * **One call at a time, and the newest wins.** A reader swiping through alternates can ask
 * for three feeds faster than one returns, and a feed is decoration: the right answer to a
 * second request is to abandon the first, not to queue it and bill for both.
 */

import { chatStore } from '$lib/stores/chat.svelte';
import { characterLibraryStore } from '$lib/stores/characterLibrary.svelte';
import { personaStore } from '$lib/stores/persona.svelte';
import { toastStore } from '$lib/stores/toast.svelte';
import { llmService } from '$lib/services/llm/provider';
import { readSetting, registerSettingsReload, writeSetting } from '$lib/services/syncedSetting';
import type { LLMMessage } from '$lib/types/llm';
import type { Message } from '$lib/types/chat';

import { DEFAULT_ECHOCHAMBER_SETTINGS, resolveEchoChamberSettings } from '$lib/echochamber/config';
import { clearFeed, putFeed, type EchoChamberChatState } from '$lib/echochamber/feed-state';
import { parseReactions } from '$lib/echochamber/parse';
import { buildPrompt, castNamesForStyle } from '$lib/echochamber/prompt';
import { BUILT_IN_STYLES, builtInStyle } from '$lib/echochamber/styles';
import type {
	ChatStyle,
	EchoChamberFeed,
	EchoChamberSettings,
	Reaction,
	StoryContext
} from '$lib/echochamber/types';

const SETTINGS_KEY = 'echochamber';

/** A turn the crowd can react to. System turns are scaffolding, not story. */
function isStoryTurn(message: Message): message is Message & { role: 'user' | 'assistant' } {
	return message.role === 'user' || message.role === 'assistant';
}

class EchoChamberStore {
	settings = $state<EchoChamberSettings>(DEFAULT_ECHOCHAMBER_SETTINGS);
	loaded = $state(false);

	/** The message a call is in flight for, or null. One at a time, by design. */
	generatingFor = $state<string | null>(null);
	/** The last failure, shown on the panel rather than only in a toast that has gone. */
	lastError = $state<string | null>(null);

	private controller: AbortController | null = null;

	/** Built-ins only for now. Reader-authored styles land here beside them, which is why
	 *  `ChatStyle.custom` exists already and why nothing indexes this list by position. */
	get styles(): ChatStyle[] {
		return BUILT_IN_STYLES;
	}

	/** The live style, falling back rather than failing: a stored id can name a style this
	 *  build no longer ships, and a feed is not worth a broken panel. */
	get activeStyle(): ChatStyle {
		return builtInStyle(this.settings.styleId) ?? BUILT_IN_STYLES[0];
	}

	async initialize(): Promise<void> {
		await this.reload();
		registerSettingsReload(() => this.reload());
		this.loaded = true;
	}

	private async reload(): Promise<void> {
		const stored = await readSetting<Partial<EchoChamberSettings> | null>(SETTINGS_KEY, null);
		this.settings = resolveEchoChamberSettings(stored);
	}

	/** Patch settings, clamped on the way in so the panel can never store a bad value. */
	update(patch: Partial<EchoChamberSettings>): void {
		this.settings = resolveEchoChamberSettings({ ...this.settings, ...patch });
		writeSetting(SETTINGS_KEY, this.settings);
	}

	// ===== Reading feeds =====

	private stateFor(chatId: string): EchoChamberChatState {
		return chatStore.featureState(chatId).echoChamber;
	}

	/** The feed filed against a message, or null. Reactive for the open chat, since
	 *  `chatStore.featureState` reads off `currentChatState`. */
	feedFor(messageId: string): EchoChamberFeed | null {
		const chatId = chatStore.currentChatState?.chat.id;
		if (!chatId) return null;
		return this.stateFor(chatId).feeds[messageId] ?? null;
	}

	/** The feed for the newest assistant turn on the path: what the panel shows. */
	get currentFeed(): EchoChamberFeed | null {
		const messageId = this.newestReactableId();
		return messageId ? this.feedFor(messageId) : null;
	}

	get currentMessageId(): string | null {
		return this.newestReactableId();
	}

	/** The turn a feed belongs to: the newest assistant reply on the active path. A user
	 *  turn is not reacted to on its own, because the crowd is watching the story, and the
	 *  story is what the character just said. */
	private newestReactableId(): string | null {
		const path = chatStore.currentChatState?.activePath ?? [];
		for (let i = path.length - 1; i >= 0; i--) {
			if (path[i].role === 'assistant') return path[i].id;
		}
		return null;
	}

	// ===== Generating =====

	/**
	 * The per-turn sidecar: react to this message unless it already has a feed.
	 *
	 * Never throws and never blocks the reply that triggered it. Off when the engine is off
	 * or auto-generate is off, which is what keeps a reader who wants the button and not the
	 * bill from paying on every turn.
	 */
	async ensureForMessage(messageId: string): Promise<void> {
		if (!this.settings.enabled || !this.settings.autoGenerate) return;
		if (this.feedFor(messageId)) return;
		if (this.generatingFor === messageId) return;
		await this.generateFor(messageId).catch(() => undefined);
	}

	/** Regenerate on demand, from the panel's button. Replaces whatever is filed. */
	async regenerate(messageId: string): Promise<void> {
		await this.generateFor(messageId);
	}

	async generateFor(messageId: string): Promise<void> {
		if (!this.settings.enabled) return;

		const state = chatStore.currentChatState;
		if (!state) return;
		const chatId = state.chat.id;

		// Newest request wins: abandon whatever is in flight rather than queueing a feed
		// nobody is waiting for any more.
		this.controller?.abort();
		const controller = new AbortController();
		this.controller = controller;
		this.generatingFor = messageId;
		this.lastError = null;

		try {
			const style = this.activeStyle;
			const context = this.buildContext(messageId);
			if (!context) return;

			const built = buildPrompt(style, this.settings, context);
			const result = await llmService.complete(
				{ engine: 'echochamber' },
				{
					messages: built.messages as LLMMessage[],
					source: 'echochamber',
					signal: controller.signal
				}
			);

			if (controller.signal.aborted) return;

			const reactions = parseReactions(result.content, {
				limit: built.requestedCount,
				castNames: castNamesForStyle(style, context),
				order: this.settings.messageOrder
			});

			if (reactions.length === 0) {
				// A style that produced nothing readable is worth saying out loud: the call was
				// paid for, and an empty panel otherwise looks like the engine never ran.
				this.lastError = 'The model returned nothing this style could read.';
				return;
			}

			await this.storeFeed(chatId, messageId, {
				styleId: style.id,
				reactions,
				createdAt: Date.now()
			});
		} catch (error) {
			if (controller.signal.aborted) return;
			const message = error instanceof Error ? error.message : String(error);
			this.lastError = message;
			toastStore.error(`EchoChamber: ${message}`);
		} finally {
			if (this.controller === controller) {
				this.controller = null;
				this.generatingFor = null;
			}
		}
	}

	/** Abandon the call in flight, leaving whatever feed was already filed. */
	cancel(): void {
		this.controller?.abort();
		this.controller = null;
		this.generatingFor = null;
	}

	/** Forget one message's feed, so the next generation starts from nothing. */
	async forget(messageId: string): Promise<void> {
		const chatId = chatStore.currentChatState?.chat.id;
		if (!chatId) return;
		const next = clearFeed(this.stateFor(chatId), messageId);
		await chatStore.updateChatFeatureState(chatId, { echoChamber: next });
	}

	/**
	 * File the feed, pruning dead and surplus entries in the same write.
	 *
	 * `allMessages` rather than the active path: a feed on another branch is not stale, it
	 * is just not being looked at (feed-state.ts).
	 */
	private async storeFeed(chatId: string, messageId: string, feed: EchoChamberFeed): Promise<void> {
		const live = (chatStore.currentChatState?.allMessages ?? []).map((m) => m.id);
		const next = putFeed(this.stateFor(chatId), messageId, feed, live);
		await chatStore.updateChatFeatureState(chatId, { echoChamber: next });
	}

	// ===== Context =====

	/** Everything the prompt builder needs, resolved from the stores that hold it. */
	private buildContext(messageId: string): StoryContext | null {
		const state = chatStore.currentChatState;
		if (!state) return null;

		const path = state.activePath;
		const target = path.findIndex((m) => m.id === messageId);
		if (target < 0) return null;

		const history = this.historyFor(path.slice(0, target + 1));
		if (history.length === 0) return null;

		const persona = personaStore.activeEntry;
		const character = state.chat.characterId
			? (characterLibraryStore.entries.find((e) => e.id === state.chat.characterId) ?? null)
			: null;

		const characterDescriptions = character
			? [{ name: character.identity.name, description: describe(character.data.traits) }]
			: [];

		const pastReactions: Record<number, Reaction[]> = {};
		if (this.settings.includePastReactions) {
			history.forEach((turn, index) => {
				const feed = this.feedFor(turn.id);
				if (feed) pastReactions[index] = feed.reactions;
			});
		}

		return {
			history: history.map((m) => ({ role: m.role, content: m.content })),
			personaName: persona?.identity.name ?? 'User',
			personaDescription: persona ? describe(persona.data.traits) : '',
			characterDescriptions,
			// Not wired yet: both need text the prompt pipeline assembles server-side, so the
			// settings page does not offer either toggle until they resolve to something.
			lorebook: '',
			memory: '',
			castNames: characterDescriptions.map((c) => c.name),
			pastReactions
		};
	}

	/**
	 * The turns to react to.
	 *
	 * With `includeUserInput` off this is the reply alone, which is the cheap default: one
	 * turn in, a feed out. With it on, the window walks back to start on a user turn where
	 * it can, so the crowd sees a complete exchange rather than an answer to a question it
	 * was never shown.
	 */
	private historyFor(upToTarget: Message[]): (Message & { role: 'user' | 'assistant' })[] {
		const visible = upToTarget.filter(isStoryTurn);
		if (visible.length === 0) return [];
		if (!this.settings.includeUserInput) return visible.slice(-1);

		const depth = this.settings.contextDepth;
		let start = Math.max(0, visible.length - depth);
		for (let i = start; i >= 0; i--) {
			if (visible[i].role === 'user') {
				start = i;
				break;
			}
		}
		const window = visible.slice(start);
		return window.length > depth ? window.slice(-depth) : window;
	}
}

/** A library entry's prose, as one block. Empty when the entry says nothing. */
function describe(traits: { description?: string; personality?: string }): string {
	return [traits.description, traits.personality]
		.map((part) => part?.trim())
		.filter(Boolean)
		.join('\n\n');
}

export const echoChamberStore = new EchoChamberStore();
