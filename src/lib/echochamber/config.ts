/**
 * EchoChamber defaults and the guard rails around them.
 *
 * The shipped numbers are tuned for a feed that sits beside a roleplay rather than for one
 * that fills a screen on its own: six reactions is enough for a crowd to disagree with
 * itself and short enough to read between turns, and it costs one small call per reply.
 *
 * `enabled` ships OFF. Every reply would otherwise start a second model call on an install
 * that never asked for one, on whatever connection the engine resolves to, which is a bill
 * arriving before the feature has been seen.
 */

import type { EchoChamberSettings } from './types';

/**
 * The style a fresh install starts on.
 *
 * Named outright rather than taken as "the first in the list", because the list is ordered
 * for the style picker (cast styles at the top, NSFW at the bottom) and the first row is a
 * cast style: it speaks as the story's characters and discards any name that is not one of
 * them, so on a chat whose cast has not resolved yet it can produce an empty feed as its
 * first impression. Discord/Twitch invents its own crowd and depends on nothing.
 */
const DEFAULT_STYLE_ID = 'twitch';

export const DEFAULT_ECHOCHAMBER_SETTINGS: EchoChamberSettings = {
	enabled: false,
	autoGenerate: true,
	styleId: DEFAULT_STYLE_ID,
	reactionCount: 6,
	includeUserInput: false,
	contextDepth: 4,
	includePersona: true,
	includeCharacterDescription: true,
	includeLorebook: false,
	includeMemory: false,
	includePastReactions: false,
	messageOrder: 'oldest-first'
};

/**
 * Per-field guard rails for values coming from the settings page or a stored blob.
 *
 * `reactionCount` tops out well below what the panel offers as a sensible range because
 * the ceiling is a token cost the reader pays per turn, not a display limit: each reaction
 * is its own line of generated prose, and a request for fifty is a request for a second
 * story-sized completion beside every reply.
 */
export const BOUNDS = {
	reactionCount: { min: 1, max: 30 },
	contextDepth: { min: 2, max: 50 }
} as const;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
	const n = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.round(Math.min(Math.max(n, min), max));
}

/**
 * Merge stored settings onto the defaults, clamping every field.
 *
 * Written as a whitelist rather than a spread, for the same reason imagegen's is: the
 * stored blob is JSON an older build wrote or a reader hand-edited, so any field can be
 * missing, the wrong type, or a key nothing reads any more.
 *
 * `styleId` is deliberately NOT validated against the style list here. Custom styles live
 * in their own setting and load separately, so a resolver that rejected an id it could not
 * see would silently reset a reader's own style to Discord on every boot. The store
 * resolves it against the merged list and falls back there, where both halves are known.
 */
export function resolveEchoChamberSettings(
	stored?: Partial<EchoChamberSettings> | null
): EchoChamberSettings {
	const d = DEFAULT_ECHOCHAMBER_SETTINGS;
	const s = stored ?? {};

	return {
		enabled: typeof s.enabled === 'boolean' ? s.enabled : d.enabled,
		autoGenerate: typeof s.autoGenerate === 'boolean' ? s.autoGenerate : d.autoGenerate,
		styleId: typeof s.styleId === 'string' && s.styleId.trim() ? s.styleId.trim() : d.styleId,
		reactionCount: clampInt(
			s.reactionCount,
			BOUNDS.reactionCount.min,
			BOUNDS.reactionCount.max,
			d.reactionCount
		),
		includeUserInput:
			typeof s.includeUserInput === 'boolean' ? s.includeUserInput : d.includeUserInput,
		contextDepth: clampInt(
			s.contextDepth,
			BOUNDS.contextDepth.min,
			BOUNDS.contextDepth.max,
			d.contextDepth
		),
		includePersona: typeof s.includePersona === 'boolean' ? s.includePersona : d.includePersona,
		includeCharacterDescription:
			typeof s.includeCharacterDescription === 'boolean'
				? s.includeCharacterDescription
				: d.includeCharacterDescription,
		includeLorebook:
			typeof s.includeLorebook === 'boolean' ? s.includeLorebook : d.includeLorebook,
		includeMemory: typeof s.includeMemory === 'boolean' ? s.includeMemory : d.includeMemory,
		includePastReactions:
			typeof s.includePastReactions === 'boolean' ? s.includePastReactions : d.includePastReactions,
		messageOrder: s.messageOrder === 'newest-first' ? 'newest-first' : d.messageOrder
	};
}
