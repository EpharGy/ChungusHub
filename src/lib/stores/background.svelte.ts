/**
 * Workspace background image.
 *
 * One synced setting: which image (a /files/-relative path, bundled default or
 * user upload) backs the workspace, plus readability knobs (dim + blur). Renders
 * beneath the ambient layer in Workspace.svelte; picked from Settings → Interface.
 */
import { readSetting, writeSetting, registerSettingsReload } from '$lib/services/syncedSetting';
import { fileUrl } from '$lib/services/transport';

const SETTINGS_KEY = 'backgroundConfig';

export interface BackgroundConfig {
	/** /files/-relative image path (e.g. backgrounds/foo.jpg), or null for none. */
	path: string | null;
	/** How strongly the image is darkened, 0..0.9. Plain black on every palette:
	 *  the scrim is photographic, not part of the app's surface language, so the
	 *  theme has no say in it (architecture/ui-shell-settings.md). */
	dim: number;
	/** Gaussian blur over the image, 0..24 px. */
	blur: number;
}

export const DEFAULT_BACKGROUND: BackgroundConfig = {
	path: null,
	dim: 0.35,
	blur: 0
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, value));
}

function normalizeConfig(parsed: Partial<BackgroundConfig> | null): BackgroundConfig {
	if (!parsed) return { ...DEFAULT_BACKGROUND };
	return {
		path: typeof parsed.path === 'string' && parsed.path ? parsed.path : null,
		dim: clampNumber(parsed.dim, 0, 0.9, DEFAULT_BACKGROUND.dim),
		blur: clampNumber(parsed.blur, 0, 24, DEFAULT_BACKGROUND.blur)
	};
}

class BackgroundStore {
	config = $state<BackgroundConfig>({ ...DEFAULT_BACKGROUND });

	/** Resolved image URL, or null when no background is set. */
	url = $derived(this.config.path ? fileUrl(this.config.path) : null);

	async initialize(): Promise<void> {
		this.config = normalizeConfig(
			await readSetting<Partial<BackgroundConfig> | null>(SETTINGS_KEY, null)
		);
		registerSettingsReload(() => this.syncReload());
	}

	async syncReload(): Promise<void> {
		this.config = normalizeConfig(
			await readSetting<Partial<BackgroundConfig> | null>(SETTINGS_KEY, null)
		);
	}

	private persist(): void {
		writeSetting(SETTINGS_KEY, this.config);
	}

	setBackground(path: string | null): void {
		this.config.path = path;
		this.persist();
	}

	setDim(dim: number): void {
		this.config.dim = clampNumber(dim, 0, 0.9, this.config.dim);
		this.persist();
	}

	setBlur(blur: number): void {
		this.config.blur = clampNumber(blur, 0, 24, this.config.blur);
		this.persist();
	}

	clear(): void {
		this.config = { ...DEFAULT_BACKGROUND };
		this.persist();
	}
}

export const backgroundStore = new BackgroundStore();
