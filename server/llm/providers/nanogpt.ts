/**
 * NanoGPT: an OpenAI-compatible aggregator at https://nano-gpt.com/api/v1.
 * Its /chat/completions forwards a wide sampling vocabulary, but /models does NOT
 * self-report per-model `supported_parameters` (the plain list is bare
 * {id, object, created, owned_by}; the richer fields only surface via a
 * `?detailed=true` query the shared client never sends), so we can't run the
 * 'reported' policy. Instead we carry a static allow-list of the sampling knobs
 * NanoGPT documents whose request field name matches what sampling.ts sends
 * verbatim. Because plain /models is bare, no normalizeModel hook is needed (the
 * generic pass already reads id + created). It exposes a balance endpoint that
 * auto-enables the connection ledger.
 * Docs: https://docs.nano-gpt.com/api-reference/endpoint/chat-completion
 *       https://docs.nano-gpt.com/api-reference/endpoint/models
 *       https://docs.nano-gpt.com/api-reference/endpoint/check-balance
 */
import type { ProviderAccount } from '../types';
import type { ProviderProfile, ProviderRuntime } from './types';
import { num } from './util';

/**
 * POST /api/check-balance → { usd_balance, nano_balance, nanoDepositAddress },
 * all numeric STRINGs (num() parses them). Note the endpoint lives at /api/... ,
 * one level ABOVE the /api/v1 baseUrl, so we climb out with a `../` segment:
 * `${baseUrl}/../check-balance` = `https://nano-gpt.com/api/v1/../check-balance`,
 * which the URL parser collapses to `https://nano-gpt.com/api/check-balance`.
 * Auth rides the shared `Authorization: Bearer <key>` header (NanoGPT accepts it
 * interchangeably with x-api-key); if it ever rejects Bearer here this throws
 * rather than reporting a phantom balance.
 */
async function fetchAccount(rt: ProviderRuntime): Promise<ProviderAccount> {
	const res = await rt.request('/../check-balance', { method: 'POST' });
	if (!res.ok) throw new Error(await rt.extractError(res));
	const data = (await res.json()) as Record<string, unknown> | undefined;
	if (!data || data.usd_balance === undefined) throw new Error('NanoGPT returned an unexpected /check-balance response');

	return {
		label: null,
		limit: null,
		limitRemaining: null,
		limitReset: null,
		usage: 0,
		usageDaily: 0,
		usageWeekly: 0,
		usageMonthly: 0,
		isFreeTier: false,
		isManagementKey: false,
		expiresAt: null,
		balance: num(data.usd_balance) ?? null
	};
}

export const nanogpt: ProviderProfile = {
	name: 'nanogpt',
	displayName: 'NanoGPT',
	defaultBaseUrl: 'https://nano-gpt.com/api/v1',
	requiresApiKey: true,
	baseUrlEditable: false,
	// Documented /chat/completions sampling fields whose names match sampling.ts's
	// fixed apiField (max_tokens is universal, so it's implicit and not listed).
	// max_completion_tokens is intentionally excluded: NanoGPT documents max_tokens.
	paramPolicy: ['temperature', 'top_p', 'top_k', 'min_p', 'top_a', 'repetition_penalty', 'frequency_penalty', 'presence_penalty', 'seed'],
	// `reasoning_effort` (none→xhigh) plus `reasoning: {exclude: true}` to hide
	// reasoning output; both documented in the Extended Thinking reference.
	reasoning: {
		efforts: { off: 'none', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', max: 'xhigh' },
		exclude: true
	},
	// image_url parts (base64 png/jpeg/webp) are forwarded, with a documented
	// `detail` field. Plain /models is bare, so no per-model gate.
	media: { images: true, detail: true },
	// Treated as automatic: OpenAI/Gemini routes cache automatically and reads are
	// reported. (Claude routes accept explicit cache_control, but that's per-model,
	// so it is kept out of the explicit path until it can be gated safely.)
	caching: { mode: 'auto' },
	fetchAccount
	// No service_tier honoured at the account level; no model-endpoints listing.
};
