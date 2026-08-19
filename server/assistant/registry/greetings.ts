/**
 * Alternate-greetings capability: the swipeable opening messages a new chat seeds
 * beside the First Message. They live as an ARRAY on the entry's data
 * (`data.alternateGreetings`), which the generic field layer can't express: the
 * same reason lorebook entries got dedicated tools. The field ST card imports most
 * often mangle, and the highest-leverage card craft after the first message.
 */
import { serverDb } from '../../db';
import type { Capability } from './types';
import type { RawLibraryEntry } from '../rows';
import { stampState } from '../freshness';
import { ToolError, str, requireStr, assertClaimFresh, ok } from './util';

const GREETING_ACTIONS = ['list', 'add', 'set', 'remove'] as const;

/** Load a character (greetings are characters-only), or a loud error. */
function loadCharacter(id: string): RawLibraryEntry {
	const raw = serverDb.getLibraryEntry(str(id).trim()) as RawLibraryEntry | null;
	if (!raw || raw.type !== 'character') {
		throw new ToolError(`No character with id "${str(id)}". Only characters have greetings; use find_entities kind:character to find the right id.`);
	}
	return raw;
}

export const manageGreetings: Capability = {
	name: 'manage_greetings',
	summary: "Read or change a character's ALTERNATE greetings: the swipeable openings a new chat seeds as siblings of the First Message (which stays a normal card field, `firstMessage`). Write them in the character's voice, macros ({{char}}/{{user}}) left literal.",
	risk: 'write',
	// `remove` drops a greeting with nothing left holding its text, while add/set/list do not:
	// the action is an argument, so the preview is what puts it on the right rung.
	escalates: true,
	params: [
		{ name: 'characterId', type: 'string', describe: 'The character whose greetings to manage.', required: true },
		{ name: 'action', type: 'string', describe: 'What to do.', required: true, enum: GREETING_ACTIONS },
		{ name: 'index', type: 'integer', describe: '1-based greeting index (set / remove), from `list`.', minimum: 1 },
		{ name: 'text', type: 'string', describe: 'The greeting text (add / set).' }
	],
	run(args, ctx) {
		const action = str(args.action).trim();
		if (!(GREETING_ACTIONS as readonly string[]).includes(action)) {
			throw new ToolError(`\`action\` must be one of: ${GREETING_ACTIONS.join(', ')}; got "${action}".`);
		}
		const entry = loadCharacter(str(args.characterId));
		const before = [...(entry.data.alternateGreetings ?? [])];

		if (action === 'list') {
			return ok(
				{ type: 'manage_greetings', kind: 'character', id: entry.id, name: entry.identity.name, label: `Listed ${before.length} alternate greeting${before.length === 1 ? '' : 's'} of ${entry.identity.name}` },
				{
					characterId: entry.id,
					firstMessage: str(entry.data.traits?.firstMessage),
					greetings: before.map((g, i) => ({ index: i + 1, text: g })),
					note: 'A new chat seeds the First Message plus every alternate greeting as swipeable opening branches.',
					...stampState(['character', entry.id])
				}
			);
		}

		// Every branch below rewrites the stored array from model-composed text or a
		// model-chosen index, the same blind-overwrite shape set_entity gates, on the same
		// claim unit. It covers `add` too: an ungated add would re-stamp the entry and
		// launder a stale claim for the `set` that follows it in the same turn.
		assertClaimFresh('character', entry.id, entry.identity.name, ctx.claims);
		let after: string[];
		let label: string;
		let diff: { before: string; after: string; title: string } | undefined;
		if (action === 'add') {
			const text = requireStr(args.text, 'text').trim();
			if (!text) throw new ToolError('add needs non-empty `text`.');
			after = [...before, text];
			label = `Added alternate greeting ${after.length} to ${entry.identity.name}`;
		} else {
			const index = Math.floor(Number(args.index));
			if (!Number.isFinite(index) || index < 1 || index > before.length) {
				throw new ToolError(
					before.length
						? `\`index\` must be 1 to ${before.length} (from manage_greetings action:list); got "${String(args.index)}".`
						: `${entry.identity.name} has no alternate greetings to ${action}.`
				);
			}
			if (action === 'set') {
				const text = requireStr(args.text, 'text').trim();
				if (!text) throw new ToolError('set needs non-empty `text`: use remove to drop a greeting.');
				if (text === before[index - 1]) throw new ToolError(`Greeting ${index} already reads exactly that.`);
				after = before.map((g, i) => (i === index - 1 ? text : g));
				diff = { before: before[index - 1], after: text, title: `${entry.identity.name} · greeting ${index}` };
				label = `Rewrote alternate greeting ${index} of ${entry.identity.name}`;
			} else {
				after = before.filter((_, i) => i !== index - 1);
				label = `Removed alternate greeting ${index} from ${entry.identity.name}`;
			}
		}

		// An empty set means "no such key" in a stored entry, not an empty array.
		if (after.length) entry.data.alternateGreetings = after;
		else delete entry.data.alternateGreetings;
		entry.updatedAt = Date.now();
		// The save carries the new opening into every chat that is still nothing but this
		// character's greetings (server/db.ts refreshSeededGreetings); those are message rows,
		// so they need their own hint or the open transcript keeps the greeting it seeded with.
		const refreshed = serverDb.updateLibraryEntry(entry);
		ctx.broadcast('library');
		if (refreshed.length) ctx.broadcast('messages');
		return ok(
			{ type: 'manage_greetings', kind: 'character', id: entry.id, name: entry.identity.name, label, ...(diff ? { diff } : {}) },
			{ characterId: entry.id, action, greetingCount: after.length, ...stampState(['character', entry.id]) }
		);
	},
	preview(args, ctx) {
		const action = str(args.action).trim();
		const entry = loadCharacter(str(args.characterId));
		const greetings = entry.data.alternateGreetings ?? [];
		const base = { within: entry.identity.name, target: { kind: 'character', id: entry.id } as const };
		if (action === 'list') return { ...base, act: 'Read greetings', label: `${greetings.length} alternate greeting${greetings.length === 1 ? '' : 's'}` };
		// The same gate `run` asks of every mutation, so the card shows the refusal.
		assertClaimFresh('character', entry.id, entry.identity.name, ctx.claims);
		const index = Math.floor(Number(args.index));
		const current = index >= 1 && index <= greetings.length ? greetings[index - 1] : '';
		const seeded = { text: 'New chats open on it as one more swipeable greeting.' };
		if (action === 'add') {
			return { ...base, act: 'Add alternate greeting', label: `Greeting ${greetings.length + 1}`, notes: [seeded], diff: { before: '', after: str(args.text).trim(), title: `${entry.identity.name} · greeting ${greetings.length + 1}` } };
		}
		if (action === 'set') {
			return { ...base, act: 'Rewrite alternate greeting', label: `Greeting ${index}`, diff: { before: current, after: str(args.text).trim(), title: `${entry.identity.name} · greeting ${index}` } };
		}
		return {
			...base,
			act: 'Remove alternate greeting',
			label: `Greeting ${index}`,
			risk: 'delete',
			actNotes: [{ text: 'Chats already opened on it keep their opening.' }],
			diff: { before: current, after: '', title: `${entry.identity.name} · greeting ${index}` }
		};
	}
};
