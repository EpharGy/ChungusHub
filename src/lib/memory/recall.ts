/**
 * Recall assembly: turns the stored memory into the text injected via {{memory}}.
 *
 * Two blocks: deep memory (compacted higher-layer episodes) and the layer-0 episodes
 * ("Recent events"), each in story order.
 *
 * **Callers pass `Coverage.active`, and its order IS the story order.** Nothing is sorted
 * here on purpose. Inferring order from `createdAt` holds only while episodes are appended
 * strictly along the path, and they are not: a hole left by a deleted turn is re-folded
 * later, producing a brand-new row that covers an OLD stretch of the story. Sorting that by
 * write time prints the middle of the book after its ending.
 * `resolveCoverage` already tiles the path from the root, so it knows the real order and is
 * the only thing that should decide it.
 *
 * Every episode handed in is rendered. There is deliberately no cap on the COUNT: a second
 * cap on top of the layer caps hides whole batches whose messages have already been dropped
 * from the live history, a band of the story neither shown verbatim nor recalled. Whatever
 * is folded is recalled, so "a message is either live or in memory" holds end to end.
 *
 * There is no cap on the SIZE either, and that IS the decision (architecture/memory.md): the context
 * size and the layer sliders are the user's, and a cap would either spend merge calls making
 * memory worse or hide episodes whose turns are already archived. The layer caps bound how
 * many episodes exist, not what they weigh: the promote template targets
 * "roughly half the length of the input" while merging `promoteCount` of them, so episode
 * size is geometric in `maxLayers`, and the top layer compacts in place under an unchanged
 * cap, so its episodes double in size each time it fills. A saturated three-layer ladder on
 * the shipped defaults measures around 12k tokens, enough to blow the whole budget on an
 * 8k or 16k model, at which point prompt-assembly drops every live turn and ships this block
 * whole. That is surfaced (composer chip, Prompt Builder header, the panel's Tokens/turn),
 * not prevented.
 */

import { substitute } from '$lib/macros';
import { DEFAULT_RECALL_TEMPLATE } from './prompts';
import type { Episode } from './types';

function deepBlock(episodes: Episode[]): string {
	const deep = episodes.filter((e) => e.layer >= 1);
	if (deep.length === 0) return '';
	// "Earlier arcs", not "The story so far": the default preset labels its history
	// block that way, and two identical headings in one prompt read as the same thing.
	return 'Earlier arcs:\n' + deep.map((e) => `- ${e.content}`).join('\n');
}

function recentBlock(episodes: Episode[]): string {
	const l0 = episodes.filter((e) => e.layer === 0);
	if (l0.length === 0) return '';
	return 'Recent events:\n' + l0.map((e) => `- ${e.content}`).join('\n');
}

function fillRecall(template: string, vars: { deepMemory: string; recent: string }): string {
	return substitute(template, vars)
		.replace(/\n{3,}/g, '\n\n') // collapse gaps left by empty blocks
		.trim();
}

/**
 * Build the recall block, or null when there's nothing to recall. `template` defaults to
 * the built-in template (so tests/fallback don't need a template source).
 *
 * `episodes` must already be in story order: pass `Coverage.active`, never a raw table
 * read. See the module header for why nothing is sorted in here.
 */
export function buildRecall(episodes: Episode[], template: string = DEFAULT_RECALL_TEMPLATE): string | null {
	const d = deepBlock(episodes);
	const r = recentBlock(episodes);
	if (!d && !r) return null;
	return fillRecall(template, { deepMemory: d, recent: r });
}
