/**
 * What the crowd is allowed to know about the world, taken from what the STORY already knew.
 *
 * EchoChamber deliberately runs no lorebook scan of its own. The turn it reacts to already
 * recorded one - `Message.lorebook` is the trace of what the scan decided for the generation
 * that produced that turn - so the entries here are exactly the entries the model was
 * holding when it wrote the reply. Three things follow from reusing it rather than
 * re-scanning:
 *
 * - **The crowd cannot know more than the story did.** A second scan runs against a
 *   different text at a different moment and activates a different set, so the feed could
 *   reference a secret the reply itself was never told.
 * - **It is branch-correct for free.** The trace is a column on the message, so walking to
 *   another branch reads that branch's scan, with nothing to recompute or invalidate.
 * - **It costs nothing.** A scan is real work over every book and every key; this is a
 *   filter over a list that is already loaded.
 *
 * The trace stores decisions, not text, on purpose (so it still reads after an entry is
 * deleted), which is why the content is resolved against the books here. An entry that has
 * since been deleted simply drops out: it is gone, and inventing a placeholder for it would
 * put a hole in the world description rather than admit one.
 *
 * Pure: type-only imports, so `bun test` covers it with no stores and no DOM.
 */

import type { Lorebook, LorebookTrace } from '$lib/lorebook/types';
import { lorebookWasInjected } from '$lib/lorebook/types';

/**
 * The text of every entry that actually reached the story's prompt on this turn.
 *
 * `lorebookWasInjected` is the app's own predicate for that, and using it rather than a
 * hand-rolled status list is what keeps this in step: an entry that was matched but trimmed
 * by the token budget, or that lost its inclusion group, never reached the model, so it must
 * not reach the crowd either.
 */
export function lorebookTextFromTrace(
	trace: LorebookTrace | null | undefined,
	books: readonly Lorebook[]
): string {
	if (!trace?.records.length) return '';

	const byId = new Map<string, string>();
	for (const book of books) {
		for (const entry of book.entries) byId.set(entry.id, entry.content);
	}

	const seen = new Set<string>();
	const parts: string[] = [];
	for (const record of trace.records) {
		if (!lorebookWasInjected(record.status)) continue;
		// One entry can be recorded more than once across a recursive scan; its text is the
		// same either way, and repeating it only spends tokens.
		if (seen.has(record.entryId)) continue;
		seen.add(record.entryId);

		const content = byId.get(record.entryId)?.trim();
		if (content) parts.push(content);
	}

	return parts.join('\n\n');
}
