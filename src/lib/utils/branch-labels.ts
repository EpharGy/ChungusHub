/**
 * The fixed palette a branch label can be tinted with. We store the palette KEY on the
 * label (not a raw CSS color) so a book of routes keeps its colors across theme switches
 * and never bakes in a value that clashes with a future theme. Hues are chosen to read on
 * both light and dark surfaces.
 */

export interface BranchColor {
	key: string;
	label: string;
	hex: string;
}

export const BRANCH_COLORS: BranchColor[] = [
	{ key: 'crimson', label: 'Crimson', hex: '#e5484d' },
	{ key: 'amber', label: 'Amber', hex: '#f5a524' },
	{ key: 'emerald', label: 'Emerald', hex: '#30a46c' },
	{ key: 'sky', label: 'Sky', hex: '#3b9eff' },
	{ key: 'violet', label: 'Violet', hex: '#9d7bff' },
	{ key: 'rose', label: 'Rose', hex: '#e93d82' },
	{ key: 'teal', label: 'Teal', hex: '#12a594' },
	{ key: 'slate', label: 'Slate', hex: '#8b98a8' }
];

const BY_KEY = new Map(BRANCH_COLORS.map((c) => [c.key, c]));

/** Resolve a palette key to its CSS hex, falling back to slate for unknown/legacy keys. */
export function branchColorHex(key: string | undefined | null): string {
	return (key && BY_KEY.get(key)?.hex) || '#8b98a8';
}

/** A stable palette key derived from an id, so an unlabeled-but-colored default is
 *  deterministic and spreads evenly across the palette. */
export function defaultBranchColorKey(seed: string): string {
	let h = 0;
	for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
	return BRANCH_COLORS[Math.abs(h) % BRANCH_COLORS.length].key;
}
