/**
 * The date framework: it tells the model what time it is.
 *
 * It is the counterpart to `marker` mode in the base, and the reason that mode can exist:
 * nothing else knows the wall clock, and an instruction addressed to the model belongs to no
 * lorebook entry and no character, so the base has no way to write one.
 *
 * **Nothing here is read back.** The marker the model is asked to write is for the reader to
 * look at, and for nothing else: the framework already knows the time, so parsing its own
 * output back out of the transcript would be a long way round to a number it just handed over.
 * That is worth stating loudly because it is what keeps the instructions short. A large part
 * of a hand-written version of this text exists to make the marker machine-readable, and none
 * of that is needed: the model may write it in any shape it likes, or forget to, and the day
 * is unaffected.
 *
 * It answers no marker of its own. What day it is, is one fact about the whole story, and the
 * base already owns it; there is no per-character question to ask.
 *
 * **In `manual` mode it says nothing at all.** A reader driving the day by hand has not asked
 * to be told the real date and would be actively misled by one, so the block is absent rather
 * than present-and-ignored.
 *
 * Pure, like every framework: the clock arrives in the input.
 *
 * See architecture/frameworks.md.
 */
import { formatClock, formatLongDate, formatWeekday } from '$lib/macros';

import type { FrameworkBlockDef } from '../blocks';
import type { FrameworkDef } from '../types';

export const DATE_FRAMEWORK_ID = 'date';

/**
 * Whether the marker the model is asked for is readable in the transcript.
 *
 * `visible` is `<Time: ...>`, which markdown escapes and draws as written. `hidden` is
 * `<!-- Time: ... -->`, an HTML comment, which the renderer emits as a comment node and no
 * browser draws.
 *
 * It is a purely cosmetic choice, and only became one when the parsing went: the marker is
 * something the reader keeps an eye on, so the only question is whether they want to see it.
 */
export type MarkerShape = 'visible' | 'hidden';

/** This framework's slice of ONE CHAT's state, under `byFramework.date`. One key, both of the
 *  per-chat settings, so a chat that has opted in stores a single small object. */
export interface DateChatState {
	/** Whether this story runs on the reader's calendar. Mirrors `ChatFrameworkState`'s day
	 *  mode, which the base reads; kept here because it is this framework's to present. */
	shape: MarkerShape;
}

export function defaultDateChatState(): DateChatState {
	return { shape: 'visible' };
}

/**
 * Read the per-chat slice back, degrading to the default rather than throwing.
 *
 * The base guarantees only that a slice is a plain object or absent (chat-state.ts), so
 * normalizing the inside of it is this framework's own job.
 */
export function normalizeDateChatState(raw: unknown): DateChatState {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultDateChatState();
	const shape = (raw as Record<string, unknown>).shape;
	return { shape: shape === 'hidden' ? 'hidden' : 'visible' };
}

/**
 * The placeholders the instruction template understands.
 *
 * A short, fixed list, and that is a real limit rather than an oversight: an injected block is
 * the one text in a prompt that macro expansion never reaches, because entry content is
 * expanded and THEN decorated. So this framework substitutes its own, and a `{{char}}` typed
 * into the box would ship those braces to the model verbatim.
 *
 * The names are the app's own clock macros deliberately, because that is what anyone writing
 * this text will type from habit.
 */
export const DATE_PLACEHOLDERS = ['{{time}}', '{{weekday}}', '{{date}}', '{{marker}}'] as const;

/**
 * The placeholders whose absence makes the block pointless, for the editor's warning.
 *
 * A template that never says what time it is has quietly stopped doing the one thing this
 * framework is for, while still looking like a page of sensible instructions. Same rule, and
 * the same gentle half of it, as `EnginePromptField.requires`.
 */
export const DATE_REQUIRED_PLACEHOLDERS = ['{{time}}', '{{date}}'] as const;

export const DEFAULT_DATE_INSTRUCTIONS = `The current real time is {{time}}, {{weekday}} {{date}}. This is the canonical "now": it takes precedence over the story's own sense of time and over simply continuing from where the last reply stopped.

Begin your reply with a time marker, before any narration:

{{marker}}

Then measure the gap between the previous reply's time and the current real time, and follow it:

- Under 30 minutes: continue the current scene from the real time. No recap.
- 30 minutes to 8 hours: one or two sentences bridging the gap, then carry on.
- Over 8 hours, or a different day: recap what happened in between, then open a new scene with the characters in the place, state and clothes that hour calls for. The focus may move to different characters.

Do not stretch the previous scene across a long gap. Cut to the real time instead.

Write the scene the hour actually calls for. Late night is dim and slow and people are in nightwear or already asleep; early morning is groggy; mornings are routines and daylight; evenings wind down. A single reply covers a few minutes of story time, so do not race the clock forward within it.`;

/** The reminder line, for the section a reminders framework gathers. One sentence: it is a
 *  nudge for a model that has read the instructions and drifted, not a second copy of them. */
export const DEFAULT_DATE_REMINDER =
	'The current real time is {{time}}, {{weekday}} {{date}}. This takes precedence over simply continuing from the last reply.';

/**
 * One time marker, in the shape asked for.
 *
 * Built from the same formatters `{{time}}`, `{{weekday}}` and `{{date}}` use, so the marker
 * this writes and a marker a preset writes by hand are the same string. Two copies of
 * `toLocaleDateString('en-US', ...)` would drift the first time either was tidied.
 *
 * The weekday is redundant against the date and is written anyway: it gives the model a second
 * reading of the same fact to check itself against, and models are noticeably worse at naming
 * the weekday for a bare ISO date.
 */
export function renderTimeMarker(at: Date, shape: MarkerShape): string {
	const body = `Time: ${formatClock(at)}, ${formatWeekday(at)} ${formatLongDate(at)}`;
	return shape === 'hidden' ? `<!-- ${body} -->` : `<${body}>`;
}

/** Substitute this framework's placeholders. Nothing else is touched, so an unknown macro
 *  survives as written rather than becoming an empty string that hides the mistake. */
export function fillDateTemplate(template: string, at: Date, shape: MarkerShape): string {
	return template
		.replaceAll('{{marker}}', renderTimeMarker(at, shape))
		.replaceAll('{{time}}', formatClock(at))
		.replaceAll('{{weekday}}', formatWeekday(at))
		.replaceAll('{{date}}', formatLongDate(at));
}


export const DATE_BLOCKS: readonly FrameworkBlockDef[] = [
	{
		slot: 'instructions',
		label: 'Instructions',
		hint: 'Sent every turn while this chat is on real time.',
		defaultText: DEFAULT_DATE_INSTRUCTIONS,
		placeholders: DATE_PLACEHOLDERS,
		required: DATE_REQUIRED_PLACEHOLDERS,
		gate: true,
		defaultOn: true,
		alwaysOn: true,
		placement: { atDepth: false, depth: 0, role: 'system', order: 0 }
	},
	{
		slot: 'reminder',
		label: 'Reminder',
		hint: 'One line in the Reminders section, for a model that has drifted. Needs the Reminders framework; without it nothing is sent.',
		defaultText: DEFAULT_DATE_REMINDER,
		placeholders: DATE_PLACEHOLDERS,
		gate: false,
		defaultOn: false,
		reminder: true
	}
];

export const DATE_FRAMEWORK: FrameworkDef = {
	id: DATE_FRAMEWORK_ID,
	// One word, because the XML gate around the injected block is named for it and
	// `<Date and time>` is not a tag anyone wants to read.
	name: 'Date',
	icon: 'clock',
	summary: 'Tells the model the current real time, and how to handle a gap since the last reply.',
	description:
		'In real-time mode, injects the current time and instructions for what to do when the ' +
		'story has been away for a while. The marker it asks for is for you to read: nothing ' +
		'parses it back. Says nothing in manual mode, where /day drives the day instead.',
	blocks: DATE_BLOCKS,
	/**
	 * Nothing at all in manual mode.
	 *
	 * A reader driving the day by hand has not asked to be told the real date and would be
	 * actively misled by one, so the blocks are absent rather than present-and-ignored. Blank
	 * text is how a declared block says "not this time"; the base drops it.
	 */
	fill(text, input) {
		if (input.mode !== 'marker') return '';
		const { shape } = normalizeDateChatState(input.state);
		return fillDateTemplate(text, input.now, shape);
	}
};
