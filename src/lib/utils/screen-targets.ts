/**
 * What is actually on screen and reachable: the shared candidate pass behind both keyboard
 * surfaces that read the rendered page rather than a component's own state (the hint labels
 * and the focus keys).
 *
 * **The occlusion test is the point, and it is not optional in this app.** Panels stack over
 * the chat and every panel scrolls, so a control covered by an overlay, or scrolled out of the
 * box it lives in, keeps a rect on screen exactly like a control anyone can reach. A label
 * drawn there points at something the press would never land on, and a focus key that moved to
 * it would put the keyboard somewhere invisible.
 */

export interface ScreenTarget {
	el: HTMLElement;
	rect: DOMRect;
}

/** Everything matching `selector` that is on screen, not covered and not disabled. */
export function visibleTargets(selector: string): ScreenTarget[] {
	const found: ScreenTarget[] = [];
	for (const el of document.querySelectorAll<HTMLElement>(selector)) {
		if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') continue;
		const rect = el.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) continue;
		if (rect.bottom < 0 || rect.right < 0) continue;
		if (rect.top > window.innerHeight || rect.left > window.innerWidth) continue;
		// The point is clamped into the viewport, so a control half off the edge is still
		// tested where it can actually be seen rather than where its centre happens to fall.
		const x = Math.min(Math.max(rect.left + rect.width / 2, 1), window.innerWidth - 1);
		const y = Math.min(Math.max(rect.top + rect.height / 2, 1), window.innerHeight - 1);
		const hit = document.elementFromPoint(x, y);
		if (!hit || !(hit === el || el.contains(hit))) continue;
		found.push({ el, rect });
	}
	return found;
}
