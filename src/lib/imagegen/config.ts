/**
 * Image-generation defaults and the guard rails around them.
 *
 * The shipped numbers are SD1.5-shaped (512px), because that is the smallest thing anyone
 * runs and a too-small picture is a disappointment while a too-large one on a small model
 * is a mess of duplicated limbs. An SDXL reader raises the resolutions once, in Settings,
 * and every marker follows.
 *
 * The shot tags are Danbooru vocabulary on purpose: that is what the illustration
 * checkpoints people actually point this at were trained on, and a reader whose model
 * speaks something else edits the table rather than the code.
 */

import {
	AR_TOKENS,
	SHOT_TOKENS,
	type ArToken,
	type ImagegenSettings,
	type Resolution,
	type ShotToken
} from './types';

export const DEFAULT_IMAGEGEN_SETTINGS: ImagegenSettings = {
	enabled: false,
	autoGenerate: true,
	host: 'http://127.0.0.1:8188',
	checkpoint: '',
	workflow: 'default.json',
	negativePrompt: 'worst quality, low quality, blurry, deformed, ugly, extra limbs',
	prependPrompt: '',
	appendPrompt: '',
	steps: 24,
	cfg: 7,
	sampler: 'euler',
	scheduler: 'normal',
	denoise: 1,
	timeoutSeconds: 180,
	cacheLimitMb: 0,
	cacheAutoSweep: true,
	resolutions: {
		PORTRAIT: { width: 512, height: 768 },
		SQUARE: { width: 512, height: 512 },
		LANDSCAPE: { width: 768, height: 512 },
		CINEMA: { width: 768, height: 432 }
	},
	resolutionLockEnabled: false,
	resolutionLock: { width: 512, height: 768 },
	shotLockEnabled: false,
	shotLock: 'MEDIUM',
	seedLockEnabled: false,
	seedLockMode: 'RANDOM',
	seedLockValue: 0,
	shotTags: {
		CLOSE: 'close-up, face focus',
		MEDIUM: 'upper body',
		WIDE: 'full body',
		DUTCH: 'dutch angle',
		OVERHEAD: "from above, bird's eye view",
		LOWANGLE: 'from below',
		HIGHANGLE: 'from above',
		PROFILE: 'profile, from side',
		BACKVIEW: 'from behind',
		POV: 'pov'
	}
};

/**
 * The engine ships **off**, like Sprites and for the same reason: it spends real time and
 * real VRAM on something other than the story's own continuity, so it is a cost a reader
 * opts into rather than discovers.
 */

/** The largest seed value used anywhere here. ComfyUI accepts the full 64-bit range; this
 *  is the part of it that survives a round trip through JSON and a double. */
export const MAX_SEED = 1125899906842624;

const NUMERIC_BOUNDS: Record<string, { min: number; max: number }> = {
	steps: { min: 1, max: 150 },
	cfg: { min: 0, max: 30 },
	denoise: { min: 0, max: 1 },
	timeoutSeconds: { min: 10, max: 1800 },
	// 0 is a real value here and means "no budget", so the floor cannot be raised to a
	// smallest-useful number the way the others are. The ceiling is a typo guard rather
	// than a policy: a reader who types their disk size gets their disk size.
	cacheLimitMb: { min: 0, max: 4194304 }
};

/** Dimensions are clamped to what a diffusion model can actually take, and rounded to the
 *  multiple of 8 every latent stage needs. A stray 513 is a hard error deep in ComfyUI. */
const DIMENSION = { min: 64, max: 4096 };

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	const n = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

function clampDimension(value: unknown, fallback: number): number {
	const n = clampNumber(value, DIMENSION.min, DIMENSION.max, fallback);
	return Math.round(n / 8) * 8;
}

function resolveResolution(value: unknown, fallback: Resolution): Resolution {
	const raw = (value ?? {}) as Partial<Resolution>;
	return {
		width: clampDimension(raw.width, fallback.width),
		height: clampDimension(raw.height, fallback.height)
	};
}

/**
 * Merge stored settings onto the defaults, clamping every field.
 *
 * Written as a whitelist rather than a spread: the stored blob is JSON that an older build
 * wrote (or that a reader edited by hand), so a field can be missing, be the wrong type, or
 * be a key nothing reads any more. Naming each field is what keeps a bad value from
 * reaching a workflow, where it surfaces as an inscrutable ComfyUI error rather than as a
 * setting that looks wrong.
 */
export function resolveImagegenSettings(stored?: Partial<ImagegenSettings> | null): ImagegenSettings {
	const d = DEFAULT_IMAGEGEN_SETTINGS;
	const s = stored ?? {};

	const resolutions = {} as Record<ArToken, Resolution>;
	for (const token of AR_TOKENS) {
		resolutions[token] = resolveResolution(s.resolutions?.[token], d.resolutions[token]);
	}

	const shotTags = {} as Record<ShotToken, string>;
	for (const token of SHOT_TOKENS) {
		const tag = s.shotTags?.[token];
		shotTags[token] = typeof tag === 'string' ? tag : d.shotTags[token];
	}

	return {
		enabled: typeof s.enabled === 'boolean' ? s.enabled : d.enabled,
		autoGenerate: typeof s.autoGenerate === 'boolean' ? s.autoGenerate : d.autoGenerate,
		host: typeof s.host === 'string' && s.host.trim() ? s.host.trim().replace(/\/+$/, '') : d.host,
		checkpoint: typeof s.checkpoint === 'string' ? s.checkpoint : d.checkpoint,
		workflow: typeof s.workflow === 'string' && s.workflow.trim() ? s.workflow.trim() : d.workflow,
		negativePrompt: typeof s.negativePrompt === 'string' ? s.negativePrompt : d.negativePrompt,
		prependPrompt: typeof s.prependPrompt === 'string' ? s.prependPrompt : d.prependPrompt,
		appendPrompt: typeof s.appendPrompt === 'string' ? s.appendPrompt : d.appendPrompt,
		steps: Math.round(clampNumber(s.steps, NUMERIC_BOUNDS.steps.min, NUMERIC_BOUNDS.steps.max, d.steps)),
		cfg: clampNumber(s.cfg, NUMERIC_BOUNDS.cfg.min, NUMERIC_BOUNDS.cfg.max, d.cfg),
		sampler: typeof s.sampler === 'string' && s.sampler.trim() ? s.sampler.trim() : d.sampler,
		scheduler: typeof s.scheduler === 'string' && s.scheduler.trim() ? s.scheduler.trim() : d.scheduler,
		denoise: clampNumber(s.denoise, NUMERIC_BOUNDS.denoise.min, NUMERIC_BOUNDS.denoise.max, d.denoise),
		timeoutSeconds: Math.round(
			clampNumber(
				s.timeoutSeconds,
				NUMERIC_BOUNDS.timeoutSeconds.min,
				NUMERIC_BOUNDS.timeoutSeconds.max,
				d.timeoutSeconds
			)
		),
		cacheLimitMb: Math.round(
			clampNumber(s.cacheLimitMb, NUMERIC_BOUNDS.cacheLimitMb.min, NUMERIC_BOUNDS.cacheLimitMb.max, d.cacheLimitMb)
		),
		cacheAutoSweep: typeof s.cacheAutoSweep === 'boolean' ? s.cacheAutoSweep : d.cacheAutoSweep,
		resolutions,
		resolutionLockEnabled:
			typeof s.resolutionLockEnabled === 'boolean' ? s.resolutionLockEnabled : d.resolutionLockEnabled,
		resolutionLock: resolveResolution(s.resolutionLock, d.resolutionLock),
		shotLockEnabled: typeof s.shotLockEnabled === 'boolean' ? s.shotLockEnabled : d.shotLockEnabled,
		shotLock: SHOT_TOKENS.includes(s.shotLock as ShotToken) ? (s.shotLock as ShotToken) : d.shotLock,
		seedLockEnabled: typeof s.seedLockEnabled === 'boolean' ? s.seedLockEnabled : d.seedLockEnabled,
		seedLockMode:
			s.seedLockMode === 'RANDOM' || s.seedLockMode === 'LOCK' || s.seedLockMode === 'CUSTOM'
				? s.seedLockMode
				: d.seedLockMode,
		seedLockValue: Math.round(clampNumber(s.seedLockValue, 0, MAX_SEED, d.seedLockValue)),
		shotTags
	};
}
