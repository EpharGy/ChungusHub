/**
 * The Assistant settings a session runs under, FROZEN at its first turn.
 *
 * Instructions, the skill index, and the enabled capability groups all shape the system
 * prompt and the tool list, the two things that sit at the very front of every request
 * and carry the prompt cache's breakpoint (architecture/llm-providers.md). Read live, a single
 * settings edit mid-session re-prices the entire conversation from scratch. So a session
 * takes one snapshot on its first turn and keeps using it; the user re-syncs a session
 * deliberately with "Apply settings" in the panel, paying that cost once, on purpose.
 *
 * The one asymmetry: switching a capability group OFF is honored immediately (loop.ts
 * intersects the snapshot with the live setting), because making a user wait to withdraw
 * something is the wrong default. Switching one ON waits for an apply: the tool list is
 * frozen, so those tools genuinely are not there.
 */
import { serverDb } from '../db';
import { describeSkillIndex } from './registry/skills';
import { DEFAULT_ENABLED_GROUPS, normalizeGroups } from './registry/groups';

/** Settings key holding the enabled capability groups, as a JSON array of group ids. */
const CAPABILITIES_KEY = 'assistantCapabilities';

export interface AssistantSessionSettings {
	/** The user's standing instructions (settings key `assistantCustomInstructions`). */
	instructions: string;
	/** The rendered one-line-per-skill prompt index. The bodies stay live on purpose,
	 *  so a skill written mid-session is still readable, just not advertised. */
	skillIndex: string;
	/** Capability group ids whose tools were in this session's tool list, in table order. */
	groups: string[];
}

/**
 * The capability groups enabled RIGHT NOW. Unset (a workspace that has never touched the
 * page) means the shipped default; anything stored is normalized, so an unknown id from a
 * future version and a missing always-on family both resolve rather than throw.
 */
export function liveCapabilityGroups(): string[] {
	const raw = serverDb.getSetting(CAPABILITIES_KEY);
	if (!raw) return normalizeGroups(DEFAULT_ENABLED_GROUPS);
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return normalizeGroups(DEFAULT_ENABLED_GROUPS);
		return normalizeGroups(parsed.filter((v): v is string => typeof v === 'string'));
	} catch {
		// A corrupt cell must not silently hand the assistant every tool: fall back to the
		// shipped default, which is what a fresh workspace runs.
		return normalizeGroups(DEFAULT_ENABLED_GROUPS);
	}
}

/** What a session started NOW would freeze. */
export function liveSettings(): AssistantSessionSettings {
	return {
		instructions: serverDb.getSetting('assistantCustomInstructions') ?? '',
		skillIndex: describeSkillIndex(),
		groups: liveCapabilityGroups()
	};
}

/** Stable identity of a settings set: what "changed since" compares. */
export function settingsFingerprint(s: AssistantSessionSettings): string {
	const source = [s.instructions, s.skillIndex, s.groups.join(',')].join('\0');
	// djb2 over the three fields, NUL-joined so no value can straddle the separator.
	// Enough to tell two settings sets apart, and no dependency to carry.
	let h = 5381;
	for (let i = 0; i < source.length; i += 1) h = ((h << 5) + h + source.charCodeAt(i)) | 0;
	return (h >>> 0).toString(36);
}

/** A stored snapshot, or null when the session has none / the row is corrupt. */
function storedSettings(sessionId: string): AssistantSessionSettings | null {
	const raw = serverDb.getAssistantSessionSettings(sessionId);
	if (!raw) return null;
	// A corrupt cell must not brick the tab: re-freeze from live instead. The only cost
	// is one cache break, which is exactly what a settings change costs anyway.
	try {
		const parsed = JSON.parse(raw) as Partial<AssistantSessionSettings>;
		if (typeof parsed?.instructions !== 'string' || typeof parsed.skillIndex !== 'string' || !Array.isArray(parsed.groups)) {
			return null;
		}
		return {
			instructions: parsed.instructions,
			skillIndex: parsed.skillIndex,
			groups: normalizeGroups(parsed.groups.filter((v): v is string => typeof v === 'string'))
		};
	} catch {
		return null;
	}
}

/**
 * The settings this turn runs under. A session without a snapshot takes one here, which
 * is why a brand-new session is never "stale": nothing is frozen until it actually runs.
 */
export function settingsForTurn(sessionId: string): AssistantSessionSettings {
	const stored = storedSettings(sessionId);
	if (stored) return stored;
	const fresh = liveSettings();
	serverDb.setAssistantSessionSettings(sessionId, JSON.stringify(fresh));
	return fresh;
}

/** Re-freeze a session on the current settings ("Apply settings" in the panel). */
export function applyLiveSettings(sessionId: string): void {
	serverDb.setAssistantSessionSettings(sessionId, JSON.stringify(liveSettings()));
}

/** Whether the live settings differ from what this session froze. A session that has
 *  never taken a turn has frozen nothing, so it is never stale. */
export function settingsStale(sessionId: string): boolean {
	const stored = storedSettings(sessionId);
	if (!stored) return false;
	return settingsFingerprint(stored) !== settingsFingerprint(liveSettings());
}
