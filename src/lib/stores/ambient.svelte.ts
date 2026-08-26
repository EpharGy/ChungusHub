/**
 * The ambient mix in force.
 *
 * Two places hold one: the app-wide setting every chat follows, and the open chat's own
 * scene (stores/chatScene.svelte.ts). `config` is whichever is in force and every reader
 * takes it from here, the workspace and the settings mixer alike, so the card always edits
 * exactly what is on screen and no caller has to know which of the two it is writing to.
 */
import type { AmbientType, AmbientConfig } from '$lib/types/ambient';
import {
	DEFAULT_AMBIENT_CONFIG,
	normalizeAmbientConfig,
	normalizeAmbientTypes,
	settingsFor
} from '$lib/types/ambient';
import { chatSceneStore } from '$lib/stores/chatScene.svelte';
import {
	BurstSettingWriter,
	readSetting,
	registerSettingsReload
} from '$lib/services/syncedSetting';

const SETTINGS_KEY = 'ambientConfig';

class AmbientStore {
	/** The app-wide mix: what every chat without a scene of its own wears. */
	private appConfig = $state<AmbientConfig>({ ...DEFAULT_AMBIENT_CONFIG });

	/** Every knob here is a slider or a switch on one card, so the writes come in bursts. */
	private writer = new BurstSettingWriter<AmbientConfig>(SETTINGS_KEY);

	/** The mix in force. */
	config = $derived(chatSceneStore.active?.ambient ?? this.appConfig);

	async initialize(): Promise<void> {
		this.appConfig = normalizeAmbientConfig(await readSetting<unknown>(SETTINGS_KEY, null));
		registerSettingsReload(() => this.syncReload());
	}

	async syncReload(): Promise<void> {
		const next = normalizeAmbientConfig(await readSetting<unknown>(SETTINGS_KEY, null));
		// A write still owed is newer than anything the server can hand back, so taking
		// this would drag the slider out from under the finger holding it.
		if (this.writer.busy) return;
		this.appConfig = next;
	}

	/** Land a whole mix on whichever scene is in force. */
	private write(next: AmbientConfig): void {
		const chatScene = chatSceneStore.active;
		if (chatScene) {
			chatSceneStore.write({ ...chatScene, ambient: next });
			return;
		}
		this.appConfig = next;
		this.writer.write(next);
	}

	private applySelection(nextTypes: AmbientType[]): void {
		const normalizedTypes = normalizeAmbientTypes(nextTypes);
		this.write({
			...this.config,
			type: normalizedTypes[0] ?? 'clear',
			types: normalizedTypes,
			enabled: normalizedTypes.length > 0
		});
	}

	toggleAmbient(type: AmbientType): void {
		if (type === 'clear') {
			this.applySelection([]);
			return;
		}

		const hasType = this.config.types.includes(type);
		const nextTypes = hasType
			? this.config.types.filter((existing) => existing !== type)
			: [...this.config.types, type];
		this.applySelection(nextTypes);
	}

	clearAmbients(): void {
		this.applySelection([]);
	}

	/** Move one knob of one effect. Covers the four every effect carries and the ones it
	 *  has of its own: they are one list, so this is one setter. */
	setEffectSetting(type: AmbientType, key: string, value: number): void {
		const def = settingsFor(type).find((d) => d.key === key);
		if (!def || !Number.isFinite(value)) return;
		const clamped = Math.max(def.min, Math.min(def.max, value));
		this.write({
			...this.config,
			effectSettings: {
				...this.config.effectSettings,
				[type]: { ...this.config.effectSettings[type], [key]: clamped }
			}
		});
	}
}

export const ambientStore = new AmbientStore();
