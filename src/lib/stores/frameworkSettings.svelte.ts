/**
 * Frameworks' app-wide settings: which are available on this install, and each one's own
 * tunables. Synced across devices via the shared `settings` spine, like feature prompts.
 *
 * The store is deliberately thin. The shape, its defaults and its normalizer live in
 * `frameworks/settings.ts`, because prompt assembly reads these values and may not touch a
 * store; this is only the part that persists them and makes them reactive. Same split the
 * frameworks registry keeps for the same reason.
 *
 * A framework's own config is opaque here. `patchConfig` merges a partial into one framework's
 * blob without knowing what is inside it, which is what lets a framework add a tunable without
 * this file changing.
 */
import { readSetting, writeSetting, registerSettingsReload } from '$lib/services/syncedSetting';
import {
	defaultFrameworkSettings,
	frameworkAvailable,
	normalizeFrameworkSettings,
	type FrameworkSettings
} from '$lib/frameworks/settings';
import { requiredBy } from '$lib/frameworks/chat-state';
import { FRAMEWORKS } from '$lib/frameworks/registry';

const SETTINGS_KEY = 'frameworks';

class FrameworkSettingsStore {
	state = $state<FrameworkSettings>(defaultFrameworkSettings());
	loaded = $state(false);

	async initialize(): Promise<void> {
		this.state = normalizeFrameworkSettings(await readSetting<unknown>(SETTINGS_KEY, null));
		this.loaded = true;
		registerSettingsReload(() => this.syncReload());
	}

	async syncReload(): Promise<void> {
		this.state = normalizeFrameworkSettings(await readSetting<unknown>(SETTINGS_KEY, null));
	}

	private persist(): void {
		writeSetting(SETTINGS_KEY, this.state);
	}

	/** The whole blob, for the pure code that takes it as an argument. */
	get settings(): FrameworkSettings {
		return this.state;
	}

	isAvailable(id: string): boolean {
		return frameworkAvailable(this.state, id);
	}

	/**
	 * Turn a framework on or off for the whole install.
	 *
	 * Turning one ON pulls in whatever it requires, because a framework that cannot work is
	 * not a state worth being able to reach. Turning one OFF is refused while something that
	 * requires it is on: the caller is told which, so it can say so rather than appearing to
	 * do nothing. Both halves of the same rule the chat blob enforces on its own list.
	 */
	setAvailable(id: string, value: boolean): { ok: true } | { ok: false; blockedBy: string[] } {
		if (!value) {
			const on = Object.keys(this.state.enabled).filter((k) => this.state.enabled[k]);
			const blockedBy = requiredBy(id, on);
			if (blockedBy.length > 0) return { ok: false, blockedBy };
		}
		const next = { ...this.state.enabled };
		if (value) {
			next[id] = true;
			for (const needed of FRAMEWORKS.find((f) => f.id === id)?.requires ?? []) next[needed] = true;
		} else {
			delete next[id];
		}
		this.state = { ...this.state, enabled: next };
		this.persist();
		return { ok: true };
	}

	/** One framework's app-wide config, exactly as stored. The framework normalizes it. */
	configFor(id: string): unknown {
		return this.state.config[id];
	}

	/** Merge fields into one framework's config. Partial, so a page can save one control
	 *  without having to hold the rest of that framework's settings to write them back. */
	patchConfig(id: string, patch: Record<string, unknown>): void {
		const current = this.state.config[id];
		const base = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
		this.state = { ...this.state, config: { ...this.state.config, [id]: { ...base, ...patch } } };
		this.persist();
	}

	/** Drop a framework's config back to its own defaults, by removing it: the framework's
	 *  normalizer answers with defaults for an absent blob, so there is nothing to write. */
	resetConfig(id: string): void {
		const next = { ...this.state.config };
		delete next[id];
		this.state = { ...this.state, config: next };
		this.persist();
	}
}

export const frameworkSettingsStore = new FrameworkSettingsStore();
