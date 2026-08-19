/**
 * Global preset-control values, plus each preset's adopted setup.
 *
 * Preset authors expose friendly widgets (toggles, sliders, selects, …) bound to
 * macros; these are the user's chosen values for them. Formerly per-chat, now a
 * single global set used by every chat. Persisted to the settings table.
 *
 * `appliedSetups` is the reader's other piece of state: which of a preset's setting
 * kits they adopted as their baseline, by preset id. It is stored rather than derived
 * from value-matching, because a matched-derived selection collapses the moment one
 * knob moves and leaves "reset" pointing at two different configurations at once.
 */
import { db } from '$lib/services/database';

const PRESET_CONTROL_VALUES_KEY = 'presetControlValues';
const APPLIED_SETUPS_KEY = 'presetAppliedSetups';

class PresetControlsStore {
	values = $state<Record<string, unknown>>({});

	/** Preset id → the kit id whose configuration the reader adopted as their baseline.
	 *  Absent means the per-control defaults are the baseline. An id naming no existing
	 *  kit is kept, not pruned: the page derives it to the defaults baseline, and pruning
	 *  would turn an author's unsaved kit delete into permanent loss of the selection. */
	appliedSetups = $state<Record<string, string>>({});

	async initialize(): Promise<void> {
		await this.load();
	}

	async syncReload(): Promise<void> {
		await this.load();
	}

	private async load(): Promise<void> {
		this.values = await readPresetControlValues();
		this.appliedSetups = await readAppliedSetups();
	}

	/** Set one control's value, keyed by the control's macro name, and persist. */
	setValue(macro: string, value: unknown): void {
		this.write({ ...this.values, [macro]: value });
	}

	/** Forget a control's value so it falls back to the author's default. Deleting the key
	 *  rather than writing the default in is what keeps "back to the author's" meaningful:
	 *  a stored copy would freeze today's default and stop tracking a preset update. */
	clearValue(macro: string): void {
		const { [macro]: _dropped, ...rest } = this.values;
		this.write(rest);
	}

	/** Adopt a configuration in one write and one settings broadcast: write the values a
	 *  kit names and clear every other macro the preset owns, so the result is exactly the
	 *  configuration being adopted rather than it layered over the reader's leftovers. */
	applyValues(values: Record<string, unknown>, clearMacros: string[] = []): void {
		const next = { ...this.values, ...values };
		for (const macro of clearMacros) delete next[macro];
		this.write(next);
	}

	/** Remember which setup a preset's reader adopted as their baseline; null means the
	 *  per-control defaults are. */
	setAppliedSetup(presetId: string, bundleId: string | null): void {
		const next = { ...this.appliedSetups };
		if (bundleId === null) delete next[presetId];
		else next[presetId] = bundleId;
		this.appliedSetups = next;
		void db.setSetting(APPLIED_SETUPS_KEY, JSON.stringify(next));
	}

	private write(values: Record<string, unknown>): void {
		this.values = values;
		void db.setSetting(PRESET_CONTROL_VALUES_KEY, JSON.stringify(values));
	}
}

export const presetControlsStore = new PresetControlsStore();

/**
 * Read the global preset-control values straight from settings. The one reader of the row:
 * the generation path calls it directly (fresh), the store calls it to fill its cache.
 * A corrupt row throws rather than resolving to an empty set, which would send every control
 * at its author default and read as the preset being wrong.
 */
export async function readPresetControlValues(): Promise<Record<string, unknown>> {
	const raw = await db.getSetting(PRESET_CONTROL_VALUES_KEY);
	if (!raw) return {};
	const parsed = JSON.parse(raw);
	if (!parsed || typeof parsed !== 'object') {
		throw new Error(`${PRESET_CONTROL_VALUES_KEY} is not an object`);
	}
	return parsed;
}

/** Same contract as the values row: a corrupt row throws rather than quietly resetting
 *  every preset's baseline to the defaults. Generation never reads this: the adopted
 *  setup shapes only what "reset" and "modified" mean on the reader's page. */
async function readAppliedSetups(): Promise<Record<string, string>> {
	const raw = await db.getSetting(APPLIED_SETUPS_KEY);
	if (!raw) return {};
	const parsed = JSON.parse(raw);
	if (!parsed || typeof parsed !== 'object') {
		throw new Error(`${APPLIED_SETUPS_KEY} is not an object`);
	}
	return parsed;
}
