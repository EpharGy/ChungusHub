import { describe, expect, test } from 'bun:test';
import {
	createInlineReasoningParser,
	extractInlineReasoning,
	stripResidualMarkers
} from './inline-reasoning';

/** Run the streaming parser over `text` split into `size`-char chunks; return raw routed spans. */
function runChunked(text: string, size: number): { content: string; thinking: string } {
	let content = '';
	let thinking = '';
	const parser = createInlineReasoningParser({
		onThinking(t) {
			thinking += t;
		},
		onContent(t) {
			content += t;
		}
	});
	for (let i = 0; i < text.length; i += size) {
		parser.push(text.slice(i, i + size));
	}
	parser.flush();
	return { content, thinking };
}

describe('extractInlineReasoning', () => {
	test('extracts a think block and keeps surrounding content', () => {
		const r = extractInlineReasoning('<think>plan the scene</think>She opens the door.');
		expect(r.reasoning).toBe('plan the scene');
		expect(r.content).toBe('She opens the door.');
	});

	test('extracts multiple blocks interleaved with prose', () => {
		const r = extractInlineReasoning('<think>a</think>One.<think>b</think>Two.');
		expect(r.reasoning).toBe('ab');
		expect(r.content).toBe('One.Two.');
	});

	test('handles <thinking>, <reasoning> and [THINK] families', () => {
		expect(extractInlineReasoning('<thinking>x</thinking>reply')).toEqual({
			content: 'reply',
			reasoning: 'x'
		});
		expect(extractInlineReasoning('<reasoning>y</reasoning>reply')).toEqual({
			content: 'reply',
			reasoning: 'y'
		});
		expect(extractInlineReasoning('[THINK]z[/THINK]reply')).toEqual({
			content: 'reply',
			reasoning: 'z'
		});
	});

	test('parses Harmony channels in the generation-prefilled form', () => {
		const raw =
			'<|channel|>analysis<|message|>weigh the options<|end|><|start|>assistant<|channel|>final<|message|>Here you go.<|return|>';
		const r = extractInlineReasoning(raw);
		expect(r.reasoning).toBe('weigh the options');
		expect(r.content).toBe('Here you go.');
	});

	test('parses Harmony channels with the full assistant header replayed', () => {
		const raw =
			'<|start|>assistant<|channel|>analysis<|message|>think it through<|end|><|start|>assistant<|channel|>final<|message|>Done.';
		const r = extractInlineReasoning(raw);
		expect(r.reasoning).toBe('think it through');
		expect(r.content).toBe('Done.');
	});

	test('parses Gemma thought markup', () => {
		const r = extractInlineReasoning('<|channel>thought\nmull it over<channel|>The reply.');
		expect(r.reasoning).toBe('mull it over');
		expect(r.content).toBe('The reply.');
	});

	test('leaves near-miss tags alone', () => {
		const text = 'A <thinker> walks in. No </think reasoning here.';
		const r = extractInlineReasoning(text);
		expect(r.reasoning).toBeNull();
		expect(r.content).toBe(text.trim());
	});

	test('an orphan close marker stays in content (no guessing)', () => {
		const text = 'Half a reply.</think> More reply.';
		const r = extractInlineReasoning(text);
		expect(r.reasoning).toBeNull();
		expect(r.content).toBe(text);
	});

	test('an unterminated block stays thinking', () => {
		const r = extractInlineReasoning('<think>cut off mid-thought');
		expect(r.reasoning).toBe('cut off mid-thought');
		expect(r.content).toBe('');
	});

	test('plain text passes through trimmed, reasoning null', () => {
		const r = extractInlineReasoning('  Just a normal reply.  ');
		expect(r.reasoning).toBeNull();
		expect(r.content).toBe('Just a normal reply.');
	});

	test('whitespace padding around markers is trimmed from both spans', () => {
		const r = extractInlineReasoning('<think>\nplan\n</think>\n\nReply text.');
		expect(r.reasoning).toBe('plan');
		expect(r.content).toBe('Reply text.');
	});
});

describe('createInlineReasoningParser (streaming)', () => {
	const CASES: { name: string; text: string }[] = [
		{ name: 'think block', text: '<think>plan the scene</think>She opens the door.' },
		{ name: 'multiple blocks', text: 'Intro. <think>a</think>One.<think>b</think>Two.' },
		{ name: 'thinking tag', text: '<thinking>alpha beta</thinking>Reply follows here.' },
		{ name: 'magistral', text: '[THINK]weigh the tone[/THINK]The knight bows.' },
		{
			name: 'harmony',
			text: '<|channel|>analysis<|message|>reason<|end|><|start|>assistant<|channel|>final<|message|>Answer.'
		},
		{ name: 'gemma', text: '<|channel>thought\nponder<channel|>Reply.' },
		{ name: 'no markers', text: 'Nothing special in this reply at all.' },
		{ name: 'near miss at end', text: 'Trailing partial <thi' }
	];

	test('routing is identical for every chunk size (split-tag safety)', () => {
		for (const { name, text } of CASES) {
			const whole = runChunked(text, text.length || 1);
			for (const size of [1, 2, 3, 5, 7, 11]) {
				expect({ name, ...runChunked(text, size) }).toEqual({ name, ...whole });
			}
		}
	});

	test('streaming accumulation matches one-shot extraction after finalize', () => {
		for (const { text } of CASES) {
			for (const size of [1, 3, 8]) {
				const streamed = runChunked(text, size);
				const oneShot = extractInlineReasoning(text);
				expect(stripResidualMarkers(streamed.content)).toBe(oneShot.content);
				expect(stripResidualMarkers(streamed.thinking) || null).toBe(oneShot.reasoning);
			}
		}
	});

	test('a partial delimiter held at end of stream is flushed to content', () => {
		const r = runChunked('Reply ends with <think', 4);
		expect(r.content).toBe('Reply ends with <think');
		expect(r.thinking).toBe('');
	});

	test('a partial close delimiter inside a block is flushed to thinking', () => {
		const r = runChunked('<think>thought that ends with </thi', 6);
		expect(r.thinking).toBe('thought that ends with </thi');
		expect(r.content).toBe('');
	});

	test('content is released eagerly, not held until end of stream', () => {
		const seen: string[] = [];
		const parser = createInlineReasoningParser({
			onThinking() {},
			onContent(t) {
				seen.push(t);
			}
		});
		parser.push('Hello ');
		expect(seen.join('')).toBe('Hello ');
	});
});

describe('stripResidualMarkers', () => {
	test('drops trailing turn-end tokens and trims', () => {
		expect(stripResidualMarkers('reasoning text<|end|>')).toBe('reasoning text');
		expect(stripResidualMarkers('reply<|return|>')).toBe('reply');
		expect(stripResidualMarkers('stacked<|end|>\n<|return|> ')).toBe('stacked');
	});

	test('leaves interior tokens and normal text alone', () => {
		expect(stripResidualMarkers('a<|end|>b')).toBe('a<|end|>b');
		expect(stripResidualMarkers('  plain  ')).toBe('plain');
	});
});
