/**
 * Tests for the spatial navigation scoring. Run with `bun test`.
 *
 * Only the pure half is covered: which of a set of boxes a direction picks. Collecting the
 * boxes off the page, moving focus and scrolling a panel to reach past its fold are DOM glue
 * and are exercised by hand in the app.
 */

import { describe, expect, test } from 'bun:test';

import { bestInDirection, type Box } from './spatial-nav';

/** A box by its corner and size, which reads closer to a screen than four edges do. */
function box(left: number, top: number, width: number, height: number): Box {
	return { left, top, right: left + width, bottom: top + height };
}

describe('bestInDirection', () => {
	const origin = box(100, 100, 100, 40);

	test('nothing that way is null, not a guess', () => {
		expect(bestInDirection(origin, [box(0, 0, 50, 20)], 'right')).toBeNull();
		expect(bestInDirection(origin, [], 'down')).toBeNull();
	});

	test('the origin and everything inside it are not candidates', () => {
		const inside = box(110, 105, 20, 20);
		for (const direction of ['up', 'down', 'left', 'right'] as const) {
			expect(bestInDirection(origin, [origin, inside], direction)).toBeNull();
		}
	});

	test('a neighbour in line beats a nearer one out of line', () => {
		const inLine = box(400, 100, 100, 40); // far, same row
		const outOfLine = box(220, 400, 100, 40); // near across, way down the screen
		expect(bestInDirection(origin, [outOfLine, inLine], 'right')).toBe(1);
	});

	test('a tall card is picked by its edge, not by its centre', () => {
		// The card starts right beside the origin but runs the height of the screen, so its
		// centre is further away than the small button sitting below and to the right.
		const tallCard = box(220, 0, 200, 800);
		const smallButton = box(230, 300, 60, 30);
		expect(bestInDirection(origin, [tallCard, smallButton], 'right')).toBe(0);
	});

	test('rows go to the next row, not across it', () => {
		const nextRowSameColumn = box(100, 200, 100, 40);
		const nextRowFarColumn = box(600, 160, 100, 40);
		expect(bestInDirection(origin, [nextRowFarColumn, nextRowSameColumn], 'down')).toBe(1);
	});

	test('each direction picks its own side', () => {
		const above = box(100, 20, 100, 40);
		const below = box(100, 200, 100, 40);
		const left = box(0, 100, 60, 40);
		const right = box(300, 100, 60, 40);
		const all = [above, below, left, right];
		expect(bestInDirection(origin, all, 'up')).toBe(0);
		expect(bestInDirection(origin, all, 'down')).toBe(1);
		expect(bestInDirection(origin, all, 'left')).toBe(2);
		expect(bestInDirection(origin, all, 'right')).toBe(3);
	});

	test('a tie leaves the first candidate standing', () => {
		const first = box(300, 100, 60, 40);
		const second = box(300, 100, 60, 40);
		expect(bestInDirection(origin, [first, second], 'right')).toBe(0);
	});
});
