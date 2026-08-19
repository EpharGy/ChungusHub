/**
 * Display formatting for model/endpoint metadata. Pricing from the LLM APIs is
 * USD per token; we render it per million tokens, which is how people reason
 * about LLM cost.
 */

/** USD/token → "$3.00/M" (or "Free" for zero, null when unknown). */
export function formatPricePerMillion(perToken?: number): string | null {
	if (perToken == null) return null;
	if (perToken === 0) return 'Free';
	const perMillion = perToken * 1_000_000;
	const digits = perMillion < 1 ? 3 : perMillion < 100 ? 2 : 0;
	return `$${perMillion.toFixed(digits)}/M`;
}

/** Token count → "8K" / "200K" / "1M". */
export function formatContext(tokens?: number): string | null {
	if (tokens == null || tokens <= 0) return null;
	if (tokens >= 1_000_000) {
		const m = tokens / 1_000_000;
		return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
	}
	if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
	return String(tokens);
}

/** USD amount → "$74.50" (more digits for sub-cent values; "N/A" when unknown). */
export function formatUsd(amount?: number | null): string {
	if (amount == null || !Number.isFinite(amount)) return 'N/A';
	const abs = Math.abs(amount);
	const digits = abs > 0 && abs < 1 ? (abs < 0.01 ? 4 : 2) : 2;
	return `$${amount.toFixed(digits)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Knowledge-cutoff / date string "2024-04" or ISO → "Apr 2024" (raw when unparseable). */
export function formatMonthYear(value?: string): string | null {
	if (!value) return null;
	const m = /^(\d{4})-(\d{2})/.exec(value);
	if (!m) return value;
	const month = MONTHS[parseInt(m[2], 10) - 1];
	return month ? `${month} ${m[1]}` : value;
}

/** The leading namespace of an id like "anthropic/claude-3.5" → "anthropic". */
export function modelVendor(id: string): string {
	const slash = id.indexOf('/');
	return slash === -1 ? 'Other' : id.slice(0, slash);
}

/** Pretty vendor label for grouping headers. */
export function vendorLabel(vendor: string): string {
	const known: Record<string, string> = {
		openai: 'OpenAI',
		anthropic: 'Anthropic',
		google: 'Google',
		'meta-llama': 'Meta Llama',
		mistralai: 'Mistral',
		deepseek: 'DeepSeek',
		'x-ai': 'xAI',
		qwen: 'Qwen',
		cohere: 'Cohere',
		nousresearch: 'Nous Research',
		microsoft: 'Microsoft',
		perplexity: 'Perplexity',
		moonshotai: 'Moonshot',
		'z-ai': 'Z.AI'
	};
	return known[vendor] ?? vendor.charAt(0).toUpperCase() + vendor.slice(1);
}
