/**
 * Z.AI (GLM): OpenAI-compatible surface at https://api.z.ai/api/paas/v4.
 * The chat/completions API documents only temperature, top_p and max_tokens
 * from our sampling vocabulary (plus a `do_sample` flag and thinking/
 * reasoning_effort controls that aren't part of the sampling registry), so it
 * runs on a static allow-list rather than 'reported': GLM's /models (if
 * served) does not self-report `supported_parameters`.
 *
 * Quirks (documented, not enforced here, since the sliders are shared/static):
 *  - temperature is capped at [0.0, 1.0] (our slider goes to 2; values >1 error);
 *  - top_p is [0.01, 1.0];
 *  - max_tokens is [1, 131072]; there is no max_completion_tokens field.
 *
 * No balance/usage endpoint and no service_tier are documented, so neither
 * fetchAccount nor serviceTier is wired. A paas/v4 /models list is not in the
 * API reference; the generic normalization handles it if the surface serves the
 * standard OpenAI shape, and surfaces the failure loudly if it doesn't.
 */
import type { ProviderProfile } from './types';

export const zai: ProviderProfile = {
	name: 'zai',
	displayName: 'Z.AI (GLM)',
	defaultBaseUrl: 'https://api.z.ai/api/paas/v4',
	requiresApiKey: true,
	baseUrlEditable: false,
	// Only the params GLM's chat/completions documents whose request field name
	// matches our fixed apiField. do_sample is out of vocabulary (ignored);
	// top_k/min_p/top_a/penalties/seed are undocumented for GLM (omitted).
	paramPolicy: ['temperature', 'top_p', 'max_tokens'],
	// `thinking: {type: "disabled"}` switches reasoning off (GLM-4.5+);
	// `reasoning_effort` (minimal→max) is GLM-5.2+ only. Older models reject it
	// with error 1214, loudly. Reasoning text returns as reasoning_content with no
	// separate visibility control.
	reasoning: {
		efforts: { minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', max: 'max' },
		offViaThinking: true
	},
	// GLM vision models (glm-4.5v/4.6v/5v) take image_url parts (URL/base64, ≤5MB);
	// no /models listing exists to gate per model, and `detail` is rejected (1214).
	media: { images: true },
	// Implicit automatic caching across GLM models; no field, no opt-out.
	// Reads report under usage.prompt_tokens_details.cached_tokens.
	caching: { mode: 'auto' }
};
