/**
 * Spatial navigation: which control lies in a direction from the one the keyboard is on.
 *
 * Tab walks the document in one dimension, and a screen is two: in a grid of cards or a form
 * with two columns the next thing in the markup is regularly not the next thing on screen, so
 * the reader has to hold a map of the DOM in their head to predict where a press goes. Moving
 * by direction needs no such map, because what you see is the answer.
 *
 * **Lining up beats being close**, which is the whole of the scoring and the reason this is not
 * a nearest-centre search. A tall card to the right has a far centre while its edge is right
 * there, so nearest-centre skips it for a small button below, and pressing right walks
 * diagonally down the screen. Distance is therefore measured edge to edge along the way being
 * travelled, and stepping OUT of line is weighted heavier than stepping along it.
 */

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/**
 * How much heavier a step out of line counts than a step along the way.
 *
 * The one number worth tuning here. Too low and a press wanders off diagonally; too high and a
 * perfectly aligned control at the far end of the screen beats the obvious neighbour just off
 * to one side.
 */
const OFF_AXIS_WEIGHT = 3;

/** Index of the best candidate in that direction, or null when nothing lies that way. */
export function bestInDirection(from: Box, candidates: Box[], direction: Direction): number | null {
	const vertical = direction === 'up' || direction === 'down';
	let bestIndex: number | null = null;
	let bestScore = Infinity;
	candidates.forEach((box, index) => {
		const along = travelled(from, box, direction);
		if (along === null) return;
		const off = vertical
			? gapBetween(from.left, from.right, box.left, box.right)
			: gapBetween(from.top, from.bottom, box.top, box.bottom);
		const score = along + off * OFF_AXIS_WEIGHT;
		// Strictly better, so a tie leaves the earlier candidate standing and the order the
		// caller collected in decides. Document order is at least a reason.
		if (score < bestScore) {
			bestScore = score;
			bestIndex = index;
		}
	});
	return bestIndex;
}

/**
 * Distance from the origin's leading edge to the candidate's near edge, or null when the
 * candidate does not lie that way at all.
 *
 * Both edges have to move for a candidate to count, which is what excludes the origin itself
 * and everything nested inside it: a button within a focused card shares its side of the
 * screen rather than sitting to one side of it. Overlapping neighbours score zero here and are
 * separated by how well they line up instead.
 */
function travelled(from: Box, box: Box, direction: Direction): number | null {
	switch (direction) {
		case 'right':
			if (box.left <= from.left || box.right <= from.right) return null;
			return Math.max(0, box.left - from.right);
		case 'left':
			if (box.right >= from.right || box.left >= from.left) return null;
			return Math.max(0, from.left - box.right);
		case 'down':
			if (box.top <= from.top || box.bottom <= from.bottom) return null;
			return Math.max(0, box.top - from.bottom);
		case 'up':
			if (box.bottom >= from.bottom || box.top >= from.top) return null;
			return Math.max(0, from.top - box.bottom);
	}
}

/** How far apart two spans are on the axis being crossed, and zero while they overlap. */
function gapBetween(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
	if (bEnd <= aStart) return aStart - bEnd;
	if (bStart >= aEnd) return bStart - aEnd;
	return 0;
}
