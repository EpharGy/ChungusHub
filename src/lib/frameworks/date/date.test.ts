/**
 * Date framework tests. Run with `bun test`.
 *
 * What matters here is that the block says what time it is and lands where it was told to.
 * Nothing asserts that the marker is parseable, because nothing parses it: it is written for
 * the reader, and the framework already knows the time it just wrote down.
 */

import { describe, expect, test } from 'bun:test';

import { resolveLorebooks } from '$lib/lorebook/engine';

import { frameworkBooks, frameworkEntryId } from '../apply';
import { defaultChatFrameworkState } from '../chat-state';
import { FRAMEWORKS } from '../registry';
import { defaultFrameworkSettings, type FrameworkSettings } from '../settings';
import { applyFrameworks } from '../dispatch';
import {
	DATE_FRAMEWORK,
	DATE_FRAMEWORK_ID,
	DATE_REQUIRED_PLACEHOLDERS,
	DEFAULT_DATE_INSTRUCTIONS,
	defaultDateSettings,
	fillDateTemplate,
	normalizeDateChatState,
	normalizeDateSettings,
	renderTimeMarker,
	type MarkerShape
} from './index';

/** A pinned clock: 6:02 PM, Saturday 10 October 2026. */
const NOW = new Date(2026, 9, 10, 18, 2);

/** An install with Date available, which is what every injection case here assumes. */
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

function inject(
	settings: FrameworkSettings = available(),
	state = realTimeChat()
): ReturnType<typeof frameworkBooks> {
	return frameworkBooks(state, settings, NOW);
}

/** The one entry the date framework contributes, through the real builder. */
function block(settings?: FrameworkSettings, state?: ReturnType<typeof realTimeChat>) {
	const [book] = inject(settings, state);
	return book?.entries[0];
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
		// Entry content is expanded and THEN decorated, so a framework emitting {{date}} would
		// ship those braces to the model. This framework fills its own.
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
});

describe('the app-wide settings', () => {
	test('an absent blob reads as the defaults', () => {
		expect(normalizeDateSettings(undefined)).toEqual(defaultDateSettings());
		expect(normalizeDateSettings('nonsense')).toEqual(defaultDateSettings());
		expect(normalizeDateSettings([])).toEqual(defaultDateSettings());
	});

	test('an empty template reads as unset, not as "inject nothing"', () => {
		// A reader who wants nothing injected turns the framework off. That control says so;
		// an empty box does not, and would look identical to a save that went wrong.
		expect(normalizeDateSettings({ instructions: '   ' }).instructions).toBe(DEFAULT_DATE_INSTRUCTIONS);
	});

	test('a stored template comes back verbatim', () => {
		expect(normalizeDateSettings({ instructions: 'mine' }).instructions).toBe('mine');
	});

	test('an unusable role or depth degrades rather than throwing', () => {
		expect(normalizeDateSettings({ role: 'narrator' }).role).toBe('system');
		expect(normalizeDateSettings({ depth: -5 }).depth).toBe(0);
		expect(normalizeDateSettings({ depth: 'deep' }).depth).toBe(defaultDateSettings().depth);
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

describe('when it says nothing', () => {
	test('manual mode injects nothing', () => {
		// A reader driving the day by hand has not asked to be told the real date.
		expect(inject(available(), realTimeChat({ mode: 'manual' }))).toEqual([]);
	});

	test('a chat that has not opted in gets nothing, even with Date available', () => {
		expect(inject(available(), realTimeChat({ enabled: [] }))).toEqual([]);
	});

	test('a chat that opted in gets nothing while the install has Date off', () => {
		// Two switches, and the install one is the outer bound.
		expect(inject(defaultFrameworkSettings())).toEqual([]);
	});

	test('a surface with no chat gets nothing rather than assuming a story', () => {
		expect(frameworkBooks(undefined, available(), NOW)).toEqual([]);
	});
});

describe('where the block lands', () => {
	test('the default is hard against the generation point, as a system turn', () => {
		// An instruction about what to write in THIS reply is worth nothing four turns up.
		const entry = block();
		expect(entry?.depth).toBe(0);
		expect(entry?.role).toBe(0);
		expect(entry?.constant).toBe(true);
	});

	test('placement follows the app-wide setting', () => {
		const entry = block(available({ [DATE_FRAMEWORK_ID]: { depth: 3, role: 'user' } }));
		expect(entry?.depth).toBe(3);
		expect(entry?.role).toBe(1);
	});

	test('the block position joins the lorebook block instead of the chat', () => {
		const entry = block(available({ [DATE_FRAMEWORK_ID]: { atDepth: false } }));
		expect(entry?.position).toBeUndefined();
	});

	test('the entry id is stable across runs, so a trace row names its author', () => {
		expect(block()?.id).toBe(frameworkEntryId(DATE_FRAMEWORK_ID, 'instructions'));
		expect(block()?.id).toBe(inject()[0].entries[0].id);
	});

	test('the content is gated in a tag named for the framework', () => {
		// Generated rather than typed into the template: a reader editing instructions should
		// not have to remember to close a tag, and a mismatched pair is worse than none.
		const content = block()?.content ?? '';
		expect(content.startsWith('<Date>\n')).toBe(true);
		expect(content.endsWith('\n</Date>')).toBe(true);
	});
});

describe('the framework itself', () => {
	test('it is registered by default, unlike every other framework', () => {
		expect(FRAMEWORKS.map((f) => f.id)).toContain(DATE_FRAMEWORK_ID);
	});

	test('it has no compute, because there is no per-character question to ask', () => {
		expect(DATE_FRAMEWORK.compute).toBeUndefined();
	});

	test('its name is one word, because the XML gate is named for it', () => {
		expect(DATE_FRAMEWORK.name).not.toContain(' ');
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

describe('reaching the prompt through the lorebook pipeline', () => {
	test('it comes out placed at its depth', () => {
		// Through the real engine, because riding that pipeline is the whole point: placed,
		// priced and traced like any other injected line rather than spliced in beside it.
		const out = resolveLorebooks({
			books: inject(),
			messages: [],
			decorate: (_entry, text) => text,
			placeAtDepth: true
		});
		expect(out.placed).toHaveLength(1);
		expect(out.placed[0].depth).toBe(0);
		expect(out.placed[0].text).toContain('6:02 PM, Saturday October 10, 2026');
	});

	test('with no chat history to splice into, it joins the block rather than vanishing', () => {
		const out = resolveLorebooks({ books: inject(), messages: [], decorate: (_e, t) => t });
		expect(out.placed).toHaveLength(0);
		expect(out.text).toContain('6:02 PM, Saturday October 10, 2026');
	});

	test('the same inputs twice give the same text, which the meter and the send rely on', () => {
		const once = resolveLorebooks({ books: inject(), messages: [], decorate: (_e, t) => t });
		const twice = resolveLorebooks({ books: inject(), messages: [], decorate: (_e, t) => t });
		expect(once.text).toBe(twice.text);
	});
});

describe('the shapes a reader can pick', () => {
	for (const shape of ['visible', 'hidden'] as const) {
		test(`${shape} produces a marker inside the injected block`, () => {
			const state = realTimeChat({ byFramework: { [DATE_FRAMEWORK_ID]: { shape } } });
			expect(block(available(), state)?.content).toContain(
				renderTimeMarker(NOW, shape as MarkerShape)
			);
		});
	}
});
