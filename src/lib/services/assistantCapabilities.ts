/**
 * The assistant's capability catalog, fetched rather than duplicated.
 *
 * The capability families, what each costs the prompt, and the named presets all live in
 * exactly one place: `server/assistant/registry/groups.ts`, beside the tools they partition. The
 * page below reads that catalog over `/api/assistant-capabilities`; only the user's CHOICE
 * is client-owned, and it is an ordinary settings row (`assistantCapabilities`) so it syncs
 * across devices and reaches the server through the same table every other setting uses.
 */
import { apiGet } from '$lib/services/transport';

export interface CapabilityGroupInfo {
	id: string;
	label: string;
	describe: string;
	tools: string[];
	/** Core: the assistant's ability to look at anything. Never switchable. */
	alwaysOn: boolean;
	/** Still rough at the edges: badged on the page, in no preset, off by default. */
	experimental: boolean;
	/** Estimated tokens this family's tool schemas add to every request. */
	tokens: number;
}

export interface CapabilityPresetInfo {
	id: string;
	label: string;
	describe: string;
	groups: string[];
}

export interface CapabilityCatalog {
	groups: CapabilityGroupInfo[];
	presets: CapabilityPresetInfo[];
	/** What a workspace that has never chosen runs. */
	defaults: string[];
}

/** Settings row holding the enabled group ids, as a JSON array. */
export const CAPABILITIES_SETTING = 'assistantCapabilities';

export async function fetchCapabilityCatalog(): Promise<CapabilityCatalog> {
	return (await apiGet('/api/assistant-capabilities')) as CapabilityCatalog;
}

/** The stored choice, or the shipped default when nothing is stored / the cell is junk.
 *  Mirrors the server's `liveCapabilityGroups`, which is the one that actually gates. */
export function parseEnabledGroups(raw: string | null, catalog: CapabilityCatalog): string[] {
	const known = new Set(catalog.groups.map((g) => g.id));
	const alwaysOn = catalog.groups.filter((g) => g.alwaysOn).map((g) => g.id);
	let chosen = catalog.defaults;
	if (raw) {
		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) chosen = parsed.filter((v): v is string => typeof v === 'string');
		} catch {
			/* a corrupt cell falls back to the default, exactly as the server does */
		}
	}
	const out = new Set([...alwaysOn, ...chosen.filter((id) => known.has(id))]);
	return catalog.groups.filter((g) => out.has(g.id)).map((g) => g.id);
}

/** Which preset this set IS, or null for a hand-made combination. Derived rather than
 *  stored: a stored preset name and a stored set can disagree, and then one of them lies. */
export function presetFor(enabled: readonly string[], catalog: CapabilityCatalog): string | null {
	const key = [...enabled].sort().join(',');
	return catalog.presets.find((p) => [...p.groups].sort().join(',') === key)?.id ?? null;
}
