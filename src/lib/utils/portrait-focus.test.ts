import { describe, test, expect } from 'bun:test';
import {
	DEFAULT_PORTRAIT_FOCUS,
	MAX_PORTRAIT_ZOOM,
	clampPortraitFocus,
	portraitDrawRect,
	portraitFocusFromDrawOffset,
	portraitFocusStyle
} from './portrait-focus';

/** A wide picture in a tall frame: the case the whole feature exists for. */
const WIDE = { width: 1920, height: 1080 };
const TALL_FRAME = { width: 200, height: 300 };
const SQUARE_FRAME = { width: 240, height: 240 };

describe('portraitDrawRect', () => {
	test('always covers the frame, wherever the focal point is', () => {
		for (const frame of [TALL_FRAME, SQUARE_FRAME]) {
			for (const x of [0, 0.25, 0.5, 1]) {
				for (const y of [0, 0.5, 1]) {
					for (const zoom of [1, 1.7, MAX_PORTRAIT_ZOOM]) {
						const rect = portraitDrawRect({ x, y, zoom }, WIDE, frame);
						expect(rect.left).toBeLessThanOrEqual(0);
						expect(rect.top).toBeLessThanOrEqual(0);
						expect(rect.left + rect.width).toBeGreaterThanOrEqual(frame.width - 1e-9);
						expect(rect.top + rect.height).toBeGreaterThanOrEqual(frame.height - 1e-9);
					}
				}
			}
		}
	});

	test('keeps the picture in proportion', () => {
		const rect = portraitDrawRect({ x: 0.2, y: 0.4, zoom: 1.5 }, WIDE, TALL_FRAME);
		expect(rect.width / rect.height).toBeCloseTo(WIDE.width / WIDE.height, 9);
	});

	test('a left-edge focus shows the left of the picture', () => {
		const left = portraitDrawRect({ ...DEFAULT_PORTRAIT_FOCUS, x: 0 }, WIDE, TALL_FRAME);
		const right = portraitDrawRect({ ...DEFAULT_PORTRAIT_FOCUS, x: 1 }, WIDE, TALL_FRAME);
		expect(left.left).toBeCloseTo(0, 9);
		expect(right.left).toBeLessThan(left.left);
	});
});

describe('portraitFocusFromDrawOffset', () => {
	test('inverts portraitDrawRect, so a drag lands where it was dropped', () => {
		const focus = { x: 0.18, y: 0.62, zoom: 1.4 };
		const rect = portraitDrawRect(focus, WIDE, TALL_FRAME);
		expect(portraitFocusFromDrawOffset(rect, focus.zoom, WIDE, TALL_FRAME)).toEqual(focus);
	});

	test('pins to centre on an axis with no room to pan', () => {
		// 3:2 picture in a 3:2 frame at zoom 1: cover leaves no slack either way.
		const square = portraitFocusFromDrawOffset({ left: 0, top: 0 }, 1, { width: 300, height: 200 }, { width: 150, height: 100 });
		expect(square).toEqual({ x: 0.5, y: 0.5, zoom: 1 });
	});
});

describe('clampPortraitFocus', () => {
	test('holds the focal point inside the picture and the zoom inside its range', () => {
		expect(clampPortraitFocus({ x: -0.4, y: 3, zoom: 12 })).toEqual({ x: 0, y: 1, zoom: MAX_PORTRAIT_ZOOM });
		expect(clampPortraitFocus({ x: 0.5, y: 0.5, zoom: 0.2 })).toEqual(DEFAULT_PORTRAIT_FOCUS);
	});
});

describe('portraitFocusStyle', () => {
	test('an unframed portrait is left on the browser own centred cover', () => {
		expect(portraitFocusStyle(undefined)).toBe('');
	});

	test('aims and scales about the same point', () => {
		expect(portraitFocusStyle({ x: 0.25, y: 0.4, zoom: 1.5 })).toBe(
			'object-position:25% 40%;transform-origin:25% 40%;--portrait-zoom:1.5;transform:scale(1.5);'
		);
	});
});
