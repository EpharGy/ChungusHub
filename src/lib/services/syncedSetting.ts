/**
 * Synced settings primitive.
 *
 * The app's cross-device spine is the server `settings` key-value table: writing a
 * value broadcasts a coarse `{t:'sync', scope:'settings'}` hint, and every other
 * device re-reads. These helpers let any store ride that spine instead of leaking
 * to per-device localStorage: read/write a JSON value by key, and register a
 * reload that fires on every incoming `settings` broadcast.
 */
import { db } from '$lib/services/database';
import { toastStore } from '$lib/stores/toast.svelte';

const reloaders = new Set<() => Promise<void>>();

/** Register a store's reload; invoked on every incoming `settings` sync broadcast.
 *  Returns a disposer: boot-time stores ignore it, a component that mounts and unmounts
 *  must call it or its dead closure keeps reloading. */
export function registerSettingsReload(fn: () => Promise<void>): () => void {
	reloaders.add(fn);
	return () => {
		reloaders.delete(fn);
	};
}

/** Re-read every registered synced setting. Called from sync.ts on `settings` scope. */
export async function reloadAllSyncedSettings(): Promise<void> {
	await Promise.all([...reloaders].map((fn) => fn()));
}

/** Read a JSON-encoded setting, falling back on missing or corrupt values. */
export async function readSetting<T>(key: string, fallback: T): Promise<T> {
	const raw = await db.getSetting(key);
	if (raw == null) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

/** Persist a setting as JSON. This is the write that triggers the `settings` broadcast. */
export function writeSetting(key: string, value: unknown): void {
	void db.setSetting(key, JSON.stringify(value)).catch((error) => {
		// The store already moved, so a silent failure means this device shows a value no
		// other device (and not the next boot) will ever agree with. Say it out loud.
		console.error(`[settings] write failed for "${key}":`, error);
		toastStore.error(`Couldn't save "${key}". The change is on screen but not stored.`);
	});
}
