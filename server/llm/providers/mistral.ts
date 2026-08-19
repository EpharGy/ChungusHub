/**
 * Mistral AI: OpenAI-compatible chat completions at https://api.mistral.ai/v1.
 * Strict API: it 400s on unknown body fields, so the param allow-list carries
 * only the sampling knobs Mistral documents whose request field name matches the
 * one sampling.ts sends verbatim. Notable omission: seed. Mistral's field is
 * `random_seed`, but sampling.ts sends `seed`, and we can't remap it here, so the
 * seed control stays hidden (see paramPolicy note below).
 * Docs: https://docs.mistral.ai/api (POST /v1/chat/completions, GET /v1/models).
 */
import type { ModelInfo } from '../types';
import type { ProviderProfile } from './types';
import { num } from './util';

/**
 * Map Mistral's /models card onto ModelInfo. The generic pass reads
 * `context_length` / `default_parameters.temperature` / `architecture` (all
 * absent here), so we resolve Mistral's own keys:
 *  - `max_context_length`        → contextLength
 *  - `default_model_temperature` → defaultTemperature
 *  - `capabilities.vision`       → inputModalities (text, plus image when vision)
 * Everything else (id, name, created) is already standard-named upstream.
 */
function normalizeModel(raw: Record<string, unknown>): Partial<ModelInfo> {
	const out: Partial<ModelInfo> = {};

	const ctx = num(raw.max_context_length);
	if (ctx !== undefined) out.contextLength = ctx;

	const defaultTemp = num(raw.default_model_temperature);
	if (defaultTemp !== undefined) out.defaultTemperature = defaultTemp;

	const caps = raw.capabilities as Record<string, unknown> | undefined;
	if (caps) out.inputModalities = caps.vision === true ? ['text', 'image'] : ['text'];

	return out;
}

export const mistral: ProviderProfile = {
	name: 'mistral',
	displayName: 'MistralAI',
	defaultBaseUrl: 'https://api.mistral.ai/v1',
	requiresApiKey: true,
	baseUrlEditable: false,
	// Documented /chat/completions sampling fields whose names match sampling.ts's
	// fixed apiField. Mistral has no top_k/min_p/top_a/repetition_penalty, and its
	// seed field is `random_seed` (≠ our `seed`) so seed is intentionally excluded.
	paramPolicy: ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty'],
	// NO reasoning descriptor on purpose: Magistral's reasoning_effort turns
	// message.content into an ARRAY of thinking/text chunks, which our shared
	// response parser doesn't speak, so offering the control would break parsing.
	// Vision models (capabilities.vision → inputModalities) take image_url as a
	// bare STRING; nesting {url} or adding `detail` 422s on this strict API.
	media: { images: true, gate: 'model', shape: 'string' },
	// Automatic caching keyed on the request prefix (no cache_control; Mistral's own field is
	// `prompt_cache_key`, which we don't drive). Reads report under prompt_tokens_details.cached_tokens.
	caching: { mode: 'auto' },
	normalizeModel
	// No account/balance/usage endpoint and no service_tier in the Mistral API.
};
