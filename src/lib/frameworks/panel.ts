/**
 * What a reader-facing panel shows: every marker in play, and what each one does right now.
 *
 * This exists because **a feature whose whole effect can be an absence is invisible without
 * it.** A marker that is stripped and a character who was never tracked look identical in a
 * prompt: a line that is not there. Every strip is already recorded with a reason
 * (`FrameworkRecord`), and until something displays those records the only way to tell a typo
 * from an untracked subject is to diff the prompt against the entry by hand. That cost a real
 * debugging session over a subject key with a space in it.
 *
 * **It runs the real dispatcher, never a second implementation.** Reading the markers here and
 * routing them by hand would be a second answer to "what does this marker do", and a panel
 * that can disagree with the prompt is worse than no panel. Same rule the lorebook's Test scan
 * follows for the same reason.
 *
 * Pure: it is handed the books and the state and answers from them.
 *
 * See architecture/frameworks.md.
 */
import type { Lorebook } from '$lib/lorebook/types';

import type { ChatFrameworkState } from './chat-state';
import { resolveDay, todaySerial, type ResolvedDay } from './day';
import { applyFrameworks } from './dispatch';
import type { FrameworkDef, FrameworkRecord } from './types';

/** One marker, with where it was written and what it currently does. */
export interface PanelRow extends FrameworkRecord {
	entryId: string;
	/** The entry's title. Organisational only, never sent to a model, and exactly what a
	 *  reader needs to find the marker again. */
	entryTitle: string;
}

/** One book's markers. The book is the unit a reader collapses, so it is the unit here. */
export interface PanelBook {
	bookId: string;
	bookName: string;
	/** At least one. A book carrying no marker is not a group, it is silence, and listing it
	 *  would bury the books that do carry one. */
	rows: PanelRow[];
}

export interface PanelView {
	/** The day every row was computed against, and where it came from. */
	day: ResolvedDay;
	/**
	 * Books that carry at least one marker, **in the order the chat resolves them** rather
	 * than alphabetically: that order is the layering (books switched into every chat, then
	 * the ones the cards link, then the ones the chat attached), and it is information. Rows
	 * WITHIN a book are alphabetical, because their order in an entry file means nothing.
	 */
	books: PanelBook[];
	/** Markers across every book, so a header can count them without flattening. */
	markerCount: number;
}

export interface PanelInput {
	/** The books this chat carries, resolved the way a prompt resolves them. */
	books: readonly Lorebook[];
	frameworks: readonly FrameworkDef[];
	disabled: readonly string[];
	state: ChatFrameworkState;
	/** The chat path, oldest to newest, as the day resolver reads it. */
	messages: readonly string[];
	/** The clock the panel describes, injectable so a test can pin it. Defaults to now. */
	now?: Date;
	/**
	 * Entry ids whose text reached the prompt, from a live scan. Given, only markers written
	 * in those entries are listed; absent or null, every entry in every book is.
	 *
	 * A SET of ids rather than the trace itself, so this module never learns what a lorebook
	 * scan is. Which statuses count as "reached the prompt" is the lorebook's own question and
	 * `lorebookWasInjected` is its answer; a second definition here would be a second answer,
	 * and the panel would eventually disagree with the block it is describing.
	 */
	injectedEntryIds?: ReadonlySet<string> | null;
}

/**
 * Every marker in the books in play, with its outcome.
 *
 * **Which entries are read is the caller's choice**, and the two answers are different
 * questions rather than a coarse and a fine version of one. With `injectedEntryIds` the panel
 * says what the model is being told right now; without it, what every marker in the shelf
 * would say if its entry fired, which is the troubleshooting view and the only one that can
 * show a marker whose entry never fires at all.
 *
 * Neither is a superset of the other in usefulness. A typo in a marker inside an entry that
 * is not firing is invisible to the first and obvious to the second, and a book of fifty
 * characters is unreadable in the second and precise in the first.
 *
 * A surface must say which of the two it is showing. A reader who took a row from the
 * unfiltered view as proof the line reached the prompt would be wrong.
 */
export function panelView(input: PanelInput): PanelView {
	const day = resolveDay({
		messages: input.messages,
		mode: input.state.mode,
		manual: input.state.day,
		today: todaySerial(input.now ?? new Date())
	});
	const ctx = {
		frameworks: input.frameworks,
		disabled: input.disabled,
		day: day.day,
		suppressed: input.state.suppressed,
		byFramework: input.state.byFramework
	};

	const books: PanelBook[] = [];
	let markerCount = 0;
	for (const book of input.books) {
		const rows: PanelRow[] = [];
		for (const entry of book.entries) {
			if (input.injectedEntryIds && !input.injectedEntryIds.has(entry.id)) continue;
			// The real dispatcher, discarding its text and keeping its records. Routing these by
			// hand would be a second answer to what a marker does.
			for (const record of applyFrameworks(entry.content, ctx).records) {
				rows.push({ ...record, entryId: entry.id, entryTitle: entry.comment });
			}
		}
		if (rows.length === 0) continue;
		rows.sort((a, b) => compareLabels(labelOf(a), labelOf(b)));
		markerCount += rows.length;
		books.push({ bookId: book.id, bookName: book.name, rows });
	}
	return { day, books, markerCount };
}

/** What a row is called on screen, which is what it must sort by: sorting on anything a
 *  reader cannot see reads as no order at all. A malformed marker has no subject, so it
 *  falls back to the same raw text the row displays. */
function labelOf(row: PanelRow): string {
	return row.subject ?? row.raw;
}

/**
 * A-Z, case and accent insensitive, with runs of digits compared as numbers so "Entry 2"
 * precedes "Entry 10".
 *
 * The locale is pinned rather than left to the host. This is a pure function with tests over
 * its ordering, and an unpinned collator would make those tests depend on the machine.
 */
function compareLabels(a: string, b: string): number {
	return a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });
}

/** How a row should read to somebody who is wondering why nothing happened. Kept beside the
 *  rows rather than in the component, so a new `FrameworkStatus` is a compile error here
 *  instead of an unlabelled row on screen. */
export const ROW_STATUS: Record<FrameworkRecord['status'], string> = {
	rendered: 'Active',
	malformed: 'Not understood',
	unknownFramework: 'No such framework',
	disabled: 'Framework switched off',
	suppressed: 'Held out of this story',
	noOutput: 'Nothing to say'
};
