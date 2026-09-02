/**
 * The floating window's geometry, pinned. This arithmetic decides where a dragged panel
 * lands and whether a docked one still lines up with the chat column, and every bug it can
 * have is a bug you can only see by dragging something, which is exactly why it was pulled
 * out of the component. Run with `bun test`.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
	MARGIN,
	centeredRect,
	clampRect,
	isSnapZone,
	readPlacement,
	snapRegion,
	snapZoneFor,
	writePlacement,
	type Rect,
	type SnapAnchors
} from './floating-window';

const MIN = { w: 280, h: 240 };
const SCREEN = { w: 1000, h: 800 };

describe('clampRect', () => {
	test('a window well inside the viewport is left alone', () => {
		const r: Rect = { x: 100, y: 120, w: 460, h: 400 };
		expect(clampRect(r, MIN, SCREEN)).toEqual(r);
	});

	test('a window dragged off an edge is pulled back to the margin', () => {
		expect(clampRect({ x: -300, y: -80, w: 460, h: 400 }, MIN, SCREEN)).toEqual({
			x: MARGIN,
			y: MARGIN,
			w: 460,
			h: 400
		});
		// Right/bottom: the far edge lands one margin short of the viewport's.
		expect(clampRect({ x: 5000, y: 5000, w: 460, h: 400 }, MIN, SCREEN)).toEqual({
			x: SCREEN.w - 460 - MARGIN,
			y: SCREEN.h - 400 - MARGIN,
			w: 460,
			h: 400
		});
	});

	test('a resize below the minimum stops at the minimum', () => {
		expect(clampRect({ x: 100, y: 100, w: 10, h: 10 }, MIN, SCREEN)).toMatchObject({
			w: MIN.w,
			h: MIN.h
		});
	});

	test('on a viewport too small for both, the minimum beats the margin', () => {
		// The alternative is a window clamped to a sliver, which is unusable and unrecoverable
		// by dragging. It is allowed to overhang instead.
		const fitted = clampRect({ x: 0, y: 0, w: 460, h: 400 }, MIN, { w: 200, h: 200 });
		expect(fitted).toEqual({ x: MARGIN, y: MARGIN, w: MIN.w, h: MIN.h });
	});
});

describe('snapZoneFor', () => {
	test('nothing is armed away from the edges', () => {
		expect(snapZoneFor(500, 400, SCREEN.w, SCREEN.h)).toBeNull();
	});

	test('the side edges arm the side docks', () => {
		expect(snapZoneFor(4, 400, SCREEN.w, SCREEN.h)).toBe('left');
		expect(snapZoneFor(996, 400, SCREEN.w, SCREEN.h)).toBe('right');
	});

	test('a corner beats the edge it shares', () => {
		expect(snapZoneFor(4, 4, SCREEN.w, SCREEN.h)).toBe('tl');
		expect(snapZoneFor(996, 4, SCREEN.w, SCREEN.h)).toBe('tr');
		expect(snapZoneFor(4, 796, SCREEN.w, SCREEN.h)).toBe('bl');
		expect(snapZoneFor(996, 796, SCREEN.w, SCREEN.h)).toBe('br');
	});

	test('the top edge away from the corners covers the chat column', () => {
		expect(snapZoneFor(500, 4, SCREEN.w, SCREEN.h)).toBe('center');
	});

	test('the bottom edge alone arms nothing', () => {
		// Deliberate: there is no bottom dock, only the two bottom corners.
		expect(snapZoneFor(500, 796, SCREEN.w, SCREEN.h)).toBeNull();
	});
});

describe('snapRegion', () => {
	// A workspace below a 48px title bar, with a 400px chat column centred in it.
	const anchors: SnapAnchors = {
		workspace: { x: 0, y: 48, w: 1000, h: 752 },
		column: { x: 300, y: 0, w: 400, h: 48 }
	};

	test('the side docks are the margins beside the chat column', () => {
		expect(snapRegion('left', anchors, true)).toEqual({ x: 0, y: 48, w: 300, h: 752 });
		expect(snapRegion('right', anchors, true)).toEqual({ x: 700, y: 48, w: 300, h: 752 });
	});

	test('center covers the column itself, full height', () => {
		expect(snapRegion('center', anchors, true)).toEqual({ x: 300, y: 48, w: 400, h: 752 });
	});

	test('the corners halve their own side, and the halves meet without a gap', () => {
		const top = snapRegion('tl', anchors, true);
		const bottom = snapRegion('bl', anchors, true);
		expect(top).toEqual({ x: 0, y: 48, w: 300, h: 376 });
		expect(bottom).toEqual({ x: 0, y: 424, w: 300, h: 376 });
		expect(top.y + top.h).toBe(bottom.y);
		expect(bottom.y + bottom.h).toBe(anchors.workspace.y + anchors.workspace.h);
	});

	test('an odd height still leaves no gap between the halves', () => {
		const odd: SnapAnchors = { ...anchors, workspace: { x: 0, y: 48, w: 1000, h: 751 } };
		const top = snapRegion('tr', odd, true);
		const bottom = snapRegion('br', odd, true);
		expect(top.y + top.h).toBe(bottom.y);
		expect(bottom.y + bottom.h).toBe(799);
	});

	test('below the docking breakpoint every zone collapses onto the column', () => {
		// There are no side margins to dock into down here, so a "left" dock that still
		// claimed one would be a sliver beside the chat rather than a panel.
		const center = snapRegion('center', anchors, false);
		for (const zone of ['left', 'right'] as const) {
			expect(snapRegion(zone, anchors, false)).toEqual(center);
		}
		expect(snapRegion('tl', anchors, false)).toEqual({ ...center, h: 376 });
	});
});

describe('centeredRect', () => {
	test('the opening placement is centred', () => {
		expect(centeredRect({ w: 460, h: 400 }, MIN, SCREEN)).toEqual({
			x: 270,
			y: 200,
			w: 460,
			h: 400
		});
	});
});

describe('placement persistence', () => {
	const KEY = 'test-window-rect';
	let store: Map<string, string>;
	const original = (globalThis as { localStorage?: Storage }).localStorage;

	beforeEach(() => {
		store = new Map();
		(globalThis as { localStorage?: unknown }).localStorage = {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, v),
			removeItem: (k: string) => void store.delete(k)
		};
	});

	afterEach(() => {
		(globalThis as { localStorage?: unknown }).localStorage = original;
	});

	test('a placement survives the round trip, dock and free size included', () => {
		writePlacement(KEY, { x: 10, y: 20, w: 300, h: 400, snappedZone: 'left', freeW: 460, freeH: 500 });
		expect(readPlacement(KEY)).toEqual({
			x: 10,
			y: 20,
			w: 300,
			h: 400,
			snappedZone: 'left',
			freeW: 460,
			freeH: 500
		});
	});

	test('nothing saved reads as nothing', () => {
		expect(readPlacement(KEY)).toBeNull();
	});

	test('malformed JSON is not a crash', () => {
		store.set(KEY, '{not json');
		expect(readPlacement(KEY)).toBeNull();
	});

	test('a non-finite coordinate is refused outright', () => {
		// JSON.stringify writes NaN as null, so this is the shape a corrupted save really
		// takes. Accepting it would put the window at an unreachable position that no
		// amount of clamping recovers.
		store.set(KEY, JSON.stringify({ x: null, y: 20, w: 300, h: 400 }));
		expect(readPlacement(KEY)).toBeNull();
	});

	test('an unrecognised dock is dropped, and the rest of the placement kept', () => {
		store.set(KEY, JSON.stringify({ x: 10, y: 20, w: 300, h: 400, snappedZone: 'nowhere' }));
		expect(readPlacement(KEY)).toMatchObject({ x: 10, y: 20, snappedZone: null });
	});

	test('an old plain-rect save still reads', () => {
		store.set(KEY, JSON.stringify({ x: 10, y: 20, w: 300, h: 400 }));
		expect(readPlacement(KEY)).toMatchObject({ x: 10, w: 300, snappedZone: null });
	});
});

describe('isSnapZone', () => {
	test('only the seven zones pass', () => {
		expect(isSnapZone('left')).toBe(true);
		expect(isSnapZone('br')).toBe(true);
		expect(isSnapZone('top')).toBe(false);
		expect(isSnapZone(null)).toBe(false);
		expect(isSnapZone(undefined)).toBe(false);
	});
});
