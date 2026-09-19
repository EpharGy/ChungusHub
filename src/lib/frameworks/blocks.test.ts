/**
 * Editable block resolution. Run with `bun test`.
 *
 * These values come off a synced settings blob, so they can arrive from an older build,
 * another device or a hand edit. The rule is that anything unusable degrades to the
 * declaration rather than throwing or being guessed at: a framework whose settings blew up
 * would take the whole prompt with it.
 */

import { describe, expect, test } from 'bun:test';

import { normalizeFrameworkConfig, resolveBlock, resolveBlocks, type FrameworkBlockDef } from './blocks';

const DEF: FrameworkBlockDef = {
	slot: 'instructions',
	label: 'Instructions',
	hint: 'test double',
	defaultText: 'say {{thing}}',
	placeholders: ['{{thing}}'],
	required: ['{{thing}}'],
	gate: true,
	defaultOn: true,
	placement: { atDepth: false, depth: 0, role: 'system', order: 0 }
};

describe('an untouched block', () => {
	test('is exactly what was declared', () => {
		const out = resolveBlock(DEF, undefined);
		expect(out.on).toBe(true);
		expect(out.text).toBe(DEF.defaultText);
		expect(out.atDepth).toBe(false);
		expect(out.role).toBe('system');
		expect(out.isDefault).toBe(true);
		expect(out.missing).toEqual([]);
	});

	test('a block with no placement declared still resolves somewhere', () => {
		// A reminder has no placement of its own: it belongs to the section that gathers it.
		// Resolving it must not throw on the way to being handed over.
		const reminder: FrameworkBlockDef = { ...DEF, reminder: true, placement: undefined };
		expect(() => resolveBlock(reminder, undefined)).not.toThrow();
	});
});

describe('a block that IS the framework', () => {
	test('has no switch of its own, so a stored off is ignored', () => {
		// Two switches for one decision is worse than one: it leaves a state where the thing
		// looks on and does nothing.
		const always: FrameworkBlockDef = { ...DEF, alwaysOn: true, defaultOn: false };
		expect(resolveBlock(always, { on: false }).on).toBe(true);
	});

	test('an optional block still honours one', () => {
		expect(resolveBlock({ ...DEF, defaultOn: true }, { on: false }).on).toBe(false);
	});
});

describe('what a reader changed', () => {
	test('a stored value wins over the declaration', () => {
		const out = resolveBlock(DEF, { on: false, text: 'mine {{thing}}', atDepth: true, depth: 4 });
		expect(out.on).toBe(false);
		expect(out.text).toBe('mine {{thing}}');
		expect(out.atDepth).toBe(true);
		expect(out.depth).toBe(4);
		expect(out.isDefault).toBe(false);
	});

	test('a field left alone still falls back, one field at a time', () => {
		const out = resolveBlock(DEF, { depth: 3 });
		expect(out.depth).toBe(3);
		expect(out.text).toBe(DEF.defaultText);
		expect(out.on).toBe(true);
	});

	test('dropping a required placeholder is reported rather than corrected', () => {
		// Silently putting it back would overwrite what someone deliberately wrote; saying so
		// leaves the decision with them.
		expect(resolveBlock(DEF, { text: 'say nothing' }).missing).toEqual(['{{thing}}']);
	});
});

describe('the stored blob', () => {
	test('anything unusable reads as nothing stored', () => {
		for (const raw of [undefined, null, 'nonsense', [], 7, { blocks: 'no' }, { blocks: [] }]) {
			expect(normalizeFrameworkConfig(raw).blocks ?? {}).toEqual({});
		}
	});

	test('an empty text reads as unset, not as "send nothing"', () => {
		// A reader who wants nothing sent turns the block off. That control says so; an empty
		// box does not, and looks identical to a save that went wrong.
		expect(normalizeFrameworkConfig({ blocks: { a: { text: '   ' } } }).blocks?.a).toEqual({});
	});

	test('a role nothing here wrote is dropped rather than trusted', () => {
		expect(normalizeFrameworkConfig({ blocks: { a: { role: 'narrator' } } }).blocks?.a).toEqual({});
	});

	test('depth is clamped, so a hand-edited blob cannot bury a block', () => {
		const at = (depth: unknown) => normalizeFrameworkConfig({ blocks: { a: { depth } } }).blocks?.a;
		expect(at(-5)?.depth).toBe(0);
		expect(at(9999)?.depth).toBe(100);
		expect(at(2.7)?.depth).toBe(2);
		expect(at('deep')?.depth).toBeUndefined();
	});

	test('a block for a slot this build no longer declares is simply not resolved', () => {
		// Kept in storage rather than pruned: a slot can come back with the branch that had it.
		const stored = { blocks: { gone: { text: 'x' }, instructions: { text: 'kept {{thing}}' } } };
		const out = resolveBlocks([DEF], stored);
		expect(out).toHaveLength(1);
		expect(out[0].text).toBe('kept {{thing}}');
	});

	test('a framework declaring no blocks resolves to none', () => {
		expect(resolveBlocks(undefined, { blocks: { a: { text: 'x' } } })).toEqual([]);
	});
});
