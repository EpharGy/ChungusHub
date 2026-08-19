import type { ProviderProfile } from './types';

/**
 * Bring-your-own OpenAI-compatible endpoint (LM Studio, llama.cpp, vLLM, …).
 * The user supplies the base URL, so nothing here can know its param support:
 * these stacks serve exactly the RP knobs (min_p, top_k, repetition_penalty)
 * that a strict base-only policy hides, and their /models never reports
 * `supported_parameters`, so 'reported' would degrade to base-only too.
 *
 * 'declared' is the honest answer to that: we don't claim, we ask. Each
 * connection carries its owner's own allow-list (`Connection.samplingParams`),
 * and "visible === sent" holds against it exactly as it does against a static
 * allow-list. An empty declaration behaves as base-only, so a connection that
 * has never been told anything sends nothing beyond the universal knobs.
 */
export const openaiCompatible: ProviderProfile = {
	name: 'openai-compatible',
	displayName: 'OpenAI Compatible',
	defaultBaseUrl: '',
	requiresApiKey: false,
	baseUrlEditable: true,
	paramPolicy: 'declared',
	// Image parts are part of the standard surface most local stacks implement
	// (vLLM, LM Studio); an endpoint that doesn't will reject them loudly.
	// Reasoning/verbosity stay off: no way to know what a BYO endpoint accepts.
	media: { images: true }
};
