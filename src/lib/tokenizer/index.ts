/**
 * Token accounting: the single entry point for every token number in the app.
 *
 *   countTokens / countMessages: model-aware BASE estimate (right encoding per model).
 *   tokenCalibration.ratioFor:   the model's learned correction; meters multiply by it for
 *                                the "predicted real" prompt size.
 *   tokenCalibration.record:     fed once per real generation to keep the factor honest.
 *
 * Internals: ./encodings (family resolver), ./count (pure counting),
 * ./calibration.svelte (factor).
 */

export { countTokens, countMessages } from './count';
export { tokenCalibration } from './calibration.svelte';
