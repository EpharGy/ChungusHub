/**
 * What a floating panel tells the title bar, and how the title bar arranges what it is told.
 *
 * The pure half of the floating-panel registry, split out for the same reason
 * `floating-window.ts` is split from `FloatingWindow.svelte`: the reactive half holds a
 * `$state` array and cannot be imported by `bun test` at all, so a rule left in there is a
 * rule nothing checks. Everything here is a plain function over plain data, and the module
 * that owns the state (`stores/floating-panels.svelte.ts`) calls into it.
 *
 * The registry's own note explains why registration is a call rather than a table, and why
 * every field describing live state is a getter. This file is only the shapes and the two
 * decisions made from them.
 */

import type { IconName } from '$lib/components/ui/Icon.svelte';

/**
 * How many panel entries the title bar shows as their own buttons before the whole set
 * collapses into one dropdown.
 *
 * The whole set, not the overflow. A row that is part buttons and part menu makes opening
 * the notepad cost one click or two depending on how many unrelated features happen to be
 * installed, and the reader has no way to predict which. Collapsing all of them keeps the
 * act consistent: either every panel is one click, or every panel is two.
 *
 * Two, because the nav cluster is centred between the Settings and Library pills and every
 * inline entry pushes up the width at which the whole row drops its labels. TitleBar
 * computes `NAV_LABELS_MIN_REM` from this constant rather than carrying a number tuned
 * beside it, so raising this cannot silently leave the bar clipping its own labels.
 */
export const TOPBAR_INLINE_LIMIT = 2;

/**
 * A panel offering itself to the title bar.
 *
 * Everything reactive is a getter, because an entry is declared once at module scope and
 * describes a panel whose state changes every turn. The optional fields all default to the
 * unremarkable answer, so a panel that is always available, never disabled, has nothing to
 * badge and is happy with its own name registers four fields.
 */
export interface FloatingPanelEntry {
	/** Stable key. The `{#each}` key, and what `unregister` takes. */
	id: string;
	/**
	 * Left-to-right position in the title bar, low first.
	 *
	 * Explicit, because the implicit alternative is registration order, and registration
	 * order is module import order: nothing a panel author can see, and something a bundler
	 * is free to change. Ties fall back to `id`, so the order is total and a rebuild cannot
	 * reshuffle two panels that happened to pick the same number.
	 */
	order: number;
	/** The button's word. Shown beside the icon at widths that carry labels, and the
	 *  accessible name at every width. */
	label: string;
	icon: IconName;
	/** Whether the panel is on screen right now: what tints the button. */
	isOpen: () => boolean;
	/** Open it if closed, put it away if open. */
	toggle: () => void;
	/**
	 * Whether the entry appears at all. Default: it does.
	 *
	 * For a panel that has nothing to show rather than one that is merely closed. The image
	 * pop-out is the case: there is no such thing as opening it cold, since it is launched
	 * from a picture, so its entry exists only while a picture is popped out and is a way
	 * back to that window rather than a way to make one.
	 */
	available?: () => boolean;
	/**
	 * Whether the entry is present but inert. Default: it is not.
	 *
	 * The other half of `available`, for a panel that WILL be openable and is not yet. The
	 * notepad on the welcome screen: hiding it would shift the whole cluster sideways the
	 * moment a chat opened, so it stays put, greys out, and says why through `tooltip`.
	 */
	disabled?: () => boolean;
	/** The button's title text. Default: the label. Worth overriding wherever the plain name
	 *  cannot say why the button is disabled, or what is waiting behind it. */
	tooltip?: () => string;
	/**
	 * A dot on the button. Default: none.
	 *
	 * For "there is something in here you have not seen", which a closed panel cannot
	 * otherwise say. Deliberately not the active tint, which means "this is on screen right
	 * now" everywhere else in the row.
	 */
	badge?: () => boolean;
}

/**
 * Registration order into display order.
 *
 * By `order`, then by `id`: the tiebreak is what makes this a total order rather than one
 * that depends on which module the bundler happened to pull in first, and two panels
 * sharing an `order` is a collision nobody notices until the row silently swaps on a
 * rebuild.
 */
export function sortPanels(entries: readonly FloatingPanelEntry[]): FloatingPanelEntry[] {
	return [...entries].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/**
 * The entries with something to show, in order.
 *
 * `available` is the panel's own reactive state, so this takes it as a predicate rather
 * than calling the getter itself: the caller is the component, and the read has to happen
 * inside the component's reactive scope to be tracked there. A missing getter means
 * available, which is what makes it the field a simple panel never writes.
 */
export function availablePanels(
	entries: readonly FloatingPanelEntry[],
	isAvailable: (entry: FloatingPanelEntry) => boolean = (e) => e.available?.() ?? true
): FloatingPanelEntry[] {
	return sortPanels(entries).filter(isAvailable);
}

/**
 * How the title bar draws a set of available entries: as their own buttons, or as one
 * dropdown holding all of them.
 *
 * Exactly one of the two lists is ever non-empty, which is the point of returning both
 * rather than a mode and a list: the template renders each list and neither branch has to
 * ask which mode it is in. Both empty is the ordinary state of an app with no panels
 * available, and it must draw nothing at all: not an empty cluster, and emphatically not
 * a chevron opening onto a menu with no items in it.
 *
 * A limit of zero collapses even a single panel, which is a legitimate way to ask for
 * "always a menu" and falls out of the comparison rather than needing a case.
 */
export function topbarLayout(
	entries: readonly FloatingPanelEntry[],
	limit: number = TOPBAR_INLINE_LIMIT
): { inline: FloatingPanelEntry[]; menu: FloatingPanelEntry[] } {
	const ordered = sortPanels(entries);
	if (ordered.length === 0) return { inline: [], menu: [] };
	return ordered.length <= limit ? { inline: ordered, menu: [] } : { inline: [], menu: ordered };
}
