/**
 * Frameworks' APP-WIDE settings: what is available at all, and each framework's own tunables.
 *
 * Two switches reach a framework and they answer different questions, which is why both exist
 * rather than one:
 *
 *   - **here**, whether this install carries the framework at all. Off means it is not offered
 *     to any chat and its row is greyed;
 *   - **on the chat** (`ChatFrameworkState.enabled`), whether this story uses it.
 *
 * Same shape Memory has: an app-wide switch on the settings page and per-chat enablement on
 * its own surface. A story is the thing that decides whether it wants a cycle tracked; the
 * install is the thing that decides whether tracking exists.
 *
 * The `config` values are opaque here, exactly as `byFramework` is on the chat blob: the base
 * never reads inside one, and the framework that owns it normalizes it when it reads it. That
 * is what lets a framework add a tunable without touching this file.
 *
 * Pure: this is the type and its normalizer. The store that persists it lives in
 * `stores/frameworkSettings.svelte.ts`, because prompt assembly reads these and may not touch
 * a store.
 */
import { defaultChatFrameworkState, type ChatFrameworkState } from './chat-state';
import { FRAMEWORKS } from './registry';
import type { FrameworkDef } from './types';

/** Framework configs one install may carry. A backstop against a corrupt blob. */
export const MAX_CONFIGS = 64;

/** Choices one framework may store for new chats. A backstop, like the caps around it. */
export const MAX_NEW_CHAT_CHOICES = 16;

/**
 * How one framework starts in a new chat.
 *
 * A third switch beside the two below, and it answers neither of their questions: it does not
 * decide whether a framework exists or whether a story uses it, only what a story that has not
 * been asked yet starts with. The chat's own switch still decides from then on, so this is a
 * starting point and never an override, and changing it touches no chat that already exists.
 */
export interface NewChatDefault {
	/** Ticked in every new chat. */
	on: boolean;
	/** The framework's own choices, by key (see `FrameworkNewChat`). Opaque here: the
	 *  framework's declared options are what decide whether a stored value still means
	 *  anything, and that is checked where they are in hand. */
	choices: Record<string, string>;
}

export interface FrameworkSettings {
	/**
	 * Availability, by framework id. Absent reads as OFF.
	 *
	 * Off by default rather than on, and deliberately: a framework injects text into every
	 * prompt of every chat that opts in, and a feature that starts writing into prompts on its
	 * own the first time someone updates is a feature nobody agreed to.
	 */
	enabled: Record<string, boolean>;
	/** Each framework's own app-wide tunables, keyed by id. Opaque to the base. */
	config: Record<string, unknown>;
	/** How each framework starts in a new chat, keyed by id. Absent reads as off: a chat
	 *  starting with nothing ticked is what it did before this existed. */
	newChat: Record<string, NewChatDefault>;
}

export function defaultFrameworkSettings(): FrameworkSettings {
	return { enabled: {}, config: {}, newChat: {} };
}

function normalizeNewChatDefault(raw: unknown): NewChatDefault | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const stored = raw as Record<string, unknown>;
	const choices: Record<string, string> = {};
	if (stored.choices && typeof stored.choices === 'object' && !Array.isArray(stored.choices)) {
		for (const [key, value] of Object.entries(stored.choices as Record<string, unknown>)) {
			if (typeof value !== 'string') continue;
			choices[key] = value;
			if (Object.keys(choices).length >= MAX_NEW_CHAT_CHOICES) break;
		}
	}
	// Only a literal true ticks, for the reason only a literal true enables.
	return { on: stored.on === true, choices };
}

export function normalizeFrameworkSettings(raw: unknown): FrameworkSettings {
	const out = defaultFrameworkSettings();
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
	const stored = raw as Record<string, unknown>;

	if (stored.enabled && typeof stored.enabled === 'object' && !Array.isArray(stored.enabled)) {
		for (const [id, value] of Object.entries(stored.enabled as Record<string, unknown>)) {
			// Only a literal true enables. Anything else is a value nothing here wrote, and
			// guessing what a truthy string meant is how a framework switches itself on.
			if (value === true) out.enabled[id.toLowerCase()] = true;
			if (Object.keys(out.enabled).length >= MAX_CONFIGS) break;
		}
	}

	if (stored.config && typeof stored.config === 'object' && !Array.isArray(stored.config)) {
		for (const [id, value] of Object.entries(stored.config as Record<string, unknown>)) {
			// A config that is not a plain object is not something a framework wrote, and
			// handing one on would make every framework defend against it separately.
			if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
			out.config[id.toLowerCase()] = value;
			if (Object.keys(out.config).length >= MAX_CONFIGS) break;
		}
	}

	if (stored.newChat && typeof stored.newChat === 'object' && !Array.isArray(stored.newChat)) {
		for (const [id, value] of Object.entries(stored.newChat as Record<string, unknown>)) {
			const entry = normalizeNewChatDefault(value);
			if (!entry) continue;
			out.newChat[id.toLowerCase()] = entry;
			if (Object.keys(out.newChat).length >= MAX_CONFIGS) break;
		}
	}
	return out;
}

/**
 * A framework's new-chat choices with every value resolved: the stored one while it is still
 * one of the declared options, the declared default otherwise.
 *
 * A stored value can stop being an option when a framework drops one, and resolving here is
 * what keeps the page and the seeded chat agreeing about what it falls back to.
 */
export function resolveNewChatChoices(
	framework: Pick<FrameworkDef, 'newChat'>,
	stored: NewChatDefault | undefined
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const choice of framework.newChat?.choices ?? []) {
		const value = stored?.choices[choice.key];
		out[choice.key] = choice.options.some((o) => o.value === value) ? (value as string) : choice.default;
	}
	return out;
}

/**
 * The framework state a brand-new chat starts with.
 *
 * Only frameworks available on this install are seeded: one switched off app-wide is not
 * offered to any chat, and a new chat is no exception. Requirements are added the way the
 * panel's own tick adds them, so the stored list reads the same as one a reader ticked by hand.
 *
 * Everything else is the plain default. The day in particular is not seeded: it counts from 1
 * in manual mode and is not read at all in real time, so there is no starting day to choose.
 */
export function newChatFrameworkState(
	settings: FrameworkSettings,
	registry: readonly Pick<FrameworkDef, 'id' | 'requires' | 'alwaysOn' | 'newChat'>[] = FRAMEWORKS
): ChatFrameworkState {
	const state = defaultChatFrameworkState();
	const enabled = new Set<string>();
	for (const framework of registry) {
		// No switch to start ticked: it is on in every chat already.
		if (framework.alwaysOn) continue;
		const stored = settings.newChat[framework.id];
		if (!stored?.on || !frameworkAvailable(settings, framework.id, registry)) continue;
		enabled.add(framework.id);
		for (const needed of framework.requires ?? []) enabled.add(needed);
		if (!framework.newChat) continue;
		const seeded = framework.newChat.seed(resolveNewChatChoices(framework, stored));
		if (seeded.mode) state.mode = seeded.mode;
		if (seeded.slice) state.byFramework[framework.id] = seeded.slice;
	}
	state.enabled = [...enabled];
	return state;
}

/**
 * Whether a framework is available on this install.
 *
 * A framework that declares `alwaysOn` answers true whatever is stored, so the switch it has
 * no UI for cannot be left in a state that contradicts what is running. The registry is a
 * parameter for the reason `enabledFrameworks` takes one: a test says which frameworks exist
 * rather than moving when a branch carrying one is left out of the build.
 */
export function frameworkAvailable(
	settings: FrameworkSettings,
	id: string,
	registry: readonly { id: string; alwaysOn?: boolean }[] = FRAMEWORKS
): boolean {
	if (registry.some((framework) => framework.id === id && framework.alwaysOn)) return true;
	return settings.enabled[id] === true;
}
