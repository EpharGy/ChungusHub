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

/** Framework configs one install may carry. A backstop against a corrupt blob. */
export const MAX_CONFIGS = 64;

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
}

export function defaultFrameworkSettings(): FrameworkSettings {
	return { enabled: {}, config: {} };
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
	return out;
}

/** Whether a framework is available on this install. */
export function frameworkAvailable(settings: FrameworkSettings, id: string): boolean {
	return settings.enabled[id] === true;
}
