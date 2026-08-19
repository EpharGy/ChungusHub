import type { AmbientType, AmbientConfig } from '$lib/types/ambient';
import { AMBIENT_EFFECT_SETTINGS, AMBIENT_EFFECTS } from '$lib/types/ambient';
import { readSetting, writeSetting, registerSettingsReload } from '$lib/services/syncedSetting';

const SETTINGS_KEY = 'ambientConfig';
const EFFECT_TYPE_SET = new Set<string>(AMBIENT_EFFECTS);

export const DENSITY_RANGE = { min: 0.2, max: 2, default: 1 };
export const SPEED_RANGE = { min: 0.25, max: 2, default: 1 };
export const VISIBILITY_RANGE = { min: 0.05, max: 1, default: 0.5 };

export const DEFAULT_CONFIG: AmbientConfig = {
	type: 'clear',
	types: [],
	density: DENSITY_RANGE.default,
	speed: SPEED_RANGE.default,
	visibility: VISIBILITY_RANGE.default,
	enabled: false,
	particlesOverMessages: true,
	effectSettings: {}
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, value));
}

function normalizeAmbientTypes(input: unknown, fallback?: unknown): AmbientType[] {
	const normalized: AmbientType[] = [];

	function tryAdd(value: unknown): void {
		if (typeof value !== 'string') return;
		const ambient = value as AmbientType;
		if (!EFFECT_TYPE_SET.has(ambient)) return;
		if (!normalized.includes(ambient)) normalized.push(ambient);
	}

	if (Array.isArray(input)) {
		for (const value of input) {
			tryAdd(value);
		}
	}

	if (normalized.length === 0) {
		tryAdd(fallback);
	}

	return normalized;
}

/** Keep only known effect types and known setting keys, clamped to their def range. */
function normalizeEffectSettings(input: unknown): AmbientConfig['effectSettings'] {
	if (!input || typeof input !== 'object') return {};
	const normalized: AmbientConfig['effectSettings'] = {};

	for (const [type, defs] of Object.entries(AMBIENT_EFFECT_SETTINGS)) {
		const raw = (input as Record<string, unknown>)[type];
		if (!raw || typeof raw !== 'object') continue;
		const entry: Record<string, number> = {};
		for (const def of defs) {
			const value = (raw as Record<string, unknown>)[def.key];
			if (typeof value !== 'number' || !Number.isFinite(value)) continue;
			entry[def.key] = Math.max(def.min, Math.min(def.max, value));
		}
		if (Object.keys(entry).length > 0) normalized[type as AmbientType] = entry;
	}

	return normalized;
}

type StoredAmbient = Partial<AmbientConfig> & {
	type?: unknown;
	types?: unknown;
	intensity?: unknown; // pre-density/speed/visibility blobs
	density?: unknown;
	speed?: unknown;
	visibility?: unknown;
	enabled?: unknown;
	particlesOverMessages?: unknown;
	effectSettings?: unknown;
};

/** Coerce a raw settings blob into a valid AmbientConfig. */
function normalizeConfig(parsed: StoredAmbient | null): AmbientConfig {
	if (!parsed) return { ...DEFAULT_CONFIG };
	const normalizedTypes = normalizeAmbientTypes(parsed.types, parsed.type);
	const parsedEnabled = typeof parsed.enabled === 'boolean' ? parsed.enabled : normalizedTypes.length > 0;
	const particlesOverMessages =
		typeof parsed.particlesOverMessages === 'boolean'
			? parsed.particlesOverMessages
			: DEFAULT_CONFIG.particlesOverMessages;

	// Legacy blobs stored a single `intensity` that scaled both alpha and motion.
	// Seed visibility and speed from it so the old look carries over 1:1.
	const legacyIntensity =
		typeof parsed.intensity === 'number' && Number.isFinite(parsed.intensity) ? parsed.intensity : null;
	const visibilityFallback =
		legacyIntensity !== null
			? Math.max(VISIBILITY_RANGE.min, Math.min(VISIBILITY_RANGE.max, legacyIntensity))
			: VISIBILITY_RANGE.default;
	const speedFallback =
		legacyIntensity !== null
			? Math.max(SPEED_RANGE.min, Math.min(SPEED_RANGE.max, legacyIntensity * 2))
			: SPEED_RANGE.default;

	return {
		type: normalizedTypes[0] ?? 'clear',
		types: normalizedTypes,
		density: clampNumber(parsed.density, DENSITY_RANGE.min, DENSITY_RANGE.max, DENSITY_RANGE.default),
		speed: clampNumber(parsed.speed, SPEED_RANGE.min, SPEED_RANGE.max, speedFallback),
		visibility: clampNumber(
			parsed.visibility,
			VISIBILITY_RANGE.min,
			VISIBILITY_RANGE.max,
			visibilityFallback
		),
		enabled: normalizedTypes.length > 0 ? parsedEnabled : false,
		particlesOverMessages,
		effectSettings: normalizeEffectSettings(parsed.effectSettings)
	};
}

class AmbientStore {
	// Current ambient state
	config = $state<AmbientConfig>({ ...DEFAULT_CONFIG });

	isActive = $derived(this.config.enabled && this.config.types.length > 0);

	async initialize(): Promise<void> {
		this.config = normalizeConfig(await readSetting<StoredAmbient | null>(SETTINGS_KEY, null));
		registerSettingsReload(() => this.syncReload());
	}

	async syncReload(): Promise<void> {
		this.config = normalizeConfig(await readSetting<StoredAmbient | null>(SETTINGS_KEY, null));
	}

	private persist(): void {
		writeSetting(SETTINGS_KEY, this.config);
	}

	private applySelection(nextTypes: AmbientType[]): void {
		const normalizedTypes = normalizeAmbientTypes(nextTypes);
		this.config = {
			...this.config,
			type: normalizedTypes[0] ?? 'clear',
			types: normalizedTypes,
			enabled: normalizedTypes.length > 0
		};
		this.persist();
	}

	setAmbient(type: AmbientType): void {
		this.applySelection(type === 'clear' ? [] : [type]);
	}

	setAmbients(types: AmbientType[]): void {
		this.applySelection(types);
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

	setDensity(density: number): void {
		this.config.density = clampNumber(density, DENSITY_RANGE.min, DENSITY_RANGE.max, this.config.density);
		this.persist();
	}

	setSpeed(speed: number): void {
		this.config.speed = clampNumber(speed, SPEED_RANGE.min, SPEED_RANGE.max, this.config.speed);
		this.persist();
	}

	setVisibility(visibility: number): void {
		this.config.visibility = clampNumber(
			visibility,
			VISIBILITY_RANGE.min,
			VISIBILITY_RANGE.max,
			this.config.visibility
		);
		this.persist();
	}

	setEffectSetting(type: AmbientType, key: string, value: number): void {
		const def = AMBIENT_EFFECT_SETTINGS[type]?.find((d) => d.key === key);
		if (!def || !Number.isFinite(value)) return;
		const clamped = Math.max(def.min, Math.min(def.max, value));
		this.config.effectSettings = {
			...this.config.effectSettings,
			[type]: { ...this.config.effectSettings[type], [key]: clamped }
		};
		this.persist();
	}

	enable(): void {
		if (this.config.types.length === 0) return;
		this.config.enabled = true;
		this.persist();
	}

	disable(): void {
		this.config.enabled = false;
		this.persist();
	}

	toggle(): void {
		if (this.config.types.length === 0) return;
		this.config.enabled = !this.config.enabled;
		this.persist();
	}

	setParticlesOverMessages(value: boolean): void {
		this.config.particlesOverMessages = value;
		this.persist();
	}

	toggleParticlesOverMessages(): void {
		this.config.particlesOverMessages = !this.config.particlesOverMessages;
		this.persist();
	}

	clear(): void {
		this.config = { ...DEFAULT_CONFIG };
		this.persist();
	}
}

export const ambientStore = new AmbientStore();
