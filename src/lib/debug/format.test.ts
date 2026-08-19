/**
 * Prompt-log accounting.
 *
 * The debug panel's whole claim is that it states the complete request, so these guard the
 * two ways a size can lie: a prompt priced without its tool definitions or tool-call
 * payloads (they are routinely the larger half of an assistant turn), and an estimate
 * presented as if the provider had reported it.
 */
import { describe, test, expect } from 'bun:test';

import { entryImages, messageTokens, promptSize, requestChips, toolTokens } from './format';
import type { PromptLogEntry } from './types';

const TOOL = {
	type: 'function',
	function: {
		name: 'read_entity',
		description: 'Read one addressable entity in full.',
		parameters: { type: 'object', properties: { kind: { type: 'string' }, id: { type: 'string' } }, required: ['kind'] }
	}
};

function entry(id: string, over: Partial<PromptLogEntry> = {}): PromptLogEntry {
	return {
		id,
		source: 'assistant',
		kind: 'assistant',
		provider: 'openrouter',
		model: 'test/model',
		messages: [{ role: 'system', content: 'You are a careful assistant.' }],
		stream: true,
		startedAt: 1000,
		status: 'done',
		...over
	};
}

describe('prompt sizing', () => {
	test('the estimate counts tool definitions, not just messages', () => {
		const withoutTools = promptSize(entry('a'));
		const withTools = promptSize(entry('b', { tools: [TOOL, TOOL] }));
		expect(withoutTools.reported).toBe(false);
		expect(withTools.tokens).toBe(withoutTools.tokens + toolTokens([TOOL, TOOL]));
		expect(withTools.tokens).toBeGreaterThan(withoutTools.tokens);
	});

	test('a message prices the tool calls it carries', () => {
		const calls = [{ id: 'c1', type: 'function', function: { name: 'edit_entity', arguments: '{"text":"a long rewrite"}' } }];
		const plain = messageTokens({ role: 'assistant', content: 'ok' });
		const calling = messageTokens({ role: 'assistant', content: 'ok', tool_calls: calls });
		expect(calling).toBeGreaterThan(plain);
	});

	test('provider-reported prompt tokens win, and are labelled as reported', () => {
		const size = promptSize(entry('c', { usage: { promptTokens: 12081, completionTokens: 40, totalTokens: 12121 } }));
		expect(size).toEqual({ tokens: 12081, reported: true });
	});

	test('a zero prompt count is not a report: it falls to the estimate, under the estimate label', () => {
		const size = promptSize(entry('d', { usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }));
		expect(size.reported).toBe(false);
		expect(size.tokens).toBeGreaterThan(0);
	});

	test('image attachments are collected across every message that carried one', () => {
		const e = entry('e', {
			messages: [
				{ role: 'system', content: 'rules' },
				{ role: 'user', content: 'look', images: ['images/chat/a.png', 'images/chat/b.png'] },
				{ role: 'user', content: 'and this', images: ['images/characters/c.png'] }
			]
		});
		expect(entryImages(e)).toEqual(['images/chat/a.png', 'images/chat/b.png', 'images/characters/c.png']);
	});
});

describe('request fields', () => {
	test('tuning and routing reach the panel field by field', () => {
		const chips = requestChips(
			entry('f', {
				params: { temperature: 1.1, max_tokens: 800 },
				tuning: { reasoningEffort: 'high', promptCaching: true, parseInlineReasoning: false },
				routing: { sort: 'throughput', order: ['deepinfra', 'together'] }
			})
		);
		expect(chips).toContain('temperature 1.1');
		expect(chips).toContain('max_tokens 800');
		expect(chips).toContain('reasoningEffort high');
		expect(chips).toContain('promptCaching on');
		expect(chips).toContain('parseInlineReasoning off');
		expect(chips).toContain('route.sort throughput');
		expect(chips).toContain('route.order deepinfra, together');
	});

	test('a value carried in both params and a top-level field is stated once', () => {
		const chips = requestChips(entry('g', { params: { temperature: 0.7, max_tokens: 600 }, temperature: 0.7, maxTokens: 600 }));
		expect(chips.filter((c) => c.startsWith('temperature')).length).toBe(1);
		expect(chips.filter((c) => c.startsWith('max_tokens')).length).toBe(1);
	});

	test('the stream mode is always stated', () => {
		expect(requestChips(entry('h', { stream: false }))).toContain('no-stream');
		expect(requestChips(entry('i', { stream: true }))).toContain('stream');
	});
});
