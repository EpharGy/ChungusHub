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
import { lorebookStore } from '$lib/lorebook/store.svelte';
import { memoryStore } from '$lib/memory/store.svelte';
import { toastStore } from '$lib/stores/toast.svelte';
import { llmService } from '$lib/services/llm/provider';
import { readSetting, registerSettingsReload, writeSetting } from '$lib/services/syncedSetting';
import type { LLMMessage } from '$lib/types/llm';
import type { Message } from '$lib/types/chat';
import { findActivePath } from '$lib/utils/message-tree';

import { expandMacros } from '$lib/macros';
import { buildLiveMacroContext } from '$lib/utils/live-macro-context';

import { DEFAULT_ECHOCHAMBER_SETTINGS, resolveEchoChamberSettings } from '$lib/echochamber/config';
import {
	duplicateStyle,
	normalizeCustomStyles,
	removeStyle,
	upsertStyle
} from '$lib/echochamber/custom-styles';
import {
	clearFeed,
	newestFeedOnPath,
	putFeed,
	type EchoChamberChatState
} from '$lib/echochamber/feed-state';
import { lorebookTextFromTrace } from '$lib/echochamber/lorebook-context';
import { parseReactions } from '$lib/echochamber/parse';
import { buildPrompt, castNamesForStyle, pastReactionsFor } from '$lib/echochamber/prompt';
import { BUILT_IN_STYLES } from '$lib/echochamber/styles';
import type {
	ChatStyle,
	EchoChamberFeed,
	EchoChamberSettings,
	Reaction,
	StoryContext
} from '$lib/echochamber/types';

const SETTINGS_KEY = 'echochamber';
/** Reader-authored styles, apart from the settings blob: they are the part that grows. */
const STYLES_KEY = 'echochamber-styles';

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

	/** Reader-authored styles, loaded from their own setting. */
	customStyles = $state<ChatStyle[]>([]);

	/** Everything pickable: the shipped styles, then the reader's own. */
	get styles(): ChatStyle[] {
		return [...BUILT_IN_STYLES, ...this.customStyles];
	}

	/** The live style, falling back rather than failing: a stored id can name a custom style
	 *  that was deleted or a built-in this build no longer ships, and neither is worth a
	 *  broken panel. */
	get activeStyle(): ChatStyle {
		return this.styles.find((s) => s.id === this.settings.styleId) ?? BUILT_IN_STYLES[0];
	}

	async initialize(): Promise<void> {
		await this.reload();
		registerSettingsReload(() => this.reload());
		this.loaded = true;
	}

	private async reload(): Promise<void> {
		const stored = await readSetting<Partial<EchoChamberSettings> | null>(SETTINGS_KEY, null);
		this.settings = resolveEchoChamberSettings(stored);
		this.customStyles = normalizeCustomStyles(await readSetting<unknown>(STYLES_KEY, []));
	}

	// ===== Authoring styles =====

	private writeStyles(next: ChatStyle[]): void {
		this.customStyles = next;
		writeSetting(STYLES_KEY, next);
	}

	/** A new style, seeded from an existing one so the editor never opens on a blank page:
	 *  a style is a long instruction with a required output contract at the end, and writing
	 *  one from nothing is a far worse first experience than editing one that works. */
	createStyle(source?: ChatStyle): ChatStyle {
		const from = source ?? this.activeStyle;
		const style = duplicateStyle(from, this.styles.map((s) => s.id));
		this.writeStyles(upsertStyle(this.customStyles, style));
		return style;
	}

	/** Save an edit. Built-ins are not editable in place (duplicateStyle is how they are
	 *  changed), so this only ever writes a custom entry. */
	saveStyle(style: ChatStyle): void {
		if (!style.custom) return;
		this.writeStyles(upsertStyle(this.customStyles, style));
	}

	/** Delete a custom style, moving off it first if it is the one in use. */
	deleteStyle(id: string): void {
		this.writeStyles(removeStyle(this.customStyles, id));
		if (this.settings.styleId === id) this.update({ styleId: BUILT_IN_STYLES[0].id });
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

	/**
	 * What the panel shows: the newest feed that EXISTS on this path, with the turn it
	 * belongs to.
	 *
	 * Deliberately not "the feed of the newest turn". The instant a reply lands it becomes
	 * the newest turn with no feed of its own, so that reading blanks the panel for the
	 * length of the call and then repopulates - the previous reactions were never deleted,
	 * we simply stopped looking at them. This keeps them on screen and swaps when the new
	 * ones arrive, and it means a delete falls back to the last surviving feed rather than
	 * to an empty box.
	 */
	get displayed(): { messageId: string; feed: EchoChamberFeed } | null {
		const path = chatStore.currentChatState?.activePath ?? [];
		return newestFeedOnPath(path, (id) => this.feedFor(id));
	}

	/** The turn a NEW feed would be generated for: always the newest reply, which is not
	 *  necessarily the turn whose feed is currently on screen. */
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
			const style = this.resolveStyleText(this.activeStyle);
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

	/**
	 * Expand the app's ordinary macros in a style's prompt.
	 *
	 * `{{user}}` and `{{char}}` are the two the extension's own editor advertises, and a
	 * reader-authored style is where they actually get used, since no shipped style needs
	 * one. Running the whole app macro set rather than those two by hand means a style can
	 * also reach {{persona}}, the clock macros, and anything added later, for free.
	 *
	 * Deliberately BEFORE `resolveStyleMacros` and separate from it: `substitute` leaves a
	 * name it does not know untouched, so `{{characters}}` and `{{story_characters_block}}`
	 * pass through here intact and are resolved by the prompt builder, which is the only
	 * place that has the cast.
	 */
	private resolveStyleText(style: ChatStyle): ChatStyle {
		if (!style.prompt.includes('{{')) return style;
		const expanded = expandMacros(style.prompt, buildLiveMacroContext());
		return expanded === style.prompt ? style : { ...style, prompt: expanded };
	}

	/** Everything the prompt builder needs, resolved from the stores that hold it. */
	private buildContext(messageId: string): StoryContext | null {
		const state = chatStore.currentChatState;
		if (!state) return null;

		// The turn's own ancestry, walked from the row rather than sliced out of the open
		// path. A turn the reader has navigated away from is not on that path at all, and the
		// crowd would otherwise have nothing to react to; the walk answers the same question
		// in the ordinary case, where the two are the same list.
		const ancestry = findActivePath(state.allMessages, messageId);
		const target = ancestry[ancestry.length - 1];
		if (!target || target.id !== messageId) return null;

		const history = this.historyFor(ancestry);
		if (history.length === 0) return null;

		const persona = personaStore.activeEntry;
		const character = state.chat.characterId
			? (characterLibraryStore.entries.find((e) => e.id === state.chat.characterId) ?? null)
			: null;

		const characterDescriptions = character
			? [{ name: character.identity.name, description: describe(character.data.traits) }]
			: [];

		const pastReactions = this.settings.includePastReactions
			? pastReactionsFor(history, messageId, (id) => this.feedFor(id))
			: {};

		return {
			history: history.map((m) => ({ role: m.role, content: m.content })),
			personaName: persona?.identity.name ?? 'User',
			personaDescription: persona ? describe(persona.data.traits) : '',
			characterDescriptions,
			// What the STORY's own scan activated for this turn, not a second scan of our own:
			// the crowd must never know something the reply it is reacting to was not told.
			lorebook: this.settings.includeLorebook
				? lorebookTextFromTrace(target.lorebook, lorebookStore.books)
				: '',
			// The engine's own recall for the open chat, already derived and branch-aware. It
			// describes the story as of the current path tip, so regenerating a feed on an
			// older turn shows the crowd a little more than that turn's model had. Harmless
			// for the ordinary case (the newest reply), and the alternative is re-deriving
			// coverage per message for a decoration.
			memory: this.settings.includeMemory ? memoryStore.recall : '',
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
