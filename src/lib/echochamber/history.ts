/**
 * Which turns of the story the crowd is shown.
 *
 * Split out of the store because it is the one part of assembling the context that needs no
 * chat tree, no settings transport and no Svelte: given the turns on the path and two
 * numbers, the window is decided. The store still owns walking the tree and filtering out
 * scaffolding; this owns the cut, so the cut can be tested.
 *
 * Pure: no DOM, no `$lib`, no Svelte. `echochamber.test.ts` covers it directly.
 */

/** The least a turn has to be for the window to place it. */
export interface WindowTurn {
	role: 'user' | 'assistant';
}

export interface WindowOptions {
	/** Feed the crowd the user's turns too, not just the reply being reacted to. */
	includeUserInput: boolean;
	/** How many turns to send when `includeUserInput` is on. A ceiling, never a target. */
	contextDepth: number;
}

/**
 * The last `contextDepth` turns, moved FORWARD to begin on a user turn.
 *
 * With `includeUserInput` off this is the reacted-to turn alone, which is the cheap default:
 * one turn in, a feed out. With it on the crowd sees a complete exchange rather than an
 * answer to a question it was never shown.
 *
 * **Forward, not back.** The rule used to walk backwards from the window's start looking for
 * a user turn, and then trim the result to `contextDepth` again - which lands on exactly the
 * turn the walk started from, so it never once changed the window it was meant to fix.
 * Walking forward keeps `contextDepth` a hard ceiling, which is what the reader set it as: it
 * is a cost paid on every reply, not a target to overshoot. What it drops is a leading
 * assistant turn whose own user turn fell outside the window - precisely the "answer to a
 * question the crowd was never shown" the rule exists for.
 *
 * A window with no user turn in it at all (a run of continuations) keeps the plain last
 * `contextDepth` turns rather than collapsing to nothing.
 *
 * The result always ENDS on the last turn given, because that turn is the one being reacted
 * to and the prompt's `<reacting_to>` block names it by position.
 */
export function historyWindow<T extends WindowTurn>(
	visible: readonly T[],
	options: WindowOptions
): T[] {
	if (visible.length === 0) return [];
	if (!options.includeUserInput) return visible.slice(-1);

	const depth = Math.max(1, options.contextDepth);
	let start = Math.max(0, visible.length - depth);
	for (let i = start; i < visible.length; i++) {
		if (visible[i].role === 'user') {
			start = i;
			break;
		}
	}
	return visible.slice(start);
}
