/**
 * The date framework: it tells the model what time it is, and asks for that back.
 *
 * It is the counterpart to `marker` mode in the base. `day.ts` knows how to READ a
 * `<Time: ...>` marker; nothing writes one, and the base cannot, because an instruction
 * addressed to the model belongs to no lorebook entry and no character. That gap is what this
 * fills, and it is why the framework is registered by default rather than being optional the
 * way a tracker is: a mode the base offers with nothing able to satisfy it is half a feature.
 *
 * It answers no marker at all. There is no `@date[...]`, because there is no per-character
 * question to ask: what day it is, is one fact about the whole story, and the base already
 * owns it. What this contributes is the instruction, and the current time to anchor it.
 *
 * **In `manual` mode it says nothing.** A reader driving the day with `/day` has not asked to
 * be told the real date and would be actively misled by one, so the block is absent rather
 * than present-and-ignored.
 *
 * Pure, like every framework: the clock arrives in the input.
 *
 * See architecture/frameworks.md.
 */
import { formatClock, formatLongDate, formatWeekday } from '$lib/macros';

import type { FrameworkDef, FrameworkInjectInput } from '../types';

export const DATE_FRAMEWORK_ID = 'date';

/**
 * Whether the marker the model is asked for is readable in the transcript.
 *
 * `visible` is `<Time: ...>`, which markdown escapes and draws as written. `hidden` is
 * `<!-- Time: ... -->`, an HTML comment, which the renderer emits as a comment node and no
 * browser draws: the marker still reaches the prompt and still reaches the parser, and only
 * the reader stops seeing it.
 *
 * This is the ONLY thing the setting changes. Both shapes are read forever (day.ts), so a
 * reader who switches keeps every day their older turns already stated.
 */
export type MarkerShape = 'visible' | 'hidden';

/** This framework's slice of the chat's state, under `byFramework.date`. */
export interface DateFrameworkState {
	shape: MarkerShape;
}

/** The slice a chat has when it has never been asked. Visible, because a marker a reader can
 *  see is a marker they can tell has stopped being written. */
export function defaultDateFrameworkState(): DateFrameworkState {
	return { shape: 'visible' };
}

/**
 * Read the slice back, degrading to the default rather than throwing.
 *
 * The base guarantees only that a slice is a plain object or absent (chat-state.ts), so
 * normalizing the inside of it is this framework's own job.
 */
export function normalizeDateFrameworkState(raw: unknown): DateFrameworkState {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultDateFrameworkState();
	const shape = (raw as Record<string, unknown>).shape;
	return { shape: shape === 'hidden' ? 'hidden' : 'visible' };
}

/**
 * One time marker, in the shape asked for.
 *
 * The body is identical between the two, which is what lets day.ts read both with one
 * alternation and lets a reader switch without losing their history. It is built from the
 * same formatters `{{time}}`, `{{weekday}}` and `{{date}}` use, so the marker written here and
 * a marker a preset writes by hand are the same string.
 *
 * The weekday is redundant against the date and is written anyway: it gives the model a second
 * reading of the same fact to check itself against, and models are noticeably worse at naming
 * the weekday for a bare ISO date than for a long-form one. day.ts ignores it and reads only
 * the date, so a model that gets it wrong costs nothing.
 */
export function renderTimeMarker(at: Date, shape: MarkerShape): string {
	const body = `Time: ${formatClock(at)}, ${formatWeekday(at)} ${formatLongDate(at)}`;
	return shape === 'hidden' ? `<!-- ${body} -->` : `<${body}>`;
}

/** The shape, written out as the model has to type it. */
function shapeExample(shape: MarkerShape): string {
	const body = 'Time: h:mm AM/PM, Weekday Month D, YYYY';
	return shape === 'hidden' ? `<!-- ${body} -->` : `<${body}>`;
}

/**
 * The block, or null when there is nothing to say.
 *
 * Written as an instruction rather than as lore because that is what it is. It states the
 * current time, asks for the same shape back, and says what to do when story time has moved:
 * that last part is the one the tracker actually depends on, because a scene that skips three
 * weeks is invisible to a clock and only the model can say it happened.
 *
 * The month is asked for by NAME. day.ts reads the long form only -- its ISO branch is
 * anchored and cannot match inside a marker -- so a model that answers `2026-11-04` produces a
 * marker that parses to nothing and silently stops moving the day.
 */
export function dateInstructions(input: FrameworkInjectInput): string | null {
	if (input.mode !== 'marker') return null;
	const { shape } = normalizeDateFrameworkState(input.state);
	return [
		`The current real-world time is ${renderTimeMarker(input.now, shape)}`,
		'',
		'Begin every reply with a time marker of your own, in exactly this shape:',
		'',
		shapeExample(shape),
		'',
		'Write the month by name, never as digits or in ISO form. Write the weekday that',
		'actually matches the date.',
		'',
		'Carry the time above forward unless the story has moved. When it has -- a scene ends,',
		'characters sleep, a journey takes days, or real time has clearly passed between',
		'replies -- state the NEW time in your marker and account for the gap in the narration',
		'before continuing.'
	].join('\n');
}

export const DATE_FRAMEWORK: FrameworkDef = {
	id: DATE_FRAMEWORK_ID,
	name: 'Date and time',
	summary: 'Tells the model the current time and asks for it back in every reply.',
	description:
		'In marker mode, injects the current real-world time and instructs the model to open ' +
		'each reply with a time marker. The day every framework computes against is read back ' +
		'out of those markers. Says nothing in manual mode, where /day drives the day instead.',
	inject: dateInstructions
};
