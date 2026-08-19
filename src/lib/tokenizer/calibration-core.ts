/**
 * Pure calibration math, split out from the reactive store so it can be unit-tested without
 * Svelte runes or the database. The store ({@link ./calibration.svelte}) is just persistence
 * and reactivity around these functions.
 */

export const EMA_ALPHA = 0.25; // weight of each new sample in the rolling factor
export const MIN_ESTIMATE = 200; // ignore tiny prompts, where fixed framing overhead dwarfs the text
export const RATIO_MIN = 0.5; // clamp so one freak sample can't wreck the factor
export const RATIO_MAX = 2.5;

/** Clamp a raw actual/estimate ratio into the trusted band. */
export function clampRatio(raw: number): number {
	return Math.min(RATIO_MAX, Math.max(RATIO_MIN, raw));
}

/** The clamped ratio for one (estimate, actual) sample, or null when it can't be trusted. */
export function sampleRatio(estimate: number, actual: number): number | null {
	if (estimate < MIN_ESTIMATE || actual <= 0) return null;
	const raw = actual / estimate;
	if (!Number.isFinite(raw)) return null;
	return clampRatio(raw);
}

/** Fold a new sample ratio into the rolling EMA; the first sample seeds the factor directly. */
export function blendRatio(prev: number | undefined, sample: number): number {
	return prev === undefined ? sample : prev + EMA_ALPHA * (sample - prev);
}
