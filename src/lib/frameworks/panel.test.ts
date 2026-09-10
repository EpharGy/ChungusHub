/**
 * Panel derivation tests. Run with `bun test`.
 *
 * The contract is that the panel says the same thing the prompt does: it runs the real
 * dispatcher, so a row can never claim an outcome the send did not produce.
 */

import { describe, expect, test } from 'bun:test';

import { createEmptyLorebook, createEmptyLorebookEntry } from '$lib/lorebook/types';

import { defaultChatFrameworkState } from './chat-state';
import { todaySerial } from './day';
import { panelView, ROW_STATUS, type PanelRow, type PanelView } from './panel';
import type { FrameworkDef } from './types';

const DEMO: FrameworkDef = {
	id: 'demo',
	name: 'Demo',
	summary: 'test double',
	description: 'test double',
	compute: ({ subject }) => `${subject} is here`
};

function named(name: string, ...entries: [title: string, content: string][]) {
	const b = createEmptyLorebook(name);
	b.entries = entries.map(([comment, content]) => ({ ...createEmptyLorebookEntry(), comment, content }));
	return b;
}

function book(...entries: [title: string, content: string][]) {
	return named('Cast', ...entries);
}

/** Every row across every book. The panel groups, and most of what is asserted here is about
 *  one marker rather than about where it was filed. */
function rows(out: PanelView): PanelRow[] {
	return out.books.flatMap((b) => b.rows);
}

/** The clock every marker-mode view here is measured against, pinned so the suite reads the
 *  same whenever it runs. */
const NOW = new Date(2026, 9, 10);
const TODAY = todaySerial(NOW);

/** A chat reading its day off the story rather than off the stored number. */
function markerState(over: Partial<ReturnType<typeof defaultChatFrameworkState>> = {}) {
	return { ...defaultChatFrameworkState(), mode: 'marker' as const, ...over };
}

function view(over: Partial<Parameters<typeof panelView>[0]> = {}) {
	return panelView({
		books: [book(['Vale', 'Red hair.\n@demo[Ada Vale]'])],
		frameworks: [DEMO],
		disabled: [],
		state: defaultChatFrameworkState(),
		now: NOW,
		...over
	});
}

describe('the rows', () => {
	test('one row per marker, naming where it was written', () => {
		const out = view();
		expect(out.books).toHaveLength(1);
		expect(out.books[0].bookName).toBe('Cast');
		expect(out.books[0].rows).toHaveLength(1);
		expect(out.books[0].rows[0]).toMatchObject({
			entryTitle: 'Vale',
			status: 'rendered',
			subject: 'Ada Vale',
			key: 'ada vale',
			text: 'Ada Vale is here'
		});
	});

	test('an entry with no marker contributes nothing', () => {
		expect(rows(view({ books: [book(['Plain', 'Just prose.'])] }))).toEqual([]);
	});

	test('several markers in one entry each get a row', () => {
		const out = view({ books: [book(['Two', '@demo[Ada]\n@demo[Bea]'])] });
		expect(rows(out).map((r) => r.subject)).toEqual(['Ada', 'Bea']);
	});

	test('the author’s own spelling is what a row is labelled with', () => {
		// The folded key decides identity; nobody writes her name as "ada vale".
		expect(rows(view())[0].subject).toBe('Ada Vale');
	});
});

describe('why nothing happened', () => {
	test('a typo is reported with its reason, not silently missing', () => {
		// The whole point of the panel. A stripped marker and an untracked character look
		// identical in a prompt.
		const out = view({ books: [book(['Broken', '@demo[Vale, len]'])] });
		expect(rows(out)[0]).toMatchObject({ status: 'malformed', reason: 'field "len" is not name=value' });
	});

	test('a misspelled framework reads as unknown, not as a typo in the marker', () => {
		expect(rows(view({ books: [book(['X', '@demoo[Vale]'])] }))[0].status).toBe('unknownFramework');
	});

	test('a suppressed subject says so rather than vanishing', () => {
		const state = { ...defaultChatFrameworkState(), suppressed: ['ada vale'] };
		expect(rows(view({ state }))[0].status).toBe('suppressed');
	});

	test('a switched-off framework is distinguishable from a misspelled one', () => {
		expect(rows(view({ disabled: ['demo'] }))[0].status).toBe('disabled');
	});

	test('every status has wording, so no row can reach the screen unlabelled', () => {
		for (const status of Object.keys(ROW_STATUS)) {
			expect(ROW_STATUS[status as keyof typeof ROW_STATUS]).toBeTruthy();
		}
	});
});

describe('the day', () => {
	test('comes back with its source, so a reader can see which answered', () => {
		// The two sources are also two UNITS: a serial date and a story day. A surface that
		// showed the number without saying which would be showing a number nobody can read.
		expect(view({ state: markerState() }).day).toEqual({ day: TODAY, source: 'clock' });
		const byHand = view({ state: { ...defaultChatFrameworkState(), day: 9 } });
		expect(byHand.day).toEqual({ day: 9, source: 'manual' });
	});

	test('falls back to the stored one and says so', () => {
		const state = { ...defaultChatFrameworkState(), day: 9 };
		expect(view({ state, messages: ['nothing here'] }).day).toEqual({ day: 9, source: 'manual' });
	});

	test('every row is computed against the day the panel reports', () => {
		// If these could differ, the panel would be describing a prompt nobody sent.
		let seen = -1;
		const framework: FrameworkDef = { ...DEMO, compute: ({ day }) => `day ${(seen = day)}` };
		const out = view({ state: markerState({ day: 42 }), frameworks: [framework] });
		expect(seen).toBe(out.day.day);
		// Real time: the clock answered, and the stored 42 is never reached.
		expect(rows(out)[0].text).toBe(`day ${TODAY}`);
	});
});

describe('grouping and order', () => {
	test('each book is its own group, so a book can be collapsed as a unit', () => {
		const out = view({
			books: [named('Cast', ['Vale', '@demo[Vale]']), named('Places', ['Inn', '@demo[Inn]'])]
		});
		expect(out.books.map((b) => b.bookName)).toEqual(['Cast', 'Places']);
		expect(out.books.map((b) => b.rows.length)).toEqual([1, 1]);
	});

	test('a book carrying no marker is left out entirely, not listed empty', () => {
		// Every book a chat carries would otherwise be a heading, burying the two that matter.
		const out = view({
			books: [named('Cast', ['Vale', '@demo[Vale]']), named('Lore', ['History', 'Just prose.'])]
		});
		expect(out.books.map((b) => b.bookName)).toEqual(['Cast']);
	});

	test('books keep the order the chat resolves them in, which is the layering', () => {
		// Alphabetical here would throw away which layer a book came from.
		const out = view({
			books: [named('Zeta', ['A', '@demo[A]']), named('Alpha', ['B', '@demo[B]'])]
		});
		expect(out.books.map((b) => b.bookName)).toEqual(['Zeta', 'Alpha']);
	});

	test('rows inside a book are A-Z, not in the order the entries happen to sit', () => {
		const out = view({
			books: [named('Cast', ['One', '@demo[Wren]'], ['Two', '@demo[Adele]'], ['Three', '@demo[Cleo]'])]
		});
		expect(out.books[0].rows.map((r) => r.subject)).toEqual(['Adele', 'Cleo', 'Wren']);
	});

	test('the sort ignores case, so a lowercase name is not exiled to the end', () => {
		const out = view({ books: [named('Cast', ['E', '@demo[adele]'], ['E2', '@demo[Bea]'])] });
		expect(out.books[0].rows.map((r) => r.subject)).toEqual(['adele', 'Bea']);
	});

	test('digits compare as numbers, so Guard 10 follows Guard 2', () => {
		const out = view({
			books: [named('Cast', ['A', '@demo[Guard 10]'], ['B', '@demo[Guard 2]'])]
		});
		expect(out.books[0].rows.map((r) => r.subject)).toEqual(['Guard 2', 'Guard 10']);
	});

	test('a malformed marker sorts under the text a reader can actually see', () => {
		// It has no subject, so sorting on the subject would leave it in no order at all.
		const out = view({ books: [named('Cast', ['A', '@demo[Zed]'], ['B', '@demo[Ann, len]'])] });
		expect(out.books[0].rows.map((r) => r.subject ?? r.raw)).toEqual(['@demo[Ann, len]', 'Zed']);
	});

	test('the marker count spans every book, so a header need not flatten', () => {
		const out = view({
			books: [named('Cast', ['A', '@demo[X]'], ['B', '@demo[Y]']), named('Places', ['C', '@demo[Z]'])]
		});
		expect(out.markerCount).toBe(3);
	});

	test('a row names its entry id, so two identical markers stay distinguishable', () => {
		const out = view({ books: [named('Cast', ['A', '@demo[X]'], ['B', '@demo[X]'])] });
		const [first, second] = out.books[0].rows;
		expect(first.entryId).not.toBe(second.entryId);
	});
});

describe('only the entries that fired', () => {
	/** A book whose two entries can be told apart by id, which is what the filter keys on. */
	function twoEntries() {
		return named('Cast', ['Fired', '@demo[Ada]'], ['Silent', '@demo[Bea]']);
	}

	test('an entry outside the set contributes nothing', () => {
		const bk = twoEntries();
		const out = view({ books: [bk], injectedEntryIds: new Set([bk.entries[0].id]) });
		expect(out.books[0].rows.map((r) => r.subject)).toEqual(['Ada']);
	});

	test('a book left with no marker drops out rather than showing an empty heading', () => {
		// The reason this is not filtered in the component: the grouping has to agree with it.
		const bk = twoEntries();
		const other = named('Places', ['Inn', '@demo[Inn]']);
		const out = view({ books: [bk, other], injectedEntryIds: new Set([bk.entries[1].id]) });
		expect(out.books.map((b) => b.bookName)).toEqual(['Cast']);
	});

	test('an empty set is a real answer, not a missing one', () => {
		// Nothing fired IS the state of the world sometimes, and it must not silently read
		// as "no filter" and show the whole shelf.
		const out = view({ books: [twoEntries()], injectedEntryIds: new Set<string>() });
		expect(out.books).toEqual([]);
		expect(out.markerCount).toBe(0);
	});

	test('null means every entry, which is the troubleshooting view', () => {
		const out = view({ books: [twoEntries()], injectedEntryIds: null });
		expect(out.markerCount).toBe(2);
	});

	test('omitting it entirely means the same as null', () => {
		expect(view({ books: [twoEntries()] }).markerCount).toBe(2);
	});

	test('the count follows the filter, so a header cannot claim more than it lists', () => {
		const bk = twoEntries();
		const out = view({ books: [bk], injectedEntryIds: new Set([bk.entries[0].id]) });
		expect(out.markerCount).toBe(1);
	});

	test('the day is unaffected by the filter', () => {
		// The day is a fact about the story, not about which entries fired.
		const bk = twoEntries();
		const filtered = view({ books: [bk], injectedEntryIds: new Set<string>(), state: markerState() });
		expect(filtered.day).toEqual({ day: TODAY, source: 'clock' });
	});
});
