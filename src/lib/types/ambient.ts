// Ambient effect type definitions

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

export interface AmbientConfig {
	type: AmbientType;
	types: AmbientType[]; // Active ambient effects for multi-toggle mode
	density: number; // 0.2-2, particle amount multiplier (1 = designed look)
	speed: number; // 0.25-2, animation speed multiplier (1 = designed look)
	visibility: number; // 0.05-1, overlay opacity (0.5 = designed look)
	enabled: boolean;
	particlesOverMessages: boolean; // Whether particles show on top of message bubbles
	// Per-effect overrides for the sliders/toggles in AMBIENT_EFFECT_SETTINGS.
	effectSettings: Partial<Record<AmbientType, Record<string, number>>>;
}

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

export function getEffectSettingDefaults(type: AmbientType): Record<string, number> {
	const defs = AMBIENT_EFFECT_SETTINGS[type];
	if (!defs) return {};
	const defaults: Record<string, number> = {};
	for (const def of defs) defaults[def.key] = def.defaultValue;
	return defaults;
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
