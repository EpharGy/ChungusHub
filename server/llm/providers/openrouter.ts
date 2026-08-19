/**
 * OpenRouter: the reference provider. Its /models self-reports per-model
 * `supported_parameters`, pricing, modalities and moderation, so it runs on the
 * 'reported' param policy and drives the sampling UI live. It also uniquely
 * exposes per-model provider routing, a key/account snapshot and a model
 * endpoints listing; those live here as hooks rather than in the shared class.
 */
import type { ModelEndpoint, ProviderAccount } from '../types';
import type { ProviderProfile, ProviderRuntime } from './types';
import { jsonObject, num } from './util';

function normalizeEndpoint(e: Record<string, unknown>): ModelEndpoint {
	const providerName = typeof e.provider_name === 'string' ? e.provider_name : String(e.name ?? 'Unknown');
	const tag = typeof e.tag === 'string' && e.tag ? e.tag : providerName.toLowerCase().replace(/\s+/g, '');
	const pricing = e.pricing as Record<string, unknown> | undefined;
	const ep: ModelEndpoint = { providerName, tag };
	const ctx = num(e.context_length);
	if (ctx !== undefined) ep.contextLength = ctx;
	const maxOut = num(e.max_completion_tokens);
	if (maxOut !== undefined) ep.maxCompletionTokens = maxOut;
	if (typeof e.quantization === 'string') ep.quantization = e.quantization;
	if (pricing) {
		const prompt = num(pricing.prompt);
		const completion = num(pricing.completion);
		if (prompt !== undefined || completion !== undefined) ep.pricing = { prompt, completion };
	}
	if (Array.isArray(e.supported_parameters)) ep.supportedParameters = e.supported_parameters as string[];
	const uptime = num(e.uptime_last_30m) ?? num(e.uptime_last_1d);
	if (uptime !== undefined) ep.uptime = uptime;
	const status = num(e.status);
	if (status !== undefined) ep.status = status;
	const latP50 = num((e.latency_last_30m as Record<string, unknown> | undefined)?.p50);
	if (latP50 !== undefined) ep.latencyP50 = latP50;
	const tpP50 = num((e.throughput_last_30m as Record<string, unknown> | undefined)?.p50);
	if (tpP50 !== undefined) ep.throughputP50 = tpP50;
	return ep;
}

/**
 * Fetch the provider endpoints that serve a given model. Returns [] for ids that
 * aren't `author/slug` shaped. The model variant suffix (e.g. `:free`) is
 * stripped, because the endpoints API keys off the base slug.
 */
async function fetchModelEndpoints(rt: ProviderRuntime, model: string): Promise<ModelEndpoint[]> {
	const base = model.split(':')[0];
	const slash = base.indexOf('/');
	if (slash === -1) return [];
	const author = base.slice(0, slash);
	const slug = base.slice(slash + 1);
	const res = await rt.request(`/models/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/endpoints`);
	if (!res.ok) throw new Error(await rt.extractError(res));
	const data = await jsonObject(res);
	const endpoints = (data?.data as Record<string, unknown> | undefined)?.endpoints;
	if (!Array.isArray(endpoints)) return [];
	return endpoints.map((e: Record<string, unknown>) => normalizeEndpoint(e));
}

/**
 * Account snapshot for the configured key. One GET /key gives spend cap,
 * remaining balance, free-tier status and expiry in a single round trip;
 * /credits is best-effort (needs a management key and 403s for inference keys,
 * so we swallow that and leave the whole-account balance null).
 */
async function fetchAccount(rt: ProviderRuntime): Promise<ProviderAccount> {
	const res = await rt.request('/key');
	if (!res.ok) throw new Error(await rt.extractError(res));
	const data = (await jsonObject(res)).data as Record<string, unknown> | undefined;
	if (!data) throw new Error('OpenRouter returned an unexpected /key response');

	const account: ProviderAccount = {
		label: typeof data.label === 'string' ? data.label : null,
		limit: num(data.limit) ?? null,
		limitRemaining: num(data.limit_remaining) ?? null,
		limitReset: typeof data.limit_reset === 'string' ? data.limit_reset : null,
		usage: num(data.usage) ?? 0,
		usageDaily: num(data.usage_daily) ?? 0,
		usageWeekly: num(data.usage_weekly) ?? 0,
		usageMonthly: num(data.usage_monthly) ?? 0,
		isFreeTier: data.is_free_tier === true,
		isManagementKey: data.is_management_key === true || data.is_provisioning_key === true,
		expiresAt: typeof data.expires_at === 'string' ? data.expires_at : null,
		balance: null
	};

	try {
		const cr = await rt.request('/credits');
		if (cr.ok) {
			const cd = (await jsonObject(cr)).data as Record<string, unknown> | undefined;
			const total = num(cd?.total_credits);
			const used = num(cd?.total_usage);
			if (total !== undefined && used !== undefined) account.balance = total - used;
		}
	} catch {
		/* best-effort enrichment only */
	}
	return account;
}

export const openrouter: ProviderProfile = {
	name: 'openrouter',
	displayName: 'OpenRouter',
	defaultBaseUrl: 'https://openrouter.ai/api/v1',
	requiresApiKey: true,
	baseUrlEditable: false,
	extraHeaders: { 'HTTP-Referer': 'https://chungushub.app', 'X-Title': 'ChungusHub' },
	paramPolicy: 'reported',
	routing: true,
	serviceTier: true,
	// Unified `reasoning` object: effort enum (auto-translated to token budgets for
	// budget-style models like Anthropic), `exclude` hides reasoning without disabling
	// it. Gated per model on the reported `reasoning` supported_parameter.
	reasoning: {
		efforts: { off: 'none', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', max: 'max' },
		effortField: 'reasoning-object',
		exclude: true,
		gate: 'model'
	},
	// Multimodal content parts are forwarded per model; `detail` is documented and honoured.
	media: { images: true, gate: 'model', detail: true },
	// `verbosity` appears in supported_parameters for models that honour it (GPT-5, Claude).
	verbosity: 'reported',
	// Explicit caching: OpenRouter forwards `cache_control` breakpoints to upstreams that
	// cache explicitly (Anthropic, Gemini, Qwen) and ignores them for the rest, so marking
	// is safe across models. 1h TTL is honoured for Anthropic upstreams (ignored elsewhere).
	caching: { mode: 'explicit', ttl: true },
	fetchModelEndpoints,
	fetchAccount
};
