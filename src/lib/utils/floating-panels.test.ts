/**
 * How the title bar arranges the panels registered with it. The module is three functions
 * over a list, and what is worth pinning is not the sorting but the rules that decide what
 * a reader sees: that the order cannot depend on which module a bundler loaded first, that
 * a panel with nothing to show is absent rather than dead, and that the row is either all
 * buttons or all menu and never a mixture. Run with `bun test`.
 */
import { describe, test, expect } from 'bun:test';
import {
	TOPBAR_INLINE_LIMIT,
	availablePanels,
	sortPanels,
	topbarLayout,
	type FloatingPanelEntry
} from './floating-panels';

/** A registration with only the four fields a simple panel actually writes. */
function panel(id: string, order: number, extra: Partial<FloatingPanelEntry> = {}) {
	return {
		id,
		order,
		label: id,
		icon: 'document',
		isOpen: () => false,
		toggle: () => {},
		...extra
	} satisfies FloatingPanelEntry;
}

const ids = (entries: readonly FloatingPanelEntry[]) => entries.map((e) => e.id);

describe('sortPanels', () => {
	test('orders by the declared order, not by registration order', () => {
		expect(ids(sortPanels([panel('c', 30), panel('a', 10), panel('b', 20)]))).toEqual([
			'a',
			'b',
			'c'
		]);
	});

	test('breaks an order collision on id, so two panels cannot swap between runs', () => {
		// The failure this prevents is silent: with no tiebreak the pair keeps whichever
		// order the bundler's import sequence handed over, and that can change on a rebuild
		// with nothing in the diff to explain the row moving.
		const forwards = sortPanels([panel('zeta', 10), panel('alpha', 10)]);
		const backwards = sortPanels([panel('alpha', 10), panel('zeta', 10)]);
		expect(ids(forwards)).toEqual(['alpha', 'zeta']);
		expect(ids(backwards)).toEqual(ids(forwards));
	});

	test('leaves the caller’s array alone', () => {
		const registered = [panel('b', 20), panel('a', 10)];
		sortPanels(registered);
		expect(ids(registered)).toEqual(['b', 'a']);
	});

	test('negative and equal orders are ordinary numbers, not special cases', () => {
		expect(ids(sortPanels([panel('a', 0), panel('b', -50), panel('c', 5)]))).toEqual([
			'b',
			'a',
			'c'
		]);
	});
});

describe('availablePanels', () => {
	test('a panel that writes no availability getter is available', () => {
		expect(ids(availablePanels([panel('a', 10)]))).toEqual(['a']);
	});

	test('drops the entries with nothing to show, and keeps the rest in order', () => {
		const entries = [
			panel('popout', 20, { available: () => false }),
			panel('notepad', 10),
			panel('feed', 30)
		];
		expect(ids(availablePanels(entries))).toEqual(['notepad', 'feed']);
	});

	test('a disabled panel is still available: greyed out is on screen', () => {
		// The two flags mean different things and the notepad relies on the difference. On
		// the welcome screen it is present and inert, because hiding it would shift the
		// whole cluster sideways the moment a chat opened.
		expect(ids(availablePanels([panel('notepad', 10, { disabled: () => true })]))).toEqual([
			'notepad'
		]);
	});

	test('the predicate is the caller’s, so the reactive read happens in the component', () => {
		const entries = [panel('a', 10), panel('b', 20)];
		expect(ids(availablePanels(entries, (e) => e.id === 'b'))).toEqual(['b']);
	});
});

describe('topbarLayout', () => {
	test('nothing registered draws nothing at all: no cluster, and no empty menu', () => {
		const layout = topbarLayout([]);
		expect(layout.inline).toEqual([]);
		expect(layout.menu).toEqual([]);
	});

	test('up to the limit, every panel is its own button', () => {
		const layout = topbarLayout([panel('a', 10), panel('b', 20)], 2);
		expect(ids(layout.inline)).toEqual(['a', 'b']);
		expect(layout.menu).toEqual([]);
	});

	test('past the limit the WHOLE set collapses, not just the overflow', () => {
		// The rule that matters: a row of two buttons plus a menu would make opening the
		// notepad cost one click or two depending on how many unrelated features happen to
		// be installed, and nothing on screen would say which.
		const layout = topbarLayout([panel('a', 10), panel('b', 20), panel('c', 30)], 2);
		expect(layout.inline).toEqual([]);
		expect(ids(layout.menu)).toEqual(['a', 'b', 'c']);
	});

	test('the menu keeps the declared order', () => {
		const layout = topbarLayout([panel('c', 30), panel('a', 10), panel('b', 20)], 1);
		expect(ids(layout.menu)).toEqual(['a', 'b', 'c']);
	});

	test('a limit of zero collapses even a single panel', () => {
		const layout = topbarLayout([panel('a', 10)], 0);
		expect(layout.inline).toEqual([]);
		expect(ids(layout.menu)).toEqual(['a']);
	});

	test('exactly one list is ever populated', () => {
		for (const count of [0, 1, 2, 3, 7]) {
			const entries = Array.from({ length: count }, (_, i) => panel(`p${i}`, i * 10));
			const { inline, menu } = topbarLayout(entries, TOPBAR_INLINE_LIMIT);
			expect(inline.length === 0 || menu.length === 0).toBe(true);
			expect(inline.length + menu.length).toBe(count);
		}
	});

	test('defaults to the shipped limit when none is passed', () => {
		const entries = Array.from({ length: TOPBAR_INLINE_LIMIT }, (_, i) => panel(`p${i}`, i));
		expect(topbarLayout(entries).inline.length).toBe(TOPBAR_INLINE_LIMIT);
		expect(topbarLayout([...entries, panel('one-more', 999)]).menu.length).toBe(
			TOPBAR_INLINE_LIMIT + 1
		);
	});
});
