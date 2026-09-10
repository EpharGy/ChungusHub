/**
 * Date framework tests. Run with `bun test`.
 *
 * The load-bearing one is the round trip: this framework writes the marker the model is asked
 * to copy, and day.ts reads it back. Those two are a pair, and if they ever disagree the day
 * silently stops moving while every surface still looks correct.
 */

import { describe, expect, test } from 'bun:test';

import { resolveLorebooks } from '$lib/lorebook/engine';

import { frameworkBooks, FRAMEWORK_BOOK_ID } from '../apply';
import { defaultChatFrameworkState } from '../chat-state';
import { resolveDay, todaySerial } from '../day';
import { applyFrameworks } from '../dispatch';
import { FRAMEWORKS } from '../registry';
import {
	DATE_FRAMEWORK,
	DATE_FRAMEWORK_ID,
	dateInstructions,
	defaultDateFrameworkState,
	normalizeDateFrameworkState,
	renderTimeMarker,
	type MarkerShape
} from './index';

/** A pinned clock, so nothing here depends on when it runs. 6:02 PM, Sat 10 Oct 2026. */
const NOW = new Date(2026, 9, 10, 18, 2);

function inject(over: { mode?: 'manual' | 'marker'; shape?: MarkerShape } = {}) {
	return dateInstructions({
		day: 1,
		mode: over.mode ?? 'marker',
		state: over.shape ? { shape: over.shape } : undefined,
		now: NOW
	});
}

function chatState(over: Partial<ReturnType<typeof defaultChatFrameworkState>> = {}) {
	return { ...defaultChatFrameworkState(), ...over };
}

describe('what the marker looks like', () => {
	test('the visible shape is the one markdown draws as written', () => {
		expect(renderTimeMarker(NOW, 'visible')).toBe('<Time: 6:02 PM, Saturday October 10, 2026>');
	});

	test('the hidden shape is an HTML comment, which no browser draws', () => {
		expect(renderTimeMarker(NOW, 'hidden')).toBe('<!-- Time: 6:02 PM, Saturday October 10, 2026 -->');
	});

	test('the two carry an identical body, which is what lets one parser read both', () => {
		const visible = renderTimeMarker(NOW, 'visible');
		const hidden = renderTimeMarker(NOW, 'hidden');
		expect(hidden).toBe(`<!-- ${visible.slice(1, -1)} -->`);
	});

	test('the month is written by NAME, because the parser reads no other form', () => {
		// day.ts's ISO branch is anchored and cannot match inside a marker. A digit month here
		// would produce a marker that parses to nothing and a day that silently stops moving.
		expect(renderTimeMarker(NOW, 'visible')).toContain('October');
		expect(renderTimeMarker(NOW, 'visible')).not.toContain('2026-10');
	});
});

describe('the round trip against the day resolver', () => {
	// The coupling this framework exists to keep. What it writes, day.ts must read.
	for (const shape of ['visible', 'hidden'] as const) {
		test(`a ${shape} marker resolves back to the day it was written on`, () => {
			const marker = renderTimeMarker(NOW, shape);
			const out = resolveDay({ messages: [marker], mode: 'marker', manual: 1, today: 0 });
			expect(out).toMatchObject({ day: todaySerial(NOW), source: 'time-marker' });
		});
	}

	test('the marker inside the instruction block parses too, not just a bare one', () => {
		// The block is prose around a marker, and prose is where a parser goes wrong.
		const block = inject() as string;
		const out = resolveDay({ messages: [block], mode: 'marker', manual: 1, today: 0 });
		expect(out.day).toBe(todaySerial(NOW));
	});

	test('it holds across a run of days, not just the one the suite was written on', () => {
		for (let offset = 0; offset < 400; offset += 7) {
			const at = new Date(2026, 0, 1 + offset, 9, 30);
			const marker = renderTimeMarker(at, 'visible');
			const out = resolveDay({ messages: [marker], mode: 'marker', manual: 1, today: 0 });
			expect(out.day).toBe(todaySerial(at));
		}
	});
});

describe('when it says nothing', () => {
	test('manual mode injects nothing at all', () => {
		// A reader driving the day with /day has not asked to be told the real date, and
		// would be actively misled by one.
		expect(inject({ mode: 'manual' })).toBeNull();
	});

	test('marker mode injects a block', () => {
		expect(inject({ mode: 'marker' })).toContain('6:02 PM');
	});
});

describe('the block itself', () => {
	test('states the current time and asks for the same shape back', () => {
		const block = inject({ shape: 'visible' }) as string;
		expect(block).toContain(renderTimeMarker(NOW, 'visible'));
		expect(block).toContain('<Time: h:mm AM/PM, Weekday Month D, YYYY>');
	});

	test('the example follows the shape setting, or the model is told the wrong thing', () => {
		const block = inject({ shape: 'hidden' }) as string;
		expect(block).toContain('<!-- Time: h:mm AM/PM, Weekday Month D, YYYY -->');
		expect(block).not.toContain('<Time: h:mm');
	});

	test('it says what to do when story time has moved, which a clock cannot know', () => {
		const block = inject() as string;
		expect(block.toLowerCase()).toContain('gap');
	});

	test('the same input twice gives the same block, which the meter and the send rely on', () => {
		expect(inject()).toBe(inject());
	});
});

describe('the stored slice', () => {
	test('a chat that has never been asked reads as visible', () => {
		expect(defaultDateFrameworkState()).toEqual({ shape: 'visible' });
		expect(normalizeDateFrameworkState(undefined)).toEqual({ shape: 'visible' });
	});

	test('anything unusable degrades rather than throwing', () => {
		for (const raw of [null, 'hidden', [], 7, { shape: 'sideways' }]) {
			expect(normalizeDateFrameworkState(raw)).toEqual({ shape: 'visible' });
		}
	});

	test('a stored shape comes back', () => {
		expect(normalizeDateFrameworkState({ shape: 'hidden' })).toEqual({ shape: 'hidden' });
	});
});

describe('the framework claims no marker', () => {
	test('it is registered by default, unlike every other framework', () => {
		expect(FRAMEWORKS.map((f) => f.id)).toContain(DATE_FRAMEWORK_ID);
	});

	test('it has no compute, because there is no per-character question to ask', () => {
		expect(DATE_FRAMEWORK.compute).toBeUndefined();
	});

	test('a marker addressed to it reads as noOutput, not as an unknown framework', () => {
		// The framework exists and simply has nothing to say. `unknownFramework` would send
		// someone hunting for a misspelling that is not there.
		const out = applyFrameworks('@date[anything]', {
			frameworks: FRAMEWORKS,
			disabled: [],
			day: 1,
			suppressed: [],
			byFramework: {}
		});
		expect(out.records[0].status).toBe('noOutput');
		expect(out.text).toBe('');
	});
});

describe('how the block reaches the prompt', () => {
	test('manual mode contributes no book, so nothing empty rides the trace', () => {
		expect(frameworkBooks(chatState({ mode: 'manual' }), [], NOW)).toEqual([]);
	});

	test('a surface with no chat contributes nothing either', () => {
		expect(frameworkBooks(undefined, [], NOW)).toEqual([]);
	});

	test('marker mode contributes one constant entry, addressed to the model', () => {
		const [book] = frameworkBooks(chatState({ mode: 'marker' }), [], NOW);
		expect(book.id).toBe(FRAMEWORK_BOOK_ID);
		expect(book.entries).toHaveLength(1);
		// Constant: it is addressed to the model, so there is nothing for a key to match on.
		expect(book.entries[0].constant).toBe(true);
		expect(book.entries[0].key).toEqual([]);
	});

	test('the entry id is stable across runs, so a trace can be read back to its author', () => {
		const first = frameworkBooks(chatState({ mode: 'marker' }), [], NOW)[0];
		const second = frameworkBooks(chatState({ mode: 'marker' }), [], NOW)[0];
		expect(first.entries[0].id).toBe(second.entries[0].id);
		expect(first.entries[0].id).toBe(`framework:${DATE_FRAMEWORK_ID}`);
	});

	test('it lands at depth zero: an instruction about THIS reply is worth nothing four turns up', () => {
		const [book] = frameworkBooks(chatState({ mode: 'marker' }), [], NOW);
		expect(book.entries[0].depth).toBe(0);
	});

	test('the shape setting rides through from the chat slice', () => {
		const state = chatState({ mode: 'marker', byFramework: { date: { shape: 'hidden' } } });
		const [book] = frameworkBooks(state, [], NOW);
		expect(book.entries[0].content).toContain('<!-- Time: 6:02 PM');
	});

	test('the block actually comes out of the lorebook resolver', () => {
		// Through the real engine, because riding that pipeline is the whole point: placed,
		// priced and traced like any other injected line rather than spliced in beside it.
		const books = frameworkBooks(chatState({ mode: 'marker' }), [], NOW);
		const out = resolveLorebooks({
			books,
			messages: [],
			decorate: (_entry, text) => text,
			placeAtDepth: true
		});
		expect(out.placed).toHaveLength(1);
		expect(out.placed[0].depth).toBe(0);
		expect(out.placed[0].text).toContain('6:02 PM, Saturday October 10, 2026');
	});

	test('with no chat history to splice into, it joins the block rather than vanishing', () => {
		// placeAtDepth false is a surface that cannot splice turns. An at-depth entry has to
		// fall back to the block there, or it lands in a position nothing renders.
		const books = frameworkBooks(chatState({ mode: 'marker' }), [], NOW);
		const out = resolveLorebooks({ books, messages: [], decorate: (_e, t) => t });
		expect(out.placed).toHaveLength(0);
		expect(out.text).toContain('6:02 PM, Saturday October 10, 2026');
	});
});
