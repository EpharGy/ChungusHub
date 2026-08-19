/** Shared helpers for provider profiles and the generic OpenAI-compatible class. */

/**
 * A response body as an inspectable bag of unknown fields. `Response.json()` is typed
 * `Promise<{}>`, which has no properties at all. Every account/model reader then had to
 * cast at the point of use. Parse once, here, and let the callers keep narrowing values
 * the way they already do.
 */
export async function jsonObject(res: Response): Promise<Record<string, unknown>> {
	const body = (await res.json()) as unknown;
	return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

/** Coerce a value (number or numeric string) to a finite number, else undefined. */
export function num(v: unknown): number | undefined {
	if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
	if (typeof v === 'string' && v.trim() !== '') {
		const n = Number(v);
		return Number.isFinite(n) ? n : undefined;
	}
	return undefined;
}
