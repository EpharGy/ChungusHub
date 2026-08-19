/**
 * Commit a debounced write before the tab can be taken away.
 *
 * `pagehide` only covers a real close or a bfcache entry. A tab that is merely
 * BACKGROUNDED (a laptop lid closing, an app switch on a phone) fires
 * `visibilitychange` and nothing else: the browser freezes its timers there and may
 * discard the page without another event. A debounce window left running across that gap
 * either dies with the page, or fires on wake and writes pre-sleep text over whatever
 * another device changed in the meantime. Both events, one commit.
 *
 * Listeners are never removed: every caller is a module-level store that lives as long as
 * the page does.
 */
export function flushOnHide(commit: () => void): void {
	if (typeof window === 'undefined') return;
	window.addEventListener('pagehide', commit);
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) commit();
	});
}
