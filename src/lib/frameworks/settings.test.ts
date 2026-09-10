/**
 * App-wide framework settings, and the two switches that decide what runs. Run with
 * `bun test`.
 *
 * The rule worth guarding here is that a requirement is resolved on READ rather than only
 * when a switch is flipped. A blob can arrive from an older build, another device or a hand
 * edit, and a UI that enforced the rule only at the toggle would trust whatever it found.
 */

import { describe, expect, test } from 'bun:test';

import { enabledFrameworks, requiredBy, defaultChatFrameworkState } from './chat-state';
import { runningFrameworks } from './apply';
import {
	defaultFrameworkSettings,
	frameworkAvailable,
	normalizeFrameworkSettings,
	type FrameworkSettings
} from './settings';

/** A registry standing in for the real one, so these assertions do not move when a framework
 *  is added or a branch that carries one is left out of the build. */
const REGISTRY = [
	{ id: 'base' },
	{ id: 'needs-base', requires: ['base'] },
	{ id: 'needs-the-needy', requires: ['needs-base'] },
	{ id: 'loner' }
];

function chat(enabled: string[]) {
	return { ...defaultChatFrameworkState(), enabled };
}

function install(...ids: string[]): FrameworkSettings {
	return { ...defaultFrameworkSettings(), enabled: Object.fromEntries(ids.map((id) => [id, true])) };
}

describe('what a chat is actually running', () => {
	test('a chat that has opted into nothing runs nothing', () => {
		expect(enabledFrameworks(chat([]), REGISTRY)).toEqual([]);
	});

	test('turning one on pulls in what it requires', () => {
		expect(enabledFrameworks(chat(['needs-base']), REGISTRY).sort()).toEqual(['base', 'needs-base']);
	});

	test('a requirement of a requirement is pulled in too', () => {
		// A single sweep would satisfy the first level and quietly miss the second, which is
		// why the closure runs to a fixed point rather than once.
		expect(enabledFrameworks(chat(['needs-the-needy']), REGISTRY).sort()).toEqual([
			'base',
			'needs-base',
			'needs-the-needy'
		]);
	});

	test('a framework with no requirements pulls in nothing', () => {
		expect(enabledFrameworks(chat(['loner']), REGISTRY)).toEqual(['loner']);
	});

	test('an id this build does not carry survives rather than being dropped', () => {
		// A chat that used a framework from a branch not in this build should get it back when
		// that branch returns, not lose the setting silently in between.
		expect(enabledFrameworks(chat(['from-another-branch']), REGISTRY)).toEqual([
			'from-another-branch'
		]);
	});

	test('the closure is applied on READ, so a stored blob cannot claim the impossible', () => {
		// Nothing ever wrote this: it is what a hand edit or an older build produces.
		expect(enabledFrameworks(chat(['needs-base']), REGISTRY)).toContain('base');
	});
});

describe('what is holding a framework on', () => {
	test('names the frameworks that require it', () => {
		expect(requiredBy('base', ['base', 'needs-base'], REGISTRY)).toEqual(['needs-base']);
	});

	test('nothing when only it is on', () => {
		expect(requiredBy('base', ['base'], REGISTRY)).toEqual([]);
	});

	test('nothing for a framework nobody depends on', () => {
		expect(requiredBy('loner', ['loner', 'needs-base', 'base'], REGISTRY)).toEqual([]);
	});
});

describe('the two switches together', () => {
	// The install decides whether a framework exists; the story decides whether it uses one.
	// A surface checking only one would be wrong in a way nothing on screen explains.
	test('on in the chat and available on the install: it runs', () => {
		expect(runningFrameworks(chat(['date']), install('date'))).toEqual(['date']);
	});

	test('on in the chat but not available: it does not run', () => {
		expect(runningFrameworks(chat(['date']), install())).toEqual([]);
	});

	test('available but not on in the chat: it does not run', () => {
		expect(runningFrameworks(chat([]), install('date'))).toEqual([]);
	});

	test('availability is the outer bound, even for something held on by a requirement', () => {
		// The requirement closure runs first, so this asserts the ordering: an unavailable
		// framework is not resurrected by something that depends on it.
		const state = chat(['needs-base']);
		expect(enabledFrameworks(state, REGISTRY)).toContain('base');
		expect(runningFrameworks(state, install('needs-base'))).not.toContain('base');
	});
});

describe('the stored settings blob', () => {
	test('anything unusable reads as the defaults rather than throwing', () => {
		for (const raw of [undefined, null, 'nonsense', [], 7]) {
			expect(normalizeFrameworkSettings(raw)).toEqual(defaultFrameworkSettings());
		}
	});

	test('OFF is the default, so a new framework never switches itself on', () => {
		// A framework injects text into every prompt of every chat that opts in. One that
		// started writing into prompts the first time someone updated is one nobody agreed to.
		expect(frameworkAvailable(defaultFrameworkSettings(), 'date')).toBe(false);
	});

	test('only a literal true enables', () => {
		// Guessing what a truthy string meant is how a framework switches itself on.
		const out = normalizeFrameworkSettings({ enabled: { a: true, b: 'yes', c: 1, d: false } });
		expect(out.enabled).toEqual({ a: true });
	});

	test('ids are lowercased, to match the ids markers parse to', () => {
		expect(normalizeFrameworkSettings({ enabled: { Date: true } }).enabled).toEqual({ date: true });
	});

	test('a config that is not a plain object is dropped', () => {
		// Handing one on would make every framework defend against it separately.
		const out = normalizeFrameworkSettings({
			config: { a: { x: 1 }, b: 'text', c: null, d: [1], e: 7 }
		});
		expect(Object.keys(out.config)).toEqual(['a']);
	});

	test('a config rides through untouched, because the base never reads inside one', () => {
		const config = { instructions: 'mine', depth: 3, anything: [1, 2] };
		expect(normalizeFrameworkSettings({ config: { date: config } }).config.date).toEqual(config);
	});
});
