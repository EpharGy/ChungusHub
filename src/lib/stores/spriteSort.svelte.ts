/**
 * How the character editor's Sprites grid is ordered.
 *
 * One choice for the whole app and not one per character: a set of forty is where ordering
 * starts to matter, and re-picking it in every character would cost exactly the work it exists
 * to save. Rides the settings spine like the browse-view prefs, so it survives a reload and
 * follows the user to their other devices.
 *
 * Display only: the stored sprite list is never reordered (`sortSprites` in utils/sprites.ts).
 */
import { readSetting, writeSetting, registerSettingsReload } from '$lib/services/syncedSetting';
import type { SpriteSort } from '$lib/utils/sprites';

const SETTINGS_KEY = 'spriteSort';

/** The orders offered, in the order they are offered. Also the validity list a stored value is
 *  read back through, so an option that goes away cannot leave a device on it. */
export const SPRITE_SORT_OPTIONS: { id: SpriteSort; label: string }[] = [
	{ id: 'upload', label: 'Upload order' },
	{ id: 'a-z', label: 'A → Z' },
	{ id: 'z-a', label: 'Z → A' }
];

const DEFAULT_ORDER: SpriteSort = 'upload';

function normalize(raw: unknown): SpriteSort {
	return SPRITE_SORT_OPTIONS.find((option) => option.id === raw)?.id ?? DEFAULT_ORDER;
}

class SpriteSortPref {
	order = $state<SpriteSort>(DEFAULT_ORDER);

	async initialize(): Promise<void> {
		await this.syncReload();
		registerSettingsReload(() => this.syncReload());
	}

	async syncReload(): Promise<void> {
		this.order = normalize(await readSetting<unknown>(SETTINGS_KEY, null));
	}

	set(order: SpriteSort): void {
		this.order = order;
		writeSetting(SETTINGS_KEY, order);
	}
}

export const spriteSortPref = new SpriteSortPref();
