/**
 * The ambient mix: the model, its ranges and its normalizer.
 *
 * Import-free on purpose (the steering model's rule): a mix is stored in two places, the
 * app-wide setting and a chat's own scene, and the store that reads the first and the chat
 * feature-state normalizer that reads the second have to agree exactly on what a corrupt
 * or missing value degrades to.
 */

/**
 * Every ambient effect, in picker order. THE list: the union, the store's validation
 * set, the labels/descriptions maps and the canvas renderer all derive from it, so
 * shipping a new effect is one entry here plus its renderer (architecture/ui-shell-settings.md
 * coupling #5).
 */
export const AMBIENT_EFFECTS = [
	'rain',
	'snow',
	'storm',
	'fog',
	'sandstorm',
	'aurora',
	'leaves',
	'petals',
	'pollen',
	'smoke',
	'blizzard',
	'underwater',
	'sunshine',
	'starlight',
	'fireflies',
	'ash',
	'wisps',
	'fireplace',
	'lanterns',
	'filmgrain'
] as const;

export type AmbientEffect = (typeof AMBIENT_EFFECTS)[number];

/** An effect, or `clear` (the absence of one). `clear` is deliberately outside
 *  `AmbientEffect`: it has no renderer and never appears in the picker's list. */
export type AmbientType = 'clear' | AmbientEffect;

/** Which side of the message layer an effect paints on. */
export type AmbientPlacement = 'over' | 'under';

export interface AmbientConfig {
	type: AmbientType;
	types: AmbientType[]; // Active ambient effects for multi-toggle mode
	enabled: boolean;
	/** Every knob of every effect: the four AMBIENT_BASE_SETTINGS every effect carries
	 *  plus whatever AMBIENT_EFFECT_SETTINGS gives that one. A key missing here is that
	 *  def's shipped default, so a mix nobody has tuned stores nothing at all. */
	effectSettings: Partial<Record<AmbientType, Record<string, number>>>;
}

export const DEFAULT_AMBIENT_CONFIG: AmbientConfig = {
	type: 'clear',
	types: [],
	enabled: false,
	effectSettings: {}
};

/** Runtime knobs passed into every effect's update/render each frame. */
export interface AmbientParams {
	/** Animation speed multiplier; 1 = designed pace. */
	speed: number;
	/** Alpha scale 0-1; 0.5 = designed look. */
	visibility: number;
	/** Effect-specific settings, defaults already merged in. */
	settings: Record<string, number>;
}

export interface AmbientSettingDef {
	key: string;
	label: string;
	kind: 'slider' | 'toggle';
	min: number;
	max: number;
	step: number;
	defaultValue: number; // toggles use 0/1
}

/**
 * The four knobs EVERY effect carries, ahead of whatever it has of its own.
 *
 * The first three used to be one set of sliders scaling the whole stack at once, and the
 * fourth one switch over all of it. They are per effect because a stack is regularly one
 * effect that wants to be quieter, slower or behind the story while the rest stay where
 * they are, which a single set could only ever move together.
 *
 * They share `AmbientSettingDef` with an effect's own knobs deliberately: the mixer draws
 * one uniform list per row, and the canvas reads the first three out of the same bag it
 * hands the renderer. A per-effect def reusing one of these keys would shadow it, which
 * `contracts.test.ts` refuses.
 */
export const AMBIENT_BASE_SETTINGS: AmbientSettingDef[] = [
	{ key: 'density', label: 'Density', kind: 'slider', min: 0.2, max: 2, step: 0.05, defaultValue: 1 },
	{ key: 'speed', label: 'Speed', kind: 'slider', min: 0.25, max: 2, step: 0.05, defaultValue: 1 },
	{ key: 'visibility', label: 'Visibility', kind: 'slider', min: 0.05, max: 1, step: 0.05, defaultValue: 0.5 },
	{ key: 'overMessages', label: 'Over messages', kind: 'toggle', min: 0, max: 1, step: 1, defaultValue: 1 }
];

/**
 * Effect-specific settings surfaced in the settings UI. Every def here must be
 * consumed by the matching effect's update/render via AmbientParams.settings.
 */
export const AMBIENT_EFFECT_SETTINGS: Partial<Record<AmbientType, AmbientSettingDef[]>> = {
	rain: [
		{ key: 'splashes', label: 'Ground splashes', kind: 'toggle', min: 0, max: 1, step: 1, defaultValue: 1 }
	],
	storm: [
		{ key: 'lightning', label: 'Lightning', kind: 'slider', min: 0, max: 2, step: 0.1, defaultValue: 1 },
		{ key: 'wind', label: 'Wind gusts', kind: 'slider', min: 0, max: 2, step: 0.1, defaultValue: 1 },
		{ key: 'shake', label: 'Screen shake', kind: 'toggle', min: 0, max: 1, step: 1, defaultValue: 1 }
	],
	blizzard: [
		{ key: 'wind', label: 'Wind strength', kind: 'slider', min: 0, max: 2, step: 0.1, defaultValue: 1 }
	],
	sandstorm: [
		{ key: 'haze', label: 'Dust haze', kind: 'slider', min: 0, max: 2, step: 0.1, defaultValue: 1 }
	],
	aurora: [
		{ key: 'shimmer', label: 'Shimmer', kind: 'slider', min: 0, max: 2, step: 0.1, defaultValue: 1 }
	],
	wisps: [
		{ key: 'trails', label: 'Trails', kind: 'toggle', min: 0, max: 1, step: 1, defaultValue: 1 }
	],
	filmgrain: [
		{ key: 'scratches', label: 'Scratches', kind: 'toggle', min: 0, max: 1, step: 1, defaultValue: 1 },
		{ key: 'vignette', label: 'Vignette', kind: 'toggle', min: 0, max: 1, step: 1, defaultValue: 1 }
	],
	sunshine: [
		{ key: 'rays', label: 'God rays', kind: 'slider', min: 0, max: 2, step: 0.1, defaultValue: 1 }
	],
	starlight: [
		{ key: 'meteors', label: 'Meteors', kind: 'slider', min: 0, max: 2, step: 0.1, defaultValue: 1 }
	],
	fireplace: [
		{ key: 'glow', label: 'Warm glow', kind: 'slider', min: 0, max: 2, step: 0.1, defaultValue: 1 }
	]
};

/** Every knob one effect answers to: the shared four, then its own. */
export function settingsFor(type: AmbientType): AmbientSettingDef[] {
	return [...AMBIENT_BASE_SETTINGS, ...(AMBIENT_EFFECT_SETTINGS[type] ?? [])];
}

/** Built once per effect and frozen: the render loop asks for these every frame, and
 *  the defaults are a fact about the defs rather than about any one mix. */
const DEFAULTS_BY_TYPE = new Map<AmbientType, Readonly<Record<string, number>>>();

export function getEffectSettingDefaults(type: AmbientType): Readonly<Record<string, number>> {
	let defaults = DEFAULTS_BY_TYPE.get(type);
	if (!defaults) {
		const built: Record<string, number> = {};
		for (const def of settingsFor(type)) built[def.key] = def.defaultValue;
		defaults = Object.freeze(built);
		DEFAULTS_BY_TYPE.set(type, defaults);
	}
	return defaults;
}

/** What one effect actually plays at. The canvas and the mixer's rows both resolve
 *  through this, so a row cannot state a number the canvas is not using. */
export function effectSetting(config: AmbientConfig, type: AmbientType, key: string): number {
	return config.effectSettings[type]?.[key] ?? getEffectSettingDefaults(type)[key] ?? 0;
}

/**
 * The active effects painting on one side of the message layer, in mix order.
 *
 * Two canvases draw the stack rather than one, and this is what splits it. `Workspace`
 * asks the same question to decide whether a side is worth mounting at all, so with every
 * effect on the same side (the shipped state) there is exactly one canvas, as before.
 */
export function effectsPlaced(config: AmbientConfig, placement: AmbientPlacement): AmbientEffect[] {
	const out: AmbientEffect[] = [];
	for (const type of config.types) {
		if (type === 'clear' || out.includes(type)) continue;
		const over = effectSetting(config, type, 'overMessages') >= 0.5;
		if (over === (placement === 'over')) out.push(type);
	}
	return out;
}

const EFFECT_TYPE_SET = new Set<string>(AMBIENT_EFFECTS);

/** Known effects only, in the order given, deduped. `fallback` covers a blob from before
 *  the mix could hold more than one. */
export function normalizeAmbientTypes(input: unknown, fallback?: unknown): AmbientType[] {
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

function finite(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * What a blob written before the four base knobs were per effect says about them.
 *
 * The three sliders and the over-messages switch used to scale the whole stack, so an
 * upgrade carries them onto every effect that is actually playing: a mix nobody touched
 * again looks exactly as it did. A knob the old blob never held is left out, so it lands
 * on its shipped default rather than on a guess. Effects that are only parked keep
 * whatever they were tuned to and take the defaults for the rest, since the value that
 * was on screen was never theirs.
 */
function legacyBaseSettings(stored: Record<string, unknown>): Record<string, number> {
	const seeded: Record<string, number> = {};
	// Older still: one `intensity` that scaled both alpha and motion.
	const intensity = finite(stored.intensity);
	const density = finite(stored.density);
	const speed = finite(stored.speed) ?? (intensity !== null ? intensity * 2 : null);
	const visibility = finite(stored.visibility) ?? intensity;
	if (density !== null) seeded.density = density;
	if (speed !== null) seeded.speed = speed;
	if (visibility !== null) seeded.visibility = visibility;
	if (typeof stored.particlesOverMessages === 'boolean') {
		seeded.overMessages = stored.particlesOverMessages ? 1 : 0;
	}
	return seeded;
}

/** Keep only known effects and known keys, each clamped to its def's range. */
function normalizeEffectSettings(
	input: unknown,
	seed: Record<string, number>,
	seedTypes: AmbientType[]
): AmbientConfig['effectSettings'] {
	const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
	const normalized: AmbientConfig['effectSettings'] = {};

	for (const type of AMBIENT_EFFECTS) {
		const stored = (raw[type] && typeof raw[type] === 'object' ? raw[type] : {}) as Record<
			string,
			unknown
		>;
		const merged = seedTypes.includes(type) ? { ...seed, ...stored } : stored;
		const entry: Record<string, number> = {};
		for (const def of settingsFor(type)) {
			const value = finite(merged[def.key]);
			if (value === null) continue;
			entry[def.key] = Math.max(def.min, Math.min(def.max, value));
		}
		if (Object.keys(entry).length > 0) normalized[type] = entry;
	}

	return normalized;
}

/** Coerce a raw blob into a valid AmbientConfig. Anything corrupt degrades to the
 *  shipped default rather than throwing (the settings-store convention). */
export function normalizeAmbientConfig(parsed: unknown): AmbientConfig {
	if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_AMBIENT_CONFIG };
	const stored = parsed as Record<string, unknown>;
	const normalizedTypes = normalizeAmbientTypes(stored.types, stored.type);
	const parsedEnabled =
		typeof stored.enabled === 'boolean' ? stored.enabled : normalizedTypes.length > 0;

	return {
		type: normalizedTypes[0] ?? 'clear',
		types: normalizedTypes,
		enabled: normalizedTypes.length > 0 ? parsedEnabled : false,
		effectSettings: normalizeEffectSettings(
			stored.effectSettings,
			legacyBaseSettings(stored),
			normalizedTypes
		)
	};
}

export const AMBIENT_LABELS: Record<AmbientType, string> = {
	clear: 'Clear',
	rain: 'Rain',
	snow: 'Snow',
	storm: 'Storm',
	fog: 'Fog',
	sandstorm: 'Sandstorm',
	aurora: 'Aurora',
	leaves: 'Leaves',
	petals: 'Petals',
	pollen: 'Pollen',
	smoke: 'Smoke',
	blizzard: 'Blizzard',
	underwater: 'Underwater',
	sunshine: 'Sunshine',
	starlight: 'Starlight',
	fireflies: 'Fireflies',
	ash: 'Ashfall',
	wisps: 'Wisps',
	fireplace: 'Fireplace',
	lanterns: 'Lanterns',
	filmgrain: 'Film Grain'
};

export const AMBIENT_DESCRIPTIONS: Record<AmbientType, string> = {
	clear: 'No ambient effects',
	rain: 'Gentle rain falling with subtle splashes',
	snow: 'Soft snowflakes drifting down',
	storm: 'Heavy rain with lightning flashes',
	fog: 'Low rolling mist with drifting haze',
	sandstorm: 'Driven sand and grit under a gusting dust haze',
	aurora: 'Slow curtains of northern light across the sky',
	leaves: 'Autumn leaves swirling through the scene',
	petals: 'Soft blossom petals floating on a breeze',
	pollen: 'Golden forest motes hanging in still air',
	smoke: 'Rising smoke plumes with shifting haze',
	blizzard: 'Violent snow gusts with whiteout pulses',
	underwater: 'Deep blue water with bubbles and drifting plankton',
	sunshine: 'Warm rays with floating dust particles',
	starlight: 'Twinkling night sky with occasional meteors',
	fireflies: 'Glowing fireflies moving through the dark',
	ash: 'Drifting ash and soot with faint ember sparks',
	wisps: 'Pale spirits drifting with fading trails',
	fireplace: 'Glowing embers and warm flickering light',
	lanterns: 'Paper lanterns climbing with warm light',
	filmgrain: 'Old film grain with scratches and a breathing vignette'
};
