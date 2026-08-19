/**
 * Inline-reasoning extraction: the single implementation every completion path uses.
 *
 * Reasoning models are supposed to return their chain-of-thought in a structured
 * field (`reasoning_content` / `reasoning` / `thinking`), but plenty of
 * model+provider combinations emit it as plain text inside the content stream,
 * wrapped in model-family-specific markers. Left alone, that text would be saved
 * as chat content and re-sent with every future prompt. This module recognises
 * all known marker families simultaneously and routes the enclosed text to the
 * thinking channel instead, so reasoning never enters chat content in the first
 * place. Streaming and non-streaming responses go through the exact same state
 * machine, so the two paths cannot drift.
 *
 * Deliberate non-goal: orphan close markers. Some broken deployments pre-fill the
 * opening tag in the chat template, so the response starts mid-reasoning and only
 * a close marker appears. Guessing "everything before the orphan close was
 * reasoning" would misroute half a reply whenever a model merely *mentions* a
 * marker, which is a far worse failure than showing stray reasoning. The clean
 * fix for such deployments is prompt-side (re-adding the prefill), not parser-side.
 */

export interface ReasoningMarker {
	open: string;
	close: string;
}

/**
 * Marker families recognised in message content. Matched anywhere in the stream
 * (models occasionally interleave several reasoning blocks with prose); on an
 * index tie the longest open marker wins, so a family that extends another can
 * be added safely.
 */
export const REASONING_MARKERS: readonly ReasoningMarker[] = [
	// The de-facto standard: DeepSeek R1, Qwen 3 / QwQ, and most open reasoning models.
	{ open: '<think>', close: '</think>' },
	// Prompted chain-of-thought and various fine-tunes.
	{ open: '<thinking>', close: '</thinking>' },
	{ open: '<reasoning>', close: '</reasoning>' },
	// Mistral Magistral: its template's [THINK] special tokens arrive as literal
	// text on providers that don't map them.
	{ open: '[THINK]', close: '[/THINK]' },
	// OpenAI Harmony (gpt-oss) raw channel markup, for providers that don't parse
	// channels: the analysis channel is reasoning, the final channel is the reply.
	// Two opens because generation usually starts *inside* the assistant header
	// (no `<|start|>assistant` echoed), but some providers replay it.
	{
		open: '<|start|>assistant<|channel|>analysis<|message|>',
		close: '<|start|>assistant<|channel|>final<|message|>'
	},
	{ open: '<|channel|>analysis<|message|>', close: '<|start|>assistant<|channel|>final<|message|>' },
	// Gemma thought markup, exactly as SillyTavern's Gemma preset ships it.
	{ open: '<|channel>thought\n', close: '<channel|>' }
];

/** Where a parser routes each span of text. */
export interface InlineReasoningSink {
	onThinking(text: string): void;
	onContent(text: string): void;
}

export interface InlineReasoningParser {
	/** Feed the next content chunk; text is routed to the sink as soon as it is unambiguous. */
	push(chunk: string): void;
	/** Call once at end of stream: releases any held-back partial delimiter so it isn't lost. */
	flush(): void;
}

/**
 * Length of the longest suffix of `rest` that is a proper prefix of `tag`. Used to
 * hold back a possibly-split delimiter at a chunk boundary (e.g. `rest` ends with
 * `</thi`, which could become `</think>` once the next chunk arrives).
 */
function partialTagSuffixLen(rest: string, tag: string): number {
	const max = Math.min(rest.length, tag.length - 1);
	for (let len = max; len > 0; len -= 1) {
		if (rest.slice(rest.length - len) === tag.slice(0, len)) return len;
	}
	return 0;
}

/**
 * Streaming parser over the marker table. Outside a block it scans for the
 * earliest open marker of any family; inside one it scans for that family's
 * close. Text that could still turn into a delimiter at a chunk boundary is
 * held back (bounded by the longest marker) and re-examined with the next
 * chunk, so a split tag is never misrouted or swallowed. A block left open at
 * end of stream stays thinking (matching how truncated reasoning actually
 * reads), and `flush()` releases whatever partial delimiter remains.
 */
export function createInlineReasoningParser(
	sink: InlineReasoningSink,
	markers: readonly ReasoningMarker[] = REASONING_MARKERS
): InlineReasoningParser {
	let active: ReasoningMarker | null = null;
	let pending = '';

	return {
		push(chunk: string): void {
			const buf = pending + chunk;
			pending = '';
			let i = 0;

			while (true) {
				if (active) {
					const closeIdx = buf.indexOf(active.close, i);
					if (closeIdx === -1) {
						const rest = buf.slice(i);
						const keep = partialTagSuffixLen(rest, active.close);
						if (rest.length > keep) sink.onThinking(rest.slice(0, rest.length - keep));
						pending = rest.slice(rest.length - keep);
						return;
					}
					if (closeIdx > i) sink.onThinking(buf.slice(i, closeIdx));
					i = closeIdx + active.close.length;
					active = null;
				} else {
					let openIdx = -1;
					let opened: ReasoningMarker | null = null;
					for (const marker of markers) {
						const idx = buf.indexOf(marker.open, i);
						if (idx === -1) continue;
						if (
							openIdx === -1 ||
							idx < openIdx ||
							(idx === openIdx && marker.open.length > (opened as ReasoningMarker).open.length)
						) {
							openIdx = idx;
							opened = marker;
						}
					}
					if (!opened) {
						const rest = buf.slice(i);
						let keep = 0;
						for (const marker of markers) {
							keep = Math.max(keep, partialTagSuffixLen(rest, marker.open));
						}
						if (rest.length > keep) sink.onContent(rest.slice(0, rest.length - keep));
						pending = rest.slice(rest.length - keep);
						return;
					}
					if (openIdx > i) sink.onContent(buf.slice(i, openIdx));
					i = openIdx + opened.open.length;
					active = opened;
				}
			}
		},

		flush(): void {
			if (!pending) return;
			const leftover = pending;
			pending = '';
			if (active) sink.onThinking(leftover);
			else sink.onContent(leftover);
		}
	};
}

/**
 * Harmony turn-end tokens that legitimately trail an analysis block (`…<|end|>`
 * before the final-channel marker) or the reply itself (`<|return|>`). They are
 * grammar residue, not text, and are stripped when finalizing extracted spans.
 */
const RESIDUAL_MARKER_RE = /(?:\s*<\|(?:end|return)\|>)+\s*$/;

/** Trim an extracted span and drop trailing turn-end residue (Harmony `<|end|>` / `<|return|>`). */
export function stripResidualMarkers(text: string): string {
	return text.replace(RESIDUAL_MARKER_RE, '').trim();
}

/**
 * One-shot extraction for complete (non-streamed) content: the same state
 * machine run over the whole string, finalized with `stripResidualMarkers`.
 */
export function extractInlineReasoning(
	text: string,
	markers: readonly ReasoningMarker[] = REASONING_MARKERS
): { content: string; reasoning: string | null } {
	let content = '';
	let reasoning = '';
	const parser = createInlineReasoningParser(
		{
			onThinking(t) {
				reasoning += t;
			},
			onContent(t) {
				content += t;
			}
		},
		markers
	);
	parser.push(text);
	parser.flush();
	const cleaned = stripResidualMarkers(reasoning);
	return { content: stripResidualMarkers(content), reasoning: cleaned || null };
}
