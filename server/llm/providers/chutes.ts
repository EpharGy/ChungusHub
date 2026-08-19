/**
 * Chutes: an OpenAI-compatible network of open models (vLLM/sglang-backed) at
 * llm.chutes.ai/v1. Like OpenRouter, its public /models reports each model's
 * accepted sampling knobs, so it runs on the 'reported' policy, but under a
 * non-standard key (`supported_sampling_parameters`), which we map here.
 *
 * Other field quirks the generic pass misses: modalities and reasoning are
 * advertised in different places, and `pricing` is quoted in USD per MILLION
 * tokens while the app works in USD per token, so we rescale it.
 *
 * No account hook: usage/quota live on api.chutes.ai (users/me, /quotas,
 * /subscription_usage), a different host than the inference baseUrl the runtime
 * is wired to and unreachable from here, so we omit it rather than fake a balance.
 */
import type { ModelInfo } from '../types';
import type { ProviderProfile } from './types';
import { num } from './util';

/** Chutes quotes pricing in USD per million tokens; the app works in USD per token. */
const PER_MILLION = 1_000_000;

function normalizeModel(raw: Record<string, unknown>): Partial<ModelInfo> {
	const out: Partial<ModelInfo> = {};

	// Per-model sampling allow-list under a non-standard key. Chutes accepts
	// `max_tokens` universally (it's just not a *sampling* param), so add it back
	// or the 'reported' policy would never send an output-length cap.
	if (Array.isArray(raw.supported_sampling_parameters)) {
		out.supportedParameters = [...(raw.supported_sampling_parameters as string[]), 'max_tokens'];
	}

	// Modalities are top-level here (the generic pass looks under `architecture`).
	if (Array.isArray(raw.input_modalities)) out.inputModalities = raw.input_modalities as string[];

	const maxOut = num(raw.max_output_length);
	if (maxOut !== undefined) out.maxCompletionTokens = maxOut;

	// Reasoning is advertised in `supported_features`, not a `reasoning` object.
	if (Array.isArray(raw.supported_features) && (raw.supported_features as string[]).includes('reasoning')) {
		out.isReasoning = true;
	}

	// Rescale USD/M-token pricing to the app's USD/token convention.
	const pricing = raw.pricing as Record<string, unknown> | undefined;
	if (pricing) {
		const prompt = num(pricing.prompt);
		const completion = num(pricing.completion);
		if (prompt !== undefined || completion !== undefined) {
			out.pricing = {
				prompt: prompt !== undefined ? prompt / PER_MILLION : undefined,
				completion: completion !== undefined ? completion / PER_MILLION : undefined
			};
		}
	}

	return out;
}

export const chutes: ProviderProfile = {
	name: 'chutes',
	displayName: 'Chutes',
	defaultBaseUrl: 'https://llm.chutes.ai/v1',
	requiresApiKey: true,
	baseUrlEditable: false,
	paramPolicy: 'reported',
	// vLLM/SGLang-backed: `reasoning_effort` (low/medium/high, none disables) is
	// forwarded to the engine; gated per model on supported_features "reasoning".
	// Reasoning comes back in the `reasoning` delta field with no visibility toggle.
	reasoning: {
		efforts: { off: 'none', low: 'low', medium: 'medium', high: 'high' },
		gate: 'model'
	},
	// Vision models advertise input_modalities; vLLM rejects image_url.detail with
	// a 422 ("Extra inputs are not permitted"), so it stays off.
	media: { images: true, gate: 'model' },
	// Automatic input caching, on by default across the catalog; no field, no opt-out.
	// vLLM rejects unexpected content fields, so cache_control must not be sent here.
	caching: { mode: 'auto' },
	normalizeModel
};
