/**
 * From a parsed marker to the request that reaches ComfyUI.
 *
 * Two things happen here and nowhere else: the locks have their say, and the positive
 * prompt is assembled. Both are pure, so what was actually asked for can be asserted in a
 * test rather than read out of a running server's logs.
 *
 * The locks are the reader overruling the model. The model still writes its tokens — the
 * marker is unchanged and the gallery-facing record keeps both — but a reader who has
 * decided every picture in this story is a 832x1216 portrait should not have to talk the
 * model into agreeing every single turn.
 */

import { MAX_SEED } from './config';
import type {
	ArToken,
	GenerateRequest,
	ImagegenSettings,
	ParsedMarker,
	Resolution,
	SeedToken,
	ShotToken
} from './types';

/** A fresh seed. Kept here rather than inline so every path that needs one agrees about
 *  the range, including the retry button, which deliberately bypasses the seed lock. */
export function randomSeed(): number {
	return Math.floor(Math.random() * MAX_SEED);
}

/** What the marker asked for, after the locks. */
export interface EffectiveSettings {
	ar: ArToken;
	shot: ShotToken;
	resolution: Resolution;
	/** Prepend, shot tags, the model's prompt, append — in that order, comma-joined. */
	positivePrompt: string;
	/** Still a token: `LOCK` needs the story tree, which is not this module's business. */
	seedToken: SeedToken;
}

/**
 * Apply the reader's locks to one marker and build the prompt that goes with it.
 *
 * Order in the positive prompt is load-bearing for the checkpoints this points at: framing
 * tags before subject tags read as camera instructions, and after them they compete with
 * the subject. Prepend is first because it is the reader's style preamble ("masterpiece,
 * best quality"), and append is last because it is their fixed tail (a LoRA trigger, a
 * quality tag) which should not be diluted by whatever the model wrote.
 */
export function resolveEffective(marker: ParsedMarker, settings: ImagegenSettings): EffectiveSettings {
	const ar = settings.resolutionLockEnabled ? null : marker.ar;
	const resolution = settings.resolutionLockEnabled
		? settings.resolutionLock
		: (settings.resolutions[marker.ar] ?? settings.resolutions.SQUARE);

	const shot = settings.shotLockEnabled ? settings.shotLock : marker.shot;
	const shotTag = settings.shotTags[shot] ?? '';

	const positivePrompt = [
		settings.prependPrompt.trim(),
		shotTag.trim(),
		marker.prompt.trim(),
		settings.appendPrompt.trim()
	]
		.filter(Boolean)
		.join(', ');

	return {
		// The AR the picture was actually made at. A locked resolution has no token behind
		// it, so the marker's own is reported: it is what the record is FOR, and the
		// resolution beside it already says what the lock did.
		ar: ar ?? marker.ar,
		shot,
		resolution,
		positivePrompt,
		seedToken: effectiveSeedToken(marker.seed, settings)
	};
}

/**
 * Which seed instruction actually applies.
 *
 * A seed lock replaces the marker's token wholesale, including with `LOCK` itself, which is
 * the setting that makes every picture in a story share one seed without the model having
 * to remember to ask.
 */
export function effectiveSeedToken(markerSeed: SeedToken, settings: ImagegenSettings): SeedToken {
	if (!settings.seedLockEnabled) return markerSeed;
	if (settings.seedLockMode === 'CUSTOM') return settings.seedLockValue;
	return settings.seedLockMode;
}

/**
 * The final request. `seed` arrives already resolved to a number, because `LOCK` means
 * "whatever the last picture on this path used" and only the caller can see the path.
 */
export function buildGenerateRequest(
	effective: EffectiveSettings,
	seed: number,
	settings: ImagegenSettings
): GenerateRequest {
	return {
		host: settings.host,
		workflow: settings.workflow,
		checkpoint: settings.checkpoint,
		positivePrompt: effective.positivePrompt,
		negativePrompt: settings.negativePrompt,
		width: effective.resolution.width,
		height: effective.resolution.height,
		seed,
		steps: settings.steps,
		cfg: settings.cfg,
		sampler: settings.sampler,
		scheduler: settings.scheduler,
		denoise: settings.denoise,
		timeoutSeconds: settings.timeoutSeconds
	};
}
