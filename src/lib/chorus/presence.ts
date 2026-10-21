/**
 * Chorus: who is in the scene, for the per-chat "only characters in the scene" switch.
 *
 * A member is present when their name appears in the last few messages, matched exactly the
 * way a lorebook key is (`resolveKeyMatch` + `compileKey`, lorebook/), under the reader's own
 * case and whole-word settings. That is the same test that decides whether the member's own
 * lorebook entry fires, so "asked" and "has their sheet in the prompt" agree: a member the
 * story has not named would be answering without their entry anyway.
 *
 * Pure, so it is tested without a store.
 */
import { compileKey } from '$lib/lorebook/engine';
import { resolveKeyMatch } from '$lib/lorebook/types';
import type { ChorusMember } from './state';

export interface PresenceMatching {
	caseSensitive: boolean;
	matchWholeWords: boolean;
}

/** Whether `name` appears in any of `texts`, as a lorebook key would. */
export function namedIn(name: string, texts: readonly string[], matching: PresenceMatching): boolean {
	const match = compileKey(name, resolveKeyMatch(name, undefined, matching));
	return match !== null && texts.some((text) => match(text) !== null);
}

/**
 * Split the members a read would ask into those the scene names and those it does not.
 * `texts` is the window to look in, oldest first, already cut to the chat's depth.
 */
export function splitByPresence(
	members: readonly ChorusMember[],
	texts: readonly string[],
	matching: PresenceMatching
): { present: ChorusMember[]; absent: ChorusMember[] } {
	const present: ChorusMember[] = [];
	const absent: ChorusMember[] = [];
	for (const member of members) {
		(namedIn(member.name, texts, matching) ? present : absent).push(member);
	}
	return { present, absent };
}
