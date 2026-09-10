/**
 * Date framework tests. Run with `bun test`.
 *
 * What matters is that the block says what time it is and lands where it was told to. Nothing
 * asserts the marker is parseable, because nothing parses it: it is written for the reader,
 * and the framework already knows the time it just wrote down.
 */

import { describe, expect, test } from 'bun:test';

import { resolveLorebooks } from '$lib/lorebook/engine';

import { frameworkBooks, frameworkEntryId } from '../apply';
import { resolveBlocks } from '../blocks';
import { defaultChatFrameworkState } from '../chat-state';
import { FRAMEWORKS } from '../registry';
import { defaultFrameworkSettings, type FrameworkSettings } from '../settings';
import { applyFrameworks } from '../dispatch';
import {
	DATE_FRAMEWORK,
	DATE_FRAMEWORK_ID,
	DATE_REQUIRED_PLACEHOLDERS,
	DEFAULT_DATE_INSTRUCTIONS,
	fillDateTemplate,
	normalizeDateChatState,
	renderTimeMarker
} from './index';

/** A pinned clock: 6:02 PM, Saturday 10 October 2026. */
const NOW = new Date(2026, 9, 10, 18, 2);

/** An install carrying Date, which every injection case here assumes. */
function available(config: Record<string, unknown> = {}): FrameworkSettings {
	return { ...defaultFrameworkSettings(), enabled: { [DATE_FRAMEWORK_ID]: true }, config };
}

/** A chat that has opted in and is running on real time. */
function realTimeChat(over: Partial<ReturnType<typeof defaultChatFrameworkState>> = {}) {
	return {
		...defaultChatFrameworkState(),
		enabled: [DATE_FRAMEWORK_ID],
		mode: 'marker' as const,
		...over
	};
}

function books(settings: FrameworkSettings = available(), state = realTimeChat()) {
	return frameworkBooks(state, settings, NOW);
}

/** The instruction entry, through the real builder. */
function block(settings?: FrameworkSettings, state?: ReturnType<typeof realTimeChat>) {
	const [book] = books(settings, state);
	return book?.entries.find((e) => e.id === frameworkEntryId(DATE_FRAMEWORK_ID, 'instructions'));
}

/** One block's stored-settings shape, so a test can set a field without restating the rest. */
function withBlock(slot: string, patch: Record<string, unknown>) {
	return available({ [DATE_FRAMEWORK_ID]: { blocks: { [slot]: patch } } });
}

describe('the marker', () => {
	test('the visible shape is what markdown draws as written', () => {
		expect(renderTimeMarker(NOW, 'visible')).toBe('<Time: 6:02 PM, Saturday October 10, 2026>');
	});

	test('the hidden shape is an HTML comment, which no browser draws', () => {
		expect(renderTimeMarker(NOW, 'hidden')).toBe('<!-- Time: 6:02 PM, Saturday October 10, 2026 -->');
	});

	test('the two carry an identical body, so the choice is purely cosmetic', () => {
		const visible = renderTimeMarker(NOW, 'visible');
		expect(renderTimeMarker(NOW, 'hidden')).toBe(`<!-- ${visible.slice(1, -1)} -->`);
	});
});

describe('the template', () => {
	test('the placeholders are substituted, because macro expansion never reaches this text', () => {
		const filled = fillDateTemplate('{{time}} / {{weekday}} / {{date}} / {{marker}}', NOW, 'visible');
		expect(filled).toBe(
			'6:02 PM / Saturday / October 10, 2026 / <Time: 6:02 PM, Saturday October 10, 2026>'
		);
	});

	test('an unknown macro survives as written rather than becoming an empty string', () => {
		// Blanking it would hide the mistake; leaving it lets the reader see what they typed.
		expect(fillDateTemplate('{{char}} at {{time}}', NOW, 'visible')).toBe('{{char}} at 6:02 PM');
	});

	test('the marker follows the chat shape, so the model is asked for what the reader wants', () => {
		const hidden = realTimeChat({ byFramework: { [DATE_FRAMEWORK_ID]: { shape: 'hidden' } } });
		expect(block(available(), hidden)?.content).toContain('<!-- Time: 6:02 PM');
		expect(block()?.content).toContain('<Time: 6:02 PM');
	});

	test('the shipped default says what time it is, which is the whole job', () => {
		for (const placeholder of DATE_REQUIRED_PLACEHOLDERS) {
			expect(DEFAULT_DATE_INSTRUCTIONS).toContain(placeholder);
		}
	});

	test('the shipped default carries the gap rule, which is what it is actually for', () => {
		expect(DEFAULT_DATE_INSTRUCTIONS).toContain('30 minutes');
		expect(DEFAULT_DATE_INSTRUCTIONS).toContain('8 hours');
	});

	test('an edited template is used verbatim, placeholders and all', () => {
		const entry = block(withBlock('instructions', { text: 'It is {{time}}.' }));
		expect(entry?.content).toContain('It is 6:02 PM.');
	});
});

describe('what it declares', () => {
	test('it is registered by default, unlike a framework on its own branch', () => {
		expect(FRAMEWORKS.map((f) => f.id)).toContain(DATE_FRAMEWORK_ID);
	});

	test('it has no compute, because there is no per-character question to ask', () => {
		expect(DATE_FRAMEWORK.compute).toBeUndefined();
	});

	test('its name is one word, because the XML gate is named for it', () => {
		expect(DATE_FRAMEWORK.name).not.toContain(' ');
	});

	test('the instructions are on by default and the reminder is not', () => {
		// A reminder is a cost paid every turn, and which systems a model keeps forgetting is
		// not something anything here can guess.
		const declared = resolveBlocks(DATE_FRAMEWORK.blocks, undefined);
		expect(declared.find((b) => b.def.slot === 'instructions')?.on).toBe(true);
		expect(declared.find((b) => b.def.slot === 'instructions')?.def.alwaysOn).toBe(true);
		expect(declared.find((b) => b.def.slot === 'reminder')?.on).toBe(false);
	});

	test('a marker addressed to it reads as noOutput, not as an unknown framework', () => {
		const out = applyFrameworks(`@${DATE_FRAMEWORK_ID}[anything]`, {
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

describe('when it says nothing', () => {
	test('manual mode injects nothing', () => {
		// A reader driving the day by hand has not asked to be told the real date.
		expect(books(available(), realTimeChat({ mode: 'manual' }))).toEqual([]);
	});

	test('a chat that has not opted in gets nothing, even with Date available', () => {
		expect(books(available(), realTimeChat({ enabled: [] }))).toEqual([]);
	});

	test('a chat that opted in gets nothing while the install has Date off', () => {
		expect(books(defaultFrameworkSettings())).toEqual([]);
	});

	test('a surface with no chat gets nothing rather than assuming a story', () => {
		expect(frameworkBooks(undefined, available(), NOW)).toEqual([]);
	});

	test('the instructions cannot be switched off on their own, because they ARE the framework', () => {
		// A stored `off` from an older build is ignored rather than honoured: Date with its
		// instructions off is Date doing nothing, which is what turning Date off is for, and a
		// second switch for one decision leaves a state where it looks on and does nothing.
		expect(block(withBlock('instructions', { on: false }))).toBeDefined();
	});

	test('an optional block DOES honour its switch', () => {
		// The reminder is the case the switch exists for: wanting the framework without
		// wanting it to spend tokens nagging every turn is a real preference.
		const declared = resolveBlocks(DATE_FRAMEWORK.blocks, { blocks: { reminder: { on: false } } });
		expect(declared.find((b) => b.def.slot === 'reminder')?.on).toBe(false);
	});
});

describe('where the block lands', () => {
	test('the default is the lorebook block, where a standing instruction belongs', () => {
		const entry = block();
		expect(entry?.position).toBeUndefined();
		expect(entry?.constant).toBe(true);
	});

	test('opting into the chat splices it there instead', () => {
		const entry = block(withBlock('instructions', { atDepth: true, depth: 3, role: 'user' }));
		expect(entry?.position).toBeDefined();
		expect(entry?.depth).toBe(3);
		expect(entry?.role).toBe(1);
	});

	test('the entry id is stable across runs, so a trace row names its author', () => {
		expect(block()?.id).toBe(frameworkEntryId(DATE_FRAMEWORK_ID, 'instructions'));
	});

	test('the content is gated in a tag named for the framework', () => {
		const content = block()?.content ?? '';
		expect(content.startsWith('<Date>\n')).toBe(true);
		expect(content.endsWith('\n</Date>')).toBe(true);
	});
});

describe('the per-chat slice', () => {
	test('a chat that has never been asked reads as visible', () => {
		expect(normalizeDateChatState(undefined)).toEqual({ shape: 'visible' });
	});

	test('anything unusable degrades rather than throwing', () => {
		for (const raw of [null, 'hidden', [], 7, { shape: 'sideways' }]) {
			expect(normalizeDateChatState(raw)).toEqual({ shape: 'visible' });
		}
	});

	test('a stored shape comes back', () => {
		expect(normalizeDateChatState({ shape: 'hidden' })).toEqual({ shape: 'hidden' });
	});
});

describe('reaching the prompt through the lorebook pipeline', () => {
	test('by default it joins the block, even where the caller COULD splice', () => {
		const out = resolveLorebooks({
			books: books(),
			messages: [],
			decorate: (_entry, text) => text,
			placeAtDepth: true
		});
		expect(out.placed).toHaveLength(0);
		expect(out.text).toContain('6:02 PM, Saturday October 10, 2026');
	});

	test('it comes out placed at its depth when the reader asked for that', () => {
		const out = resolveLorebooks({
			books: books(withBlock('instructions', { atDepth: true })),
			messages: [],
			decorate: (_entry, text) => text,
			placeAtDepth: true
		});
		expect(out.placed).toHaveLength(1);
		expect(out.placed[0].depth).toBe(0);
	});

	test('the same inputs twice give the same text, which the meter and the send rely on', () => {
		const once = resolveLorebooks({ books: books(), messages: [], decorate: (_e, t) => t });
		const twice = resolveLorebooks({ books: books(), messages: [], decorate: (_e, t) => t });
		expect(once.text).toBe(twice.text);
	});
});
