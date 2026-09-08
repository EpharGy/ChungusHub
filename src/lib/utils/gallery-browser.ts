/**
 * Which cards the gallery window offers to browse, and in what order.
 *
 * Pure, and split from the component for the reason the rest of this layer is: the ordering
 * rule is the sort of thing nobody notices is wrong until a card is missing from a list, and
 * a rule inside a `.svelte` file is a rule `bun test` cannot reach.
 *
 * The window browses the LIBRARY, not the chat. A picture pinned up while reading one story
 * routinely belongs to somebody who is not in it, so filtering to the cast would hide most of
 * what a reader actually wants.
 */

import type { LibraryEntryType } from '$lib/types/library';
import type { PortraitFocus } from '$lib/utils/portrait-focus';

/**
 * The part of a library entry the picker reads, and nothing else.
 *
 * Deliberately narrower than `LibraryEntry`, which a real one satisfies structurally. Asking
 * for the whole entry would buy nothing here and would make every test case a fake character
 * sheet: traits, versions, favourite flags and timestamps, none of which this looks at.
 */
export interface BrowsableEntry {
	id: string;
	type: LibraryEntryType;
	identity: {
		name?: string;
		imageUrl?: string;
		gallery?: string[];
		/** Carried through untouched so a card's tile here is cropped the way its tile is
		 *  cropped everywhere else. Opaque to this module, which never reads inside it. */
		portraitFocus?: PortraitFocus;
	};
}

/** One row of the card picker: a card that has at least one picture to offer. */
export interface GalleryCard {
	id: string;
	name: string;
	type: LibraryEntryType;
	/** The card's own portrait, for its tile. Absent is ordinary, and the tile draws the
	 *  same person glyph the library's own grids draw for it. */
	imageUrl?: string;
	/** Where the tile aims inside the portrait, as the library's own grids draw it. */
	portraitFocus?: PortraitFocus;
	/** Non-empty and duplicate-free by construction: a card with nothing in its gallery is not
	 *  a row here, and the picker keys its tiles on the path. */
	gallery: string[];
}

/** Personas before characters. Two groups rather than one list because they are two kinds of
 *  thing, and there are always far fewer personas, so putting them first costs a character
 *  card nothing and saves a scroll on the group a reader is likelier to want. */
const TYPE_RANK: Record<LibraryEntryType, number> = { persona: 0, character: 1 };

/**
 * Every card with at least one gallery image, personas first, alphabetical within each group.
 *
 * A card with an empty or absent gallery is dropped rather than shown and refused: a tile that
 * opens onto nothing is a click that teaches the reader not to trust the grid.
 *
 * Sorted by name with `localeCompare` and a case-insensitive fold, then by id: without the
 * tiebreak two cards sharing a name (which the library allows, and which duplication produces
 * routinely) could swap places between renders for no visible reason.
 */
export function browsableCards(entries: readonly BrowsableEntry[]): GalleryCard[] {
	return entries
		.filter((entry) => (entry.identity.gallery?.length ?? 0) > 0)
		.map((entry) => ({
			id: entry.id,
			name: entry.identity.name?.trim() || 'Untitled',
			type: entry.type,
			imageUrl: entry.identity.imageUrl,
			portraitFocus: entry.identity.portraitFocus,
			// De-duplicated, not merely copied. The picker keys its tiles on the path, and a
			// keyed block given the same key twice throws rather than drawing the picture twice,
			// so a gallery that somehow held one path twice would take the whole window down.
			// Cheaper to make the invariant true here than to key the grid on an index and lose
			// the identity that keying is for.
			gallery: [...new Set(entry.identity.gallery ?? [])]
		}))
		.sort(
			(a, b) =>
				TYPE_RANK[a.type] - TYPE_RANK[b.type] ||
				a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
				a.id.localeCompare(b.id)
		);
}

/**
 * Where the divider goes: the number of personas at the front.
 *
 * Returned as a count rather than drawn as a row, so the grid can put a seam between the two
 * groups without a non-card entry in the middle of a list of cards. Zero, or the whole length,
 * means one group only and no seam to draw.
 */
export function personaCount(cards: readonly GalleryCard[]): number {
	return cards.filter((card) => card.type === 'persona').length;
}
