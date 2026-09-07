/**
 * The floating windows' front-to-back order, pinned. The whole module is four functions
 * over one counter, and the thing worth testing is not the arithmetic but the two rules
 * that make it behave like a window manager: a raised window ends up in front of every
 * other open one, and re-clicking the frontmost window changes nothing. Run with `bun test`.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { STACK_BASE, bringToFront, isTop, raiseToTop, resetStack } from './floating-window-stack';

beforeEach(() => {
	resetStack();
});

describe('raiseToTop', () => {
	test('the first window raised sits above the base rung', () => {
		expect(raiseToTop()).toBeGreaterThan(STACK_BASE);
	});

	test('each raise lands above the one before it', () => {
		const first = raiseToTop();
		const second = raiseToTop();
		const third = raiseToTop();
		expect(second).toBeGreaterThan(first);
		expect(third).toBeGreaterThan(second);
	});
});

describe('isTop', () => {
	test('the most recently raised rung is the top one', () => {
		raiseToTop();
		const latest = raiseToTop();
		expect(isTop(latest)).toBe(true);
	});

	test('a rung something else has since passed is not the top one', () => {
		const first = raiseToTop();
		raiseToTop();
		expect(isTop(first)).toBe(false);
	});

	test('the base rung is the top only while nothing has been raised', () => {
		expect(isTop(STACK_BASE)).toBe(true);
		raiseToTop();
		expect(isTop(STACK_BASE)).toBe(false);
	});
});

describe('bringToFront', () => {
	test('a window behind another comes out in front of it', () => {
		const behind = raiseToTop();
		const inFront = raiseToTop();
		expect(bringToFront(behind)).toBeGreaterThan(inFront);
	});

	test('the frontmost window keeps its rung, so a repeated click does not churn it', () => {
		const front = raiseToTop();
		expect(bringToFront(front)).toBe(front);
		expect(bringToFront(front)).toBe(front);
	});

	test('three windows clicked in turn end up in click order', () => {
		let a = raiseToTop();
		let b = raiseToTop();
		let c = raiseToTop();

		a = bringToFront(a);
		expect(a).toBeGreaterThan(b);
		expect(a).toBeGreaterThan(c);

		b = bringToFront(b);
		expect(b).toBeGreaterThan(a);
		expect(b).toBeGreaterThan(c);

		// And the one nobody touched stays exactly where it was, at the back.
		expect(c).toBeLessThan(a);
		expect(c).toBeLessThan(b);
	});

	test('a docked window is on the same ladder as a free one', () => {
		// Nothing here knows about docking, which is the point being pinned: the caller
		// hands over a rung, not a mode, so there is no second tier a dock could fall into.
		const docked = raiseToTop();
		const floating = raiseToTop();
		expect(bringToFront(docked)).toBeGreaterThan(floating);
	});
});

describe('resetStack', () => {
	test('returns the ladder to its base rung', () => {
		raiseToTop();
		raiseToTop();
		resetStack();
		expect(isTop(STACK_BASE)).toBe(true);
	});
});
