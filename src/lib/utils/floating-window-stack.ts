/**
 * Who is in front, when several floating windows overlap.
 *
 * Every open window holds a rung on one shared ladder, and touching a window moves it to
 * the top of that ladder. One ladder, not two: a docked window is on it exactly like a
 * free-floating one, so clicking the notepad docked down the left edge still raises it over
 * a pop-out sitting on top of it. "Docked" is a shape, not a tier.
 *
 * The rungs are a monotonic counter rather than a re-sorted array. Re-sorting would mean
 * every window's z-index changing whenever any one of them is clicked, and each of those is
 * a style write on a panel that did not move; handing out an ever-higher number instead
 * touches exactly the one window that was raised. Only the ORDER of these numbers means
 * anything, and they are consumed inside the windows' own stacking context (the layer in
 * `Workspace.svelte`), so the values never collide with the app's z-index scale and never
 * need to stay small. A session cannot realistically click far enough to exhaust a double.
 *
 * This module owns mutable state on purpose, and it is module-level because the ladder is a
 * property of the screen rather than of any one component. `resetStack` exists for the
 * tests, which would otherwise inherit each other's counter.
 */

/** First rung. Above 0 so a window is never level with an un-raised sibling. */
export const STACK_BASE = 1;

let top = STACK_BASE;

/** Take the top rung, and report which one it is. */
export function raiseToTop(): number {
	return ++top;
}

/** True when `z` is already the frontmost rung handed out. */
export function isTop(z: number): boolean {
	return z === top;
}

/**
 * Raise a window unless it is already in front.
 *
 * The guard is what keeps a click on the frontmost window from advancing the counter, so a
 * window that is repeatedly clicked does not walk the ladder up on its own, and its z-index
 * does not churn on every press.
 */
export function bringToFront(z: number): number {
	return isTop(z) ? z : raiseToTop();
}

/** Test seam: the counter is module state and would otherwise leak between cases. */
export function resetStack(): void {
	top = STACK_BASE;
}
