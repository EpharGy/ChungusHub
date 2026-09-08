/**
 * Which floating panels exist, and how the title bar offers them.
 *
 * `FloatingWindow` answers "how does a panel drag, dock and remember where it was". This
 * answers the question that comes before it: how does anyone OPEN one. A window with no
 * way back is a window that closes once, and the shell renders nothing until something
 * sets `open`, so an entry point is not decoration on this layer: it is the half that
 * makes the other half reachable.
 *
 * **Every registered panel gets a title-bar entry, and that is not a per-panel option.**
 * The alternative was a flag, and a flag means a panel can register itself with no entry
 * point at all, which is the one configuration that cannot work. It also means the title
 * bar is the single place a reader looks for "what can I open", instead of the answer
 * being spread across a title bar, a settings page, and whichever widget happened to pin a
 * launcher to the edge of the screen.
 *
 * There is deliberately **no settings page for this layer**. Registration is the whole API,
 * the entry is the whole control surface, and `TOPBAR_INLINE_LIMIT` is a constant rather
 * than a preference: a settings page whose every row reads "show the button for the panel
 * you can already see a button for" is a page that exists to be configured and never is.
 *
 * ## Registration is a call, not a row in a table
 *
 * The obvious shape for this is an array of panel definitions in one file, which is what
 * `engines/registry.ts` and `config/settings-pages.ts` both are. It is the wrong shape
 * here, for a reason particular to how this fork is built rather than to taste: a panel
 * arrives on its own topic branch, so a shared table is a line every branch adds in the
 * same place, and that is a conflict re-fought on every single rebuild. A `register` call
 * sited in the panel's OWN module is a line no other branch can collide with.
 *
 * The cost is that registration is an import side effect, so a panel is registered only
 * once something has imported its module. In practice the app shell mounts every panel's
 * window component, which imports its store, which registers: the chain that makes the
 * panel exist at all is the chain that registers it. A panel that is somehow not mounted
 * has no window to open either, so the failure mode is consistent rather than confusing.
 *
 * ## Nothing testable lives in this file
 *
 * The shapes, the ordering and the inline-versus-dropdown decision are all in
 * `$lib/utils/floating-panels`, which is plain and unit-tested. This file holds the one
 * thing that has to be reactive, and a module carrying `$state` cannot be imported by
 * `bun test` at all, so a rule left in here would be a rule nothing checks. Same split,
 * and the same reason, as `floating-window.ts` against `FloatingWindow.svelte`.
 */

import { sortPanels, type FloatingPanelEntry } from '$lib/utils/floating-panels';

export {
	TOPBAR_INLINE_LIMIT,
	availablePanels,
	topbarLayout,
	type FloatingPanelEntry
} from '$lib/utils/floating-panels';

class FloatingPanelRegistry {
	/**
	 * Reactive so a panel registered after the title bar first rendered still appears. Not
	 * a hypothetical: registration rides an import, and a module can be pulled in lazily or
	 * re-run by hot reload during development.
	 */
	private entries = $state<FloatingPanelEntry[]>([]);

	/**
	 * Every registered panel, in title-bar order.
	 *
	 * Unfiltered. `available` is reactive and belongs to the consumer's own state, so
	 * calling it here would read that state inside the registry rather than inside the
	 * component doing the rendering, and the dependency would be tracked in the wrong
	 * place: the button would stop appearing and disappearing on its own. The title bar
	 * filters, in its own `$derived`.
	 */
	get all(): FloatingPanelEntry[] {
		return sortPanels(this.entries);
	}

	/**
	 * Add a panel, or replace one already registered under the same id.
	 *
	 * Replacing rather than refusing, because the duplicate case in practice is hot reload
	 * re-running a module, and throwing there would take the dev server down over a saved
	 * file. A genuine id collision between two panels is a mistake this cannot detect, and
	 * it shows up as one entry where two were expected.
	 */
	register(entry: FloatingPanelEntry): void {
		const at = this.entries.findIndex((e) => e.id === entry.id);
		if (at === -1) this.entries.push(entry);
		else this.entries[at] = entry;
	}

	/** Remove a panel. Nothing in the app does this today; it exists so a panel mounted
	 *  conditionally can withdraw its entry rather than leaving a button behind. */
	unregister(id: string): void {
		const at = this.entries.findIndex((e) => e.id === id);
		if (at !== -1) this.entries.splice(at, 1);
	}
}

export const floatingPanels = new FloatingPanelRegistry();

/** Sugar for the one call a panel makes. Named so the line reads as a declaration at the
 *  bottom of the module that owns the panel. */
export function registerFloatingPanel(entry: FloatingPanelEntry): void {
	floatingPanels.register(entry);
}
