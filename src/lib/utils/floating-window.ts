/**
 * The geometry behind a floating, draggable, snappable panel.
 *
 * This is a port of the Chungus Assistant's own widget maths, lifted out of
 * `AssistantFloatingWidget.svelte` into a module of its own so a second floating window
 * does not need a second hand-written copy of it, and so the arithmetic can be tested
 * without mounting a component. The Assistant is the REFERENCE, not a dependency: it is
 * untouched, because rewriting a 946-line upstream file to consume this would buy a
 * permanent merge conflict and no behaviour.
 *
 * Everything here is pure. The caller reads the DOM and the viewport and passes the
 * numbers in, which is what makes `snapRegion` testable at all: the one thing that would
 * otherwise need a live layout is the two anchor rectangles, and those are arguments.
 */

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface Size {
	w: number;
	h: number;
}

/** Windows-style docking: the four edges, the four corners, and the chat column. */
export const SNAP_ZONES = ['left', 'right', 'center', 'tl', 'tr', 'bl', 'br'] as const;
export type SnapZone = (typeof SNAP_ZONES)[number];

/** Gap kept between a free-floating window and the viewport edge. */
export const MARGIN = 16;
/** A press only becomes a drag past this, so a plain click never tears a docked panel out. */
export const DRAG_THRESHOLD = 6;
/** Distance from a viewport edge that arms a snap zone. */
export const SNAP_EDGE = 40;

export function isSnapZone(value: unknown): value is SnapZone {
	return typeof value === 'string' && (SNAP_ZONES as readonly string[]).includes(value);
}

/**
 * Fit a rectangle inside the viewport at no smaller than `min`.
 *
 * The minimum wins over the margin: on a viewport too small to hold both, the window keeps
 * its usable size and overhangs rather than collapsing to a sliver.
 */
export function clampRect(r: Rect, min: Size, viewport: Size): Rect {
	const w = Math.min(Math.max(r.w, min.w), Math.max(viewport.w - MARGIN * 2, min.w));
	const h = Math.min(Math.max(r.h, min.h), Math.max(viewport.h - MARGIN * 2, min.h));
	const x = Math.min(Math.max(r.x, MARGIN), Math.max(viewport.w - w - MARGIN, MARGIN));
	const y = Math.min(Math.max(r.y, MARGIN), Math.max(viewport.h - h - MARGIN, MARGIN));
	return { x, y, w, h };
}

/** Which dock, if any, a pointer at (px, py) is asking for. Corners beat edges. */
export function snapZoneFor(px: number, py: number, vw: number, vh: number): SnapZone | null {
	const nearL = px <= SNAP_EDGE;
	const nearR = px >= vw - SNAP_EDGE;
	const nearT = py <= SNAP_EDGE;
	const nearB = py >= vh - SNAP_EDGE;
	if (nearL && nearT) return 'tl';
	if (nearL && nearB) return 'bl';
	if (nearL) return 'left';
	if (nearR && nearT) return 'tr';
	if (nearR && nearB) return 'br';
	if (nearR) return 'right';
	// Top edge away from the corners: cover the centred chat column, the shape the
	// full-cover overlays (Memory, Story Map) already take.
	if (nearT) return 'center';
	return null;
}

export interface SnapAnchors {
	/** The workspace below the title bar: the vertical bounds every dock shares. */
	workspace: Rect;
	/** The centred chat column: what separates the left margin from the right one. */
	column: Rect;
}

/**
 * Turn a zone into the rectangle it occupies, measured against the app's REAL layout.
 *
 * The caller reads the two anchors off the DOM rather than recomputing the responsive CSS,
 * which is what keeps a dock aligned with the chat column through zoom, a width change and
 * a breakpoint flip with no maths duplicated anywhere.
 *
 * `useSideDock` is the app's own docking breakpoint. Below it there are no side margins to
 * dock into, so every zone collapses onto the column.
 */
export function snapRegion(zone: SnapZone, anchors: SnapAnchors, useSideDock: boolean): Rect {
	const { workspace, column } = anchors;
	const center = { x: column.x, y: workspace.y, w: column.w, h: workspace.h };
	const left = useSideDock
		? { x: workspace.x, y: workspace.y, w: column.x - workspace.x, h: workspace.h }
		: center;
	const right = useSideDock
		? {
				x: column.x + column.w,
				y: workspace.y,
				w: workspace.x + workspace.w - column.x - column.w,
				h: workspace.h
			}
		: center;

	if (zone === 'left') return left;
	if (zone === 'right') return right;
	if (zone === 'center') return center;

	const base = zone === 'tl' || zone === 'bl' ? left : right;
	const top = zone === 'tl' || zone === 'tr';
	const topHeight = Math.floor(base.h / 2);
	return top ? { ...base, h: topHeight } : { ...base, y: base.y + topHeight, h: base.h - topHeight };
}

/**
 * Where the window sits, as persisted: the rectangle, the dock it is in (null being
 * free-floating), and the free size a tear-off restores.
 *
 * The dock is saved as well as the rectangle because reopening must not demote a docked
 * window to a free one wearing the dock's dimensions.
 */
export interface Placement extends Rect {
	snappedZone?: SnapZone | null;
	freeW?: number;
	freeH?: number;
}

export function readPlacement(key: string): Placement | null {
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<Placement>;
		// A hand-edited or half-written entry must not put the window at NaN, where it is
		// on screen but unreachable, and no clamp can recover it.
		if (
			typeof parsed?.x !== 'number' ||
			typeof parsed?.y !== 'number' ||
			typeof parsed?.w !== 'number' ||
			typeof parsed?.h !== 'number' ||
			!Number.isFinite(parsed.x) ||
			!Number.isFinite(parsed.y) ||
			!Number.isFinite(parsed.w) ||
			!Number.isFinite(parsed.h)
		) {
			return null;
		}
		return {
			x: parsed.x,
			y: parsed.y,
			w: parsed.w,
			h: parsed.h,
			snappedZone: isSnapZone(parsed.snappedZone) ? parsed.snappedZone : null,
			...(typeof parsed.freeW === 'number' && Number.isFinite(parsed.freeW)
				? { freeW: parsed.freeW }
				: {}),
			...(typeof parsed.freeH === 'number' && Number.isFinite(parsed.freeH)
				? { freeH: parsed.freeH }
				: {})
		};
	} catch {
		return null; // unreadable or malformed, so fall back to the default placement
	}
}

export function writePlacement(key: string, placement: Placement): void {
	try {
		localStorage.setItem(key, JSON.stringify(placement));
	} catch {
		/* storage unavailable, so the placement just will not persist */
	}
}

/** Centre a window of `size` in the viewport, clamped. The opening placement when nothing
 *  has been saved: a window that appears under the pointer would land on the thumbnail the
 *  reader just clicked, and one pinned to a corner fights whichever widget already lives there. */
export function centeredRect(size: Size, min: Size, viewport: Size): Rect {
	return clampRect(
		{ w: size.w, h: size.h, x: (viewport.w - size.w) / 2, y: (viewport.h - size.h) / 2 },
		min,
		viewport
	);
}
