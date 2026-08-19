/**
 * Continuation joining: the pure text rules for extending an assistant turn in place.
 *
 * A continuation arrives as free text from the model. Two hazards stand between it and a
 * clean append: the model may restate part (or all) of the original message despite being
 * told not to, and the seam may need a space neither side carries. The rules are split so
 * the live stream preview and the persisted result can share the seam logic:
 *   - glueContinuation(base, next): seam rule only; safe on a partial, still-streaming tail
 *     (overlap detection on a partial tail would false-positive and eat legitimate text).
 *   - joinContinuation(base, next): restatement trim + glue; what actually gets saved.
 *
 * Covered by continuation.test.ts.
 */

/** Leading characters that glue directly onto the preceding word with no inserted space:
 *  whitespace, sentence punctuation, closers, and the curly ellipsis/dash/quote family. */
const GLUING_START = /^[\s.,!?;:)\]}"'…—’”]/; // em-dash: data

/** Longest tail overlap worth scanning for; a restatement longer than this is caught by
 *  the whole-message check instead, and the bound keeps the scan cheap on huge turns. */
const OVERLAP_WINDOW = 4000;

/** Overlaps shorter than this are treated as coincidence (a name, "the ") and kept. */
const MIN_OVERLAP = 16;

/** Seam rule alone: concatenate raw when either side already carries the boundary
 *  (whitespace or gluing punctuation), otherwise insert a single space. */
export function glueContinuation(base: string, next: string): string {
	if (!next) return base;
	if (!base) return next.trimStart();
	if (/\s$/.test(base) || GLUING_START.test(next)) return base + next;
	return base + ' ' + next;
}

/** Strip the longest prefix of `next` that restates the tail (or the whole) of `base`. */
function trimRestatement(base: string, next: string): string {
	const anchor = base.trimEnd();
	if (!anchor) return next;
	// Whole-message restatement: the model rewrote everything from the top.
	if (next.length >= anchor.length && next.startsWith(anchor)) return next.slice(anchor.length);
	// Tail overlap, longest match first, inside a bounded window. The first-char probe
	// skips the substring build for the overwhelming majority of candidate lengths.
	const window = anchor.slice(-OVERLAP_WINDOW);
	const first = next.charCodeAt(0);
	for (let k = Math.min(window.length, next.length); k >= MIN_OVERLAP; k--) {
		if (window.charCodeAt(window.length - k) !== first) continue;
		if (window.endsWith(next.slice(0, k))) return next.slice(k);
	}
	return next;
}

/** The persisted join: drop restated text, then glue. Returns `base` unchanged when the
 *  continuation contained nothing new, which callers treat as "nothing to append". */
export function joinContinuation(base: string, next: string): string {
	const fresh = trimRestatement(base, next);
	if (!fresh.trim()) return base;
	return glueContinuation(base, fresh);
}
