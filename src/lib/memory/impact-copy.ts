/**
 * Plain-English rendering of a `ChangeImpact`: what a rewrite or a delete costs the chat's
 * memory, said before it happens.
 *
 * Kept beside the engine rather than inside the component because it is pure, unit-testable,
 * and has to stay honest about mechanics only this module's neighbours know: which summaries
 * die, which merely pause, how many turns are re-read, and WHO re-reads them (a delete's reap
 * kicks the pass itself, a rewrite waits for the next reply, manual mode waits for the panel's
 * Summarise, and a backlog past `AUTO_MAX_BATCHES` takes several replies whatever the mode).
 *
 * Short by construction: one sentence for what the change costs, one for what happens next,
 * and a third only when summaries outside the current thread go too. Everything else belongs
 * in the Memory panel. The rule these sentences must never break is that each one describes
 * something the engine will actually do. A promised re-read that no pass performs sends the
 * reader to Forget and rebuild, which discards the whole ladder to fix nothing.
 */

import type { ChangeImpact } from './branching';
import { AUTO_MAX_BATCHES } from './config';

export interface ImpactCopyOptions {
	/** A rewrite keeps the turns; a delete takes them out of the chat. */
	mode: 'edit' | 'delete';
	/** Whether extraction fires on its own. In manual mode the panel's Summarise is the
	 *  only trigger, so promising the next reply will fix it would be a lie. */
	auto: boolean;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Sentences for a confirmation, or an empty array when memory is untouched by the change. */
export function describeMemoryImpact(impact: ChangeImpact, opts: ImpactCopyOptions): string[] {
	const { dropped, droppedStored, paused, survivors, reread, passes, span } = impact;
	if (!dropped && !droppedStored) return [];
	const lines: string[] = [];

	if (dropped) {
		// A summary in play is on-path and contiguous by construction, so it always resolves to
		// a range. No span here means `resolveCoverage` let a row into `active` that its own
		// rules forbid: a real defect, and one a quietly range-less sentence would hide.
		if (!span) throw new Error('memory: a summary in play has no turn span');
		const where = span.from === span.to ? `Turn #${span.from} is` : `Turns #${span.from} to #${span.to} are`;
		const verb = opts.mode === 'edit' ? 'Saving' : 'Deleting';
		const what = plural(dropped, 'that summary', `those ${dropped} summaries`);
		const after = paused
			? `, and the ${paused} ${plural(paused, 'summary', 'summaries')} behind ${plural(dropped, 'it', 'them')} ${plural(paused, 'pauses', 'pause')}`
			: '';
		lines.push(`${where} summarized in memory. ${verb} drops ${what}${after}.`);
	}

	if (passes > 0) {
		const cost = `${reread} ${plural(reread, 'turn', 'turns')} (${passes} ${plural(passes, 'pass', 'passes')})`;
		const back = paused ? `, and the paused ${plural(paused, 'one returns', 'ones return')}` : '';
		if (!opts.auto) {
			lines.push(`Nothing is lost: summarizing in the Memory panel re-reads ${cost}${back}.`);
		} else if (opts.mode === 'delete') {
			lines.push(`The turns that survive are re-summarized right away: ${cost}${back}.`);
		} else if (passes > AUTO_MAX_BATCHES) {
			// The automatic pass is capped per reply, so one reply cannot owe nine of them.
			lines.push(`Nothing is lost: ${cost} are re-read over your next few replies${back}.`);
		} else {
			lines.push(`Nothing is lost: your next reply re-reads ${cost}${back}.`);
		}
	} else if (dropped && survivors === 0) {
		// A span removed whole leaves no hole: the path shortens and the summaries either side
		// keep tiling, so there is nothing to re-read and nothing waiting on it.
		lines.push(`The ${plural(dropped, 'turns it describes are', 'turns they describe are')} going too, so nothing is re-read and the rest of memory is untouched.`);
	} else if (dropped) {
		// Survivors that no pass can reach: a shortened path put them inside the verbatim
		// tail, or they are too few to fill a batch with nothing covered after them.
		lines.push(`The ${survivors} ${plural(survivors, 'turn that survives goes', 'turns that survive go')} back to being sent in full, so nothing is re-read.`);
	}

	if (droppedStored) {
		// Deliberately unclassified: `Coverage.dormant` mixes another branch's summaries with
		// ones the tail pushed out and ones stranded past a hole, and they return on entirely
		// different terms. Saying they go is true of all three; saying more is not.
		lines.push(
			`${droppedStored} other stored ${plural(droppedStored, 'summary', 'summaries')} of these turns ${plural(droppedStored, 'goes', 'go')} with them.`
		);
	}
	return lines;
}
