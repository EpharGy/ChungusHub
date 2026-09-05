/**
 * Tests for the pure image-generation core. Run with `bun test`.
 *
 * The centre of gravity is the parser's salvage behaviour, because that is what stands
 * between a model's approximate marker and a picture the reader wanted: every case here is
 * a real shape a model produces. The two hard failures are asserted as hard failures, since
 * silently generating from a marker with no prompt is how a reader gets a picture of
 * nothing and no explanation.
 *
 * The other half is the split, which is what makes rendering possible without rewriting the
 * turn: offsets must tile the message exactly, or text disappears from the page.
 */

import { describe, expect, test } from 'bun:test';

import { resolveImagegenSettings, DEFAULT_IMAGEGEN_SETTINGS } from './config';
import { findMarkers, hasImageMarker, parseMarkerBody, splitOnMarkers, wasRepaired } from './parse';
import { buildGenerateRequest, effectiveSeedToken, resolveEffective } from './request';
import type { ParsedMarker } from './types';

/** The canonical marker, as the shipped system prompt teaches it. */
const CANONICAL = '[[IMG: 1girl, red hair, white dress | PORTRAIT | MEDIUM | RANDOM ]]';

function ok(body: string): ParsedMarker {
	const result = parseMarkerBody(body);
	if (result.status !== 'ok') throw new Error(`expected ok, got ${result.reason}`);
	return result;
}

describe('parseMarkerBody', () => {
	test('reads the canonical shape', () => {
		const parsed = ok('1girl, red hair, white dress | PORTRAIT | MEDIUM | RANDOM');
		expect(parsed.prompt).toBe('1girl, red hair, white dress');
		expect(parsed.ar).toBe('PORTRAIT');
		expect(parsed.shot).toBe('MEDIUM');
		expect(parsed.seed).toBe('RANDOM');
		expect(wasRepaired(parsed.repairMeta)).toBe(false);
	});

	test('fills what the marker never said, and says it did', () => {
		const parsed = ok('1girl, red hair');
		expect(parsed.ar).toBe('SQUARE');
		expect(parsed.shot).toBe('MEDIUM');
		expect(parsed.seed).toBe('RANDOM');
		expect(parsed.repairMeta.defaulted).toEqual(['AR', 'SHOT', 'SEED']);
		expect(wasRepaired(parsed.repairMeta)).toBe(true);
	});

	test('takes control tokens in any order', () => {
		const parsed = ok('WIDE | 1girl, red hair | 12345 | LANDSCAPE');
		expect(parsed.prompt).toBe('1girl, red hair');
		expect(parsed.ar).toBe('LANDSCAPE');
		expect(parsed.shot).toBe('WIDE');
		expect(parsed.seed).toBe(12345);
	});

	test('first value wins, later ones are recorded and dropped', () => {
		const parsed = ok('1girl | PORTRAIT | SQUARE | CLOSE | WIDE | 7 | 9');
		expect(parsed.ar).toBe('PORTRAIT');
		expect(parsed.shot).toBe('CLOSE');
		expect(parsed.seed).toBe(7);
		expect(parsed.repairMeta.duplicateTokens.AR).toEqual(['SQUARE']);
		expect(parsed.repairMeta.duplicateTokens.SHOT).toEqual(['WIDE']);
		expect(parsed.repairMeta.duplicateTokens.SEED).toEqual(['9']);
	});

	test('salvages tokens the model buried inside the prompt segment', () => {
		const parsed = ok('1girl, red hair, CLOSE, RANDOM, rain');
		expect(parsed.prompt).toBe('1girl, red hair, rain');
		expect(parsed.shot).toBe('CLOSE');
		expect(parsed.seed).toBe('RANDOM');
	});

	test('a bare number in a phrase stays in the prompt, and is flagged', () => {
		const parsed = ok('1girl standing on platform 9432, night');
		expect(parsed.prompt).toBe('1girl standing on platform 9432, night');
		expect(parsed.seed).toBe('RANDOM');
		expect(parsed.repairMeta.possibleSeedInPrompt).toBe(true);
	});

	test('a number alone between commas is the seed the model misplaced', () => {
		const parsed = ok('1girl, 84512, rain');
		expect(parsed.prompt).toBe('1girl, rain');
		expect(parsed.seed).toBe(84512);
	});

	test('lowercase words are prose, never control tokens', () => {
		const parsed = ok('1girl, close up of a wide random field');
		expect(parsed.prompt).toBe('1girl, close up of a wide random field');
		expect(parsed.ar).toBe('SQUARE');
		expect(parsed.shot).toBe('MEDIUM');
	});

	test('pipes never reach the prompt', () => {
		const parsed = ok('1girl | red hair | PORTRAIT');
		expect(parsed.prompt).toBe('1girl, red hair');
	});

	test('the two unrecoverable shapes fail rather than draw nothing', () => {
		expect(parseMarkerBody('')).toMatchObject({ status: 'parse_error', reason: 'empty_marker' });
		expect(parseMarkerBody('   ')).toMatchObject({ status: 'parse_error', reason: 'empty_marker' });
		expect(parseMarkerBody('PORTRAIT | CLOSE | RANDOM')).toMatchObject({
			status: 'parse_error',
			reason: 'empty_prompt'
		});
	});
});

describe('findMarkers / splitOnMarkers', () => {
	test('finds none in ordinary prose', () => {
		expect(hasImageMarker('She turned away.')).toBe(false);
		expect(findMarkers('She turned away.')).toEqual([]);
	});

	test('indexes markers in the order they appear', () => {
		const markers = findMarkers(`before ${CANONICAL} middle ${CANONICAL} after`);
		expect(markers).toHaveLength(2);
		expect(markers[0].index).toBe(0);
		expect(markers[1].index).toBe(1);
		expect(markers[0].end).toBeLessThan(markers[1].start);
	});

	test('offsets tile the message exactly', () => {
		const text = `before ${CANONICAL} after`;
		const rebuilt = splitOnMarkers(text)
			.map((segment) => (segment.kind === 'text' ? segment.text : segment.marker.raw))
			.join('');
		expect(rebuilt).toBe(text);
	});

	test('a message with no marker is one text segment, unchanged', () => {
		const segments = splitOnMarkers('plain reply');
		expect(segments).toEqual([{ kind: 'text', text: 'plain reply' }]);
	});

	test('a marker alone leaves no empty text segments around it', () => {
		const segments = splitOnMarkers(CANONICAL);
		expect(segments).toHaveLength(1);
		expect(segments[0].kind).toBe('marker');
	});

	test('a failed marker still occupies its place', () => {
		const segments = splitOnMarkers('text [[IMG:  ]] more');
		expect(segments).toHaveLength(3);
		expect(segments[1]).toMatchObject({ kind: 'marker' });
		if (segments[1].kind === 'marker') {
			expect(segments[1].marker.result.status).toBe('parse_error');
		}
	});

	test('forgives the ways a model gets the opener slightly wrong', () => {
		// Each of these used to cost a picture and render as raw text in the transcript.
		for (const text of [
			'[[IMG: 1girl | SQUARE ]]',
			'[[ IMG: 1girl | SQUARE ]]',
			'[[IMG : 1girl | SQUARE ]]',
			'[[img: 1girl | SQUARE ]]',
			'[[IMG 1girl | SQUARE ]]',
			'[[IMG:1girl|SQUARE]]',
			'[[IMG: 1girl | SQUARE]]'
		]) {
			const markers = findMarkers(text);
			expect(markers).toHaveLength(1);
			expect(markers[0].result.status).toBe('ok');
		}
	});

	test('a single bracket is prose, not a marker', () => {
		// One keystroke from a markdown link, and a false positive spends GPU time on a
		// sentence somebody wrote.
		expect(findMarkers('[IMG: 1girl]')).toEqual([]);
		expect(hasImageMarker('see [IMG: figure 4] below')).toBe(false);
	});

	test('the word must be IMG, not merely start with it', () => {
		expect(findMarkers('[[IMGUR: 1girl ]]')).toEqual([]);
	});

	test('a multi-line prompt is one marker', () => {
		const markers = findMarkers('[[IMG: 1girl,\nred hair | PORTRAIT ]]');
		expect(markers).toHaveLength(1);
		expect(markers[0].result.status).toBe('ok');
	});
});

describe('locks and prompt assembly', () => {
	const base = resolveImagegenSettings({ prependPrompt: 'masterpiece', appendPrompt: 'detailed' });

	test('builds prepend, shot tags, prompt, append in that order', () => {
		const effective = resolveEffective(ok('1girl, rain | PORTRAIT | CLOSE'), base);
		expect(effective.positivePrompt).toBe('masterpiece, close-up, face focus, 1girl, rain, detailed');
		expect(effective.resolution).toEqual({ width: 512, height: 768 });
	});

	test('a resolution lock overrides the marker, a shot lock replaces its tags', () => {
		const locked = resolveImagegenSettings({
			resolutionLockEnabled: true,
			resolutionLock: { width: 832, height: 1216 },
			shotLockEnabled: true,
			shotLock: 'WIDE'
		});
		const effective = resolveEffective(ok('1girl | PORTRAIT | CLOSE'), locked);
		expect(effective.resolution).toEqual({ width: 832, height: 1216 });
		expect(effective.positivePrompt).toBe('full body, 1girl');
	});

	test('a seed lock replaces the marker token, including with a fixed number', () => {
		expect(effectiveSeedToken('RANDOM', base)).toBe('RANDOM');
		expect(effectiveSeedToken(42, resolveImagegenSettings({ seedLockEnabled: true, seedLockMode: 'LOCK' }))).toBe(
			'LOCK'
		);
		expect(
			effectiveSeedToken('RANDOM', resolveImagegenSettings({
				seedLockEnabled: true,
				seedLockMode: 'CUSTOM',
				seedLockValue: 777
			}))
		).toBe(777);
	});

	test('the request carries the resolved seed and the reader\'s sampler settings', () => {
		const settings = resolveImagegenSettings({ steps: 30, sampler: 'dpmpp_2m', checkpoint: 'model.safetensors' });
		const request = buildGenerateRequest(resolveEffective(ok('1girl'), settings), 99, settings);
		expect(request.seed).toBe(99);
		expect(request.steps).toBe(30);
		expect(request.sampler).toBe('dpmpp_2m');
		expect(request.checkpoint).toBe('model.safetensors');
	});
});

describe('settings resolution', () => {
	test('an empty blob is the shipped defaults, and the engine ships off', () => {
		expect(resolveImagegenSettings(null)).toEqual(DEFAULT_IMAGEGEN_SETTINGS);
		expect(DEFAULT_IMAGEGEN_SETTINGS.enabled).toBe(false);
	});

	test('clamps what a hand-edited blob can put out of range', () => {
		const settings = resolveImagegenSettings({
			steps: 9999,
			cfg: -5,
			denoise: 4,
			timeoutSeconds: 1,
			resolutions: { PORTRAIT: { width: 513, height: 99999 } } as never
		});
		expect(settings.steps).toBe(150);
		expect(settings.cfg).toBe(0);
		expect(settings.denoise).toBe(1);
		expect(settings.timeoutSeconds).toBe(10);
		// Rounded to the multiple of 8 every latent stage needs, then capped.
		expect(settings.resolutions.PORTRAIT).toEqual({ width: 512, height: 4096 });
	});

	test('drops a host trailing slash so one join rule holds everywhere', () => {
		expect(resolveImagegenSettings({ host: 'http://box:8188/' }).host).toBe('http://box:8188');
	});

	test('ignores a shot lock naming a token that does not exist', () => {
		expect(resolveImagegenSettings({ shotLock: 'SIDEWAYS' as never }).shotLock).toBe('MEDIUM');
	});

	test('ships with no cache budget, so an upgrade deletes nothing on its own', () => {
		expect(DEFAULT_IMAGEGEN_SETTINGS.cacheLimitMb).toBe(0);
	});

	test('a cache budget keeps 0 as a real value rather than clamping it up', () => {
		// The other numeric bounds have a smallest-useful floor. This one must not: 0 is how
		// the reader says "no budget", and rounding it up to a small number would turn the
		// off switch into the most destructive setting on the page.
		expect(resolveImagegenSettings({ cacheLimitMb: 0 }).cacheLimitMb).toBe(0);
		expect(resolveImagegenSettings({ cacheLimitMb: -5 }).cacheLimitMb).toBe(0);
		expect(resolveImagegenSettings({ cacheLimitMb: 2048.6 }).cacheLimitMb).toBe(2049);
		expect(resolveImagegenSettings({ cacheLimitMb: 'lots' as never }).cacheLimitMb).toBe(0);
	});
});
