/**
 * The settings blob, kept apart from the store that acts on it.
 *
 * `engines/registry.ts` wants exactly one thing from EchoChamber: the switch behind its row on
 * the engines page. Reaching that through `stores/echochamber.svelte.ts` drags in the whole
 * runtime with it - the chat, character, persona, lorebook and memory stores - and memory
 * imports the LLM provider, which imports `stores/connections.svelte.ts`, which reads `ENGINES`
 * back out of the registry while the registry is still evaluating. `ENGINES` is a `const`, so
 * whichever side of that ring the loader enters first meets it in the temporal dead zone and the
 * whole module graph dies on load.
 *
 * Holding the settings here cuts the ring: this module imports the setting transport and the
 * pure config, and nothing that can lead back to a connection. The registry and the store share
 * one copy of the state, so a toggle from the engines page and a toggle from the EchoChamber
 * page are the same write rather than two that can disagree.
 */
import {
	BurstSettingWriter,
	readSetting,
	registerSettingsReload
} from '$lib/services/syncedSetting';
import { DEFAULT_ECHOCHAMBER_SETTINGS, resolveEchoChamberSettings } from './config';
import type { EchoChamberSettings } from './types';

const SETTINGS_KEY = 'echochamber';

class EchoChamberSettingsStore {
	current = $state<EchoChamberSettings>(DEFAULT_ECHOCHAMBER_SETTINGS);

	// The page's sliders write on every input event, and each write is a broadcast every
	// other device answers with a full re-read. Only where the drag stops is worth sending.
	private writer = new BurstSettingWriter<EchoChamberSettings>(SETTINGS_KEY);

	/** First read, plus a standing subscription: this module reads a settings row, so it is
	 *  this module that has to hear another device's write. Borrowing the store's reload would
	 *  put the listener in the file that does not do the reading. */
	async initialize(): Promise<void> {
		await this.reload();
		registerSettingsReload(() => this.reload());
	}

	/** Re-read from storage: on load, and again whenever synced settings change under us. */
	async reload(): Promise<void> {
		// A write still owed means the screen is newer than storage; reading back now would
		// snap a slider to where it was before the drag.
		if (this.writer.busy) return;
		const stored = await readSetting<Partial<EchoChamberSettings> | null>(SETTINGS_KEY, null);
		if (this.writer.busy) return;
		this.current = resolveEchoChamberSettings(stored);
	}

	/** Patch settings, clamped on the way in so no panel can store a bad value. */
	update(patch: Partial<EchoChamberSettings>): void {
		this.current = resolveEchoChamberSettings({ ...this.current, ...patch });
		this.writer.write(this.current);
	}
}

export const echoChamberSettings = new EchoChamberSettingsStore();
