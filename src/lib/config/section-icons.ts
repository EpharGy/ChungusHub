/**
 * The icons a preset may put on a section heading.
 *
 * Deliberately a short curated set rather than the whole icon registry, for two reasons.
 * An author picks from a menu instead of guessing a registry key. And because the icon
 * name arrives inside a downloaded preset, an open field would let a stranger's typo
 * (or a rename on our side) reach the renderer as an unknown key. Anything not on this
 * list is simply not drawn.
 */
export const SECTION_ICONS = [
	'sparkles',
	'feather',
	'bookOpen',
	'scroll',
	'users',
	'mask',
	'heart',
	'flame',
	'sword',
	'shield',
	'dice',
	'compass',
	'globe',
	'mapPin',
	'clock',
	'brain',
	'eye',
	'flask',
	'wrench',
	'sliders',
	'filter',
	'lock',
	'star',
	'target'
] as const;

export type SectionIcon = (typeof SECTION_ICONS)[number];

export function isSectionIcon(value: string | undefined): value is SectionIcon {
	return !!value && (SECTION_ICONS as readonly string[]).includes(value);
}
