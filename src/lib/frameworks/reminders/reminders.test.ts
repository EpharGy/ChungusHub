/**
 * Reminders tests. Run with `bun test`.
 *
 * The behaviour worth guarding is what happens when the pieces are NOT all present: a
 * reminder with nothing to gather it, a section with nothing to put in it, a framework whose
 * reminder is off. Each of those has a wrong answer that looks fine in a prompt, which is the
 * kind that survives a long time.
 */

import { describe, expect, test } from 'bun:test';

import { frameworkBooks, frameworkEntryId } from '../apply';
import { defaultChatFrameworkState } from '../chat-state';
import { DATE_FRAMEWORK_ID, DEFAULT_DATE_REMINDER } from '../date';
import { defaultFrameworkSettings, type FrameworkSettings } from '../settings';
import {
	DEFAULT_REMINDERS_TEMPLATE,
	REMINDERS_FRAMEWORK,
	REMINDERS_FRAMEWORK_ID,
	REMINDERS_PLACEHOLDER
} from './index';

const NOW = new Date(2026, 9, 10, 18, 2);

/** An install carrying both, and a chat on real time using both. */
function install(config: Record<string, unknown> = {}, ...ids: string[]): FrameworkSettings {
	return {
		...defaultFrameworkSettings(),
		enabled: Object.fromEntries((ids.length ? ids : [DATE_FRAMEWORK_ID, REMINDERS_FRAMEWORK_ID]).map((i) => [i, true])),
		config
	};
}

function chat(...ids: string[]) {
	return {
		...defaultChatFrameworkState(),
		enabled: ids.length ? ids : [DATE_FRAMEWORK_ID, REMINDERS_FRAMEWORK_ID],
		mode: 'marker' as const
	};
}

/** Date's reminder switched on, which it is not by default. */
const REMINDER_ON = { [DATE_FRAMEWORK_ID]: { blocks: { reminder: { on: true } } } };

function section(settings: FrameworkSettings, state = chat()) {
	const [book] = frameworkBooks(state, settings, NOW);
	return book?.entries.find((e) => e.id === frameworkEntryId(REMINDERS_FRAMEWORK_ID, 'section'));
}

describe('gathering', () => {
	test('a framework reminder lands inside the section', () => {
		const content = section(install(REMINDER_ON))?.content ?? '';
		expect(content).toContain('<Reminders>');
		expect(content).toContain('</Reminders>');
		expect(content).toContain('6:02 PM');
	});

	test('the gathered line is FILLED by the framework that owns it, not sent raw', () => {
		// The line is that framework's text with that framework's placeholders resolved. A
		// section that gathered the template instead would ship braces to the model.
		const content = section(install(REMINDER_ON))?.content ?? '';
		expect(content).not.toContain('{{time}}');
		expect(DEFAULT_DATE_REMINDER).toContain('{{time}}');
	});

	test('the placeholder is where the lines go, and nothing else survives it', () => {
		expect(DEFAULT_REMINDERS_TEMPLATE).toContain(REMINDERS_PLACEHOLDER);
		expect(section(install(REMINDER_ON))?.content).not.toContain(REMINDERS_PLACEHOLDER);
	});

	test('an edited section template still gathers', () => {
		const settings = install({
			...REMINDER_ON,
			[REMINDERS_FRAMEWORK_ID]: { blocks: { section: { text: `[Keep in mind]\n${REMINDERS_PLACEHOLDER}` } } }
		});
		const content = section(settings)?.content ?? '';
		expect(content.startsWith('[Keep in mind]')).toBe(true);
		expect(content).toContain('6:02 PM');
	});
});

describe('a reminder needs everything its framework needs', () => {
	// It is not a separate channel with looser rules: it goes only when the framework that
	// owns it would have spoken anyway. Date's fill returns empty for EVERY one of its blocks
	// in manual mode, and the gathering pass drops empty text, so all three conditions hold
	// without any of them being written down twice.

	test('manual mode sends no date reminder, even with everything switched on', () => {
		const manual = { ...chat(), mode: 'manual' as const };
		expect(section(install(REMINDER_ON), manual)).toBeUndefined();
	});

	test('a chat that has not ticked Date sends none either', () => {
		expect(section(install(REMINDER_ON), chat(REMINDERS_FRAMEWORK_ID))).toBeUndefined();
	});

	test('an install without Date sends none either', () => {
		const settings = install(REMINDER_ON, REMINDERS_FRAMEWORK_ID);
		expect(section(settings)).toBeUndefined();
	});

	test('all three together is what actually sends it', () => {
		expect(section(install(REMINDER_ON))?.content).toContain('6:02 PM');
	});
});

describe('when a piece is missing', () => {
	test('nothing to gather means no section at all, not empty tags', () => {
		// Empty tags tell the model there is a system here and then say nothing about it,
		// which is worse than silence.
		expect(section(install())).toBeUndefined();
	});

	test("a reminder with nothing gathering it is dropped, not injected bare", () => {
		// Outside its section a lone line is noise rather than a reminder.
		const settings = install(REMINDER_ON, DATE_FRAMEWORK_ID);
		const [book] = frameworkBooks(chat(DATE_FRAMEWORK_ID), settings, NOW);
		const texts = (book?.entries ?? []).map((e) => e.content).join('\n');
		expect(texts).not.toContain('takes precedence over simply continuing');
	});

	test('a reminder is off by default, so turning Reminders on sends nothing on its own', () => {
		// A reminder is a cost paid every turn. Which systems a given model keeps forgetting is
		// not something this can guess, so nothing opts in for the reader.
		expect(section(install())).toBeUndefined();
	});

	test('the instructions are unaffected by any of it', () => {
		const [book] = frameworkBooks(chat(), install(), NOW);
		const instructions = book?.entries.find(
			(e) => e.id === frameworkEntryId(DATE_FRAMEWORK_ID, 'instructions')
		);
		expect(instructions?.content).toContain('6:02 PM');
	});
});

describe('where the section sits', () => {
	test('depth 0 by default: a reminder four turns up is a reminder of nothing', () => {
		const entry = section(install(REMINDER_ON));
		expect(entry?.depth).toBe(0);
		expect(entry?.position).toBeDefined();
	});

	test('it carries no generated gate, because its template brings its own tags', () => {
		const content = section(install(REMINDER_ON))?.content ?? '';
		expect(content).not.toContain('<Reminders>\n<Reminders>');
		expect(content.startsWith('<Reminders>')).toBe(true);
	});

	test('the reader can move it, because which position a model reads is not knowable here', () => {
		const settings = install({
			...REMINDER_ON,
			[REMINDERS_FRAMEWORK_ID]: { blocks: { section: { depth: 4, role: 'user' } } }
		});
		const entry = section(settings);
		expect(entry?.depth).toBe(4);
		expect(entry?.role).toBe(1);
	});
});

describe('what it declares', () => {
	test('it answers no marker: it is a place, not a calculation', () => {
		expect(REMINDERS_FRAMEWORK.compute).toBeUndefined();
	});

	test('exactly one of its blocks gathers, or lines would be duplicated', () => {
		expect(REMINDERS_FRAMEWORK.blocks?.filter((b) => b.gathersReminders)).toHaveLength(1);
	});

	test('its own block is not itself a reminder, which would be circular', () => {
		expect(REMINDERS_FRAMEWORK.blocks?.some((b) => b.reminder)).toBe(false);
	});
});
