/**
 * Tests for the ambient model: what a stored mix degrades to, what an older one carries
 * across, and which side of the story each effect paints on. Run with `bun test`.
 *
 * All of it matters beyond the mixer's own screen: the same normalizer reads the app-wide
 * setting and the copy inside a chat's scene, and the carry-over is the only thing
 * standing between an existing install and an ambient look that quietly changed under it.
 */

import { describe, expect, test } from 'bun:test';

import {
	AMBIENT_BASE_SETTINGS,
	DEFAULT_AMBIENT_CONFIG,
	effectSetting,
	effectsPlaced,
	getEffectSettingDefaults,
	normalizeAmbientConfig,
	settingsFor,
	type AmbientConfig
} from './ambient';

const base = (patch: Partial<AmbientConfig> = {}): AmbientConfig => ({
	...DEFAULT_AMBIENT_CONFIG,
	types: ['rain', 'snow'],
	enabled: true,
	...patch
});

describe('settingsFor', () => {
	test('every effect carries the shared knobs, in front of its own', () => {
		const keys = settingsFor('storm').map((def) => def.key);
		expect(keys.slice(0, AMBIENT_BASE_SETTINGS.length)).toEqual(
			AMBIENT_BASE_SETTINGS.map((def) => def.key)
		);
		expect(keys).toContain('lightning');
	});

	test('an effect with nothing of its own still has the shared four', () => {
		expect(settingsFor('snow').map((def) => def.key)).toEqual(
			AMBIENT_BASE_SETTINGS.map((def) => def.key)
		);
	});

	test('the defaults cover every key the row will draw', () => {
		const defaults = getEffectSettingDefaults('rain');
		expect(Object.keys(defaults).sort()).toEqual(settingsFor('rain').map((d) => d.key).sort());
	});
});

describe('effectSetting', () => {
	test('an untouched knob reads its shipped default', () => {
		expect(effectSetting(base(), 'rain', 'density')).toBe(1);
		expect(effectSetting(base(), 'rain', 'splashes')).toBe(1);
	});

	test('a stored value wins, and reaches that effect alone', () => {
		const config = base({ effectSettings: { rain: { density: 0.4 } } });
		expect(effectSetting(config, 'rain', 'density')).toBe(0.4);
		expect(effectSetting(config, 'snow', 'density')).toBe(1);
	});

	test('one knob stored leaves the others on their defaults', () => {
		const config = base({ effectSettings: { rain: { density: 0.4 } } });
		expect(effectSetting(config, 'rain', 'speed')).toBe(1);
	});
});

describe('effectsPlaced', () => {
	test('every effect draws over the story until one is told otherwise', () => {
		expect(effectsPlaced(base(), 'over')).toEqual(['rain', 'snow']);
		expect(effectsPlaced(base(), 'under')).toEqual([]);
	});

	test('an effect switched off the top moves to the other side alone', () => {
		const config = base({ effectSettings: { snow: { overMessages: 0 } } });
		expect(effectsPlaced(config, 'over')).toEqual(['rain']);
		expect(effectsPlaced(config, 'under')).toEqual(['snow']);
	});

	test('mix order survives the split', () => {
		const config = base({
			types: ['fog', 'rain', 'snow'],
			effectSettings: { fog: { overMessages: 0 }, snow: { overMessages: 0 } }
		});
		expect(effectsPlaced(config, 'under')).toEqual(['fog', 'snow']);
	});

	test('`clear` and repeats never reach a canvas', () => {
		const config = base({ types: ['clear', 'rain', 'rain'] });
		expect(effectsPlaced(config, 'over')).toEqual(['rain']);
	});
});

describe('normalizeAmbientConfig', () => {
	test('null and junk degrade to the shipped mix', () => {
		expect(normalizeAmbientConfig(null)).toEqual(DEFAULT_AMBIENT_CONFIG);
		expect(normalizeAmbientConfig('rain')).toEqual(DEFAULT_AMBIENT_CONFIG);
	});

	test('unknown effects are dropped and the rest keep their order', () => {
		expect(normalizeAmbientConfig({ types: ['snow', 'thunderdome', 'rain', 'snow'] }).types).toEqual(
			['snow', 'rain']
		);
	});

	test('an out-of-range or unknown knob is clamped or dropped, never trusted', () => {
		const config = normalizeAmbientConfig({
			types: ['rain'],
			effectSettings: { rain: { density: 40, visibility: -3, nonsense: 1, speed: 'fast' } }
		});
		expect(config.effectSettings.rain).toEqual({ density: 2, visibility: 0.05 });
	});

	test('settings for an effect nobody knows are dropped whole', () => {
		const config = normalizeAmbientConfig({
			types: ['rain'],
			effectSettings: { thunderdome: { density: 1.5 } }
		});
		expect(config.effectSettings).toEqual({});
	});

	test('a mix nobody has tuned stores nothing at all', () => {
		expect(normalizeAmbientConfig({ types: ['rain', 'snow'] }).effectSettings).toEqual({});
	});
});

describe('normalizeAmbientConfig: what an older blob carries across', () => {
	test('the whole-mix knobs land on every effect that is playing', () => {
		// The look on screen came from one set of sliders scaling the stack. Carrying them
		// onto the playing effects is what makes the upgrade invisible.
		const config = normalizeAmbientConfig({
			types: ['rain', 'snow'],
			density: 1.5,
			speed: 0.5,
			visibility: 0.8,
			particlesOverMessages: false
		});
		expect(config.effectSettings.rain).toEqual({
			density: 1.5,
			speed: 0.5,
			visibility: 0.8,
			overMessages: 0
		});
		expect(config.effectSettings.snow).toEqual(config.effectSettings.rain);
		expect(effectsPlaced(config, 'under')).toEqual(['rain', 'snow']);
	});

	test('an effect that was only parked is left on the defaults', () => {
		// The number on screen was never that effect's, so inventing one for it would be a
		// guess rather than a carry-over.
		const config = normalizeAmbientConfig({
			types: ['rain'],
			density: 1.5,
			effectSettings: { snow: { splashes: 1 } }
		});
		expect(config.effectSettings.snow).toBeUndefined();
		expect(effectSetting(config, 'snow', 'density')).toBe(1);
	});

	test('a knob the effect already carries beats the one being carried over', () => {
		const config = normalizeAmbientConfig({
			types: ['rain'],
			density: 1.5,
			effectSettings: { rain: { density: 0.4 } }
		});
		expect(config.effectSettings.rain?.density).toBe(0.4);
	});

	test('a knob the old blob never held lands on its shipped default', () => {
		const config = normalizeAmbientConfig({ types: ['rain'], density: 1.5 });
		expect(config.effectSettings.rain).toEqual({ density: 1.5 });
		expect(effectSetting(config, 'rain', 'speed')).toBe(1);
	});

	test('the oldest blobs carry their single intensity the same way', () => {
		// Older still: one `intensity` that scaled both alpha and motion.
		const config = normalizeAmbientConfig({ type: 'rain', intensity: 0.5 });
		expect(config.types).toEqual(['rain']);
		expect(config.effectSettings.rain).toEqual({ speed: 1, visibility: 0.5 });
	});

	test('carrying over is idempotent: normalizing the result changes nothing', () => {
		const once = normalizeAmbientConfig({
			types: ['rain'],
			density: 1.5,
			particlesOverMessages: false
		});
		expect(normalizeAmbientConfig(JSON.parse(JSON.stringify(once)))).toEqual(once);
	});
});
