/**
 * Tests for the pure EchoChamber core. Run with `bun test`.
 *
 * The centre of gravity is the parser, because a feed is generated prose being read as a
 * record format: every case here is a shape a model actually produces when asked for
 * `username: message` lines, and the cost of misreading one is a reaction attributed to
 * the wrong handle or a whole batch dropped.
 *
 * The two behaviours asserted hardest are the ones that differ from the extension this was
 * ported from, since both were silent data loss there: the cap is applied before the
 * display order, and a rejected cast name does not adopt the next line as its own.
 */

import { describe, expect, test } from 'bun:test';

import { DEFAULT_ECHOCHAMBER_SETTINGS, BOUNDS, resolveEchoChamberSettings } from './config';
import {
	MAX_CUSTOM_STYLES,
	MAX_PROMPT_LENGTH,
	duplicateStyle,
	normalizeCustomStyles,
	removeStyle,
	styleIdFor,
	upsertStyle
} from './custom-styles';
import {
	MAX_STORED_FEEDS,
	clearFeed,
	defaultEchoChamberChatState,
	normalizeEchoChamberChatState,
	pruneFeeds,
	putFeed
} from './feed-state';
import { lorebookTextFromTrace } from './lorebook-context';
import { parseReactions, snapToCast } from './parse';
import { buildPrompt, castNamesForStyle, pastReactionsFor, resolveStyleMacros } from './prompt';
import { BUILT_IN_STYLES, builtInStyle } from './styles';
import type { Lorebook, LorebookStatus, LorebookTrace } from '$lib/lorebook/types';
import type { ChatStyle, EchoChamberFeed, Reaction, StoryContext } from './types';

const CROWD = builtInStyle('twitch')!;
const CAST = builtInStyle('sillytavern')!;
const NARRATOR = builtInStyle('hypebot')!;

function context(overrides: Partial<StoryContext> = {}): StoryContext {
	return {
		history: [{ role: 'assistant', content: 'The door creaked open.' }],
		personaName: 'Ephar',
		personaDescription: 'A tired archivist.',
		characterDescriptions: [{ name: 'Mai', description: 'Vice-president of a club.' }],
		lorebook: '',
		memory: '',
		castNames: [],
		pastReactions: {},
		...overrides
	};
}

describe('parseReactions', () => {
	test('reads the canonical shape', () => {
		const out = parseReactions('dave_99: LETS GOOOO\nmod_kim: settle down', { limit: 10 });
		expect(out).toEqual([
			{ username: 'dave_99', text: 'LETS GOOOO' },
			{ username: 'mod_kim', text: 'settle down' }
		]);
	});

	test('strips a thinking block and a wrapper tag the style never asked for', () => {
		const raw =
			'<thinking>I should write six lines.</thinking>\n<discordchat>\nfan_1: pog\n</discordchat>';
		expect(parseReactions(raw, { limit: 10 })).toEqual([{ username: 'fan_1', text: 'pog' }]);
	});

	test('undresses a handle the model decorated or numbered', () => {
		const out = parseReactions('1. **dave_99**: hi\n- `mod_kim`: hey', { limit: 10 });
		expect(out.map((r) => r.username)).toEqual(['dave_99', 'mod_kim']);
	});

	test('splits on the first colon, so a time in the message survives', () => {
		const out = parseReactions("dave_99: it's 5:30 already", { limit: 10 });
		expect(out).toEqual([{ username: 'dave_99', text: "it's 5:30 already" }]);
	});

	test('a colonless line continues the reaction above it', () => {
		const out = parseReactions('dave_99: this is going\nto be a disaster', { limit: 10 });
		expect(out).toEqual([{ username: 'dave_99', text: 'this is going to be a disaster' }]);
	});

	test('a blank line inside a reaction is a paragraph, not a terminator', () => {
		const out = parseReactions('critic: one thing.\n\nand another.', { limit: 10 });
		expect(out).toEqual([{ username: 'critic', text: 'one thing.\n\nand another.' }]);
	});

	test('drops separator lines and empty output', () => {
		expect(parseReactions('---\n***\n...', { limit: 10 })).toEqual([]);
		expect(parseReactions('   ', { limit: 10 })).toEqual([]);
		expect(parseReactions('<thinking>only reasoning</thinking>', { limit: 10 })).toEqual([]);
	});

	test('caps an over-long username rather than dropping the line', () => {
		const long = 'x'.repeat(60);
		const out = parseReactions(`${long}: hi`, { limit: 10 });
		expect(out[0].username).toHaveLength(40);
	});

	test('discards a reaction with nothing in it', () => {
		expect(parseReactions('dave_99: .', { limit: 10 })).toEqual([]);
	});

	test('salvages a bare line under a generic handle when names are invented', () => {
		expect(parseReactions('what just happened', { limit: 10 })).toEqual([
			{ username: 'User', text: 'what just happened' }
		]);
	});

	test('a cast style never salvages a line with no speaker', () => {
		const out = parseReactions('what just happened', { limit: 10, castNames: ['Mai'] });
		expect(out).toEqual([]);
	});

	// The extension ordered first and capped second, so `newest-first` kept the LAST n the
	// model wrote and `oldest-first` kept the first n: a layout preference silently decided
	// which half of the batch existed at all.
	test('caps before ordering, so display order never changes which reactions survive', () => {
		const raw = 'a: one\nb: two\nc: three\nd: four';
		const oldest = parseReactions(raw, { limit: 2, order: 'oldest-first' });
		const newest = parseReactions(raw, { limit: 2, order: 'newest-first' });

		expect(oldest.map((r) => r.username)).toEqual(['a', 'b']);
		expect(newest.map((r) => r.username)).toEqual(['b', 'a']);
		expect(new Set(newest.map((r) => r.username))).toEqual(new Set(oldest.map((r) => r.username)));
	});

	test('limit of zero asks for nothing and gets nothing', () => {
		expect(parseReactions('a: hello', { limit: 0 })).toEqual([]);
	});

	// The extension stripped `*_"\`` from anywhere in the name, so the underscore-heavy
	// handles its own styles ask the model to invent arrived with the underscores gone.
	test('keeps the underscores that are part of the handle, drops the ones that wrap it', () => {
		const out = parseReactions('xX_ShadowReaper_Xx: gg\n*_soft_cl0ud_*: aww', { limit: 10 });
		expect(out.map((r) => r.username)).toEqual(['xX_ShadowReaper_Xx', 'soft_cl0ud']);
	});
});

describe('snapToCast', () => {
	const cast = ['Mai Azabu', 'Polka Takahashi'];

	test('matches exactly, then case-insensitively, then on the first name', () => {
		expect(snapToCast('Mai Azabu', cast)).toBe('Mai Azabu');
		expect(snapToCast('mai azabu', cast)).toBe('Mai Azabu');
		expect(snapToCast('Mai Azabou', cast)).toBe('Mai Azabu');
	});

	test('returns null for a name nobody in the story has', () => {
		expect(snapToCast('Steve', cast)).toBeNull();
	});

	test('an empty cast means no snapping is possible, so the name stands', () => {
		expect(snapToCast('Steve', [])).toBe('Steve');
	});
});

describe('parseReactions with a cast', () => {
	const cast = ['Mai Azabu', 'Polka Takahashi'];

	test('snaps a hallucinated surname back to the real character', () => {
		const out = parseReactions('Mai Azabou: this plan has a hole in it', { limit: 10, castNames: cast });
		expect(out).toEqual([{ username: 'Mai Azabu', text: 'this plan has a hole in it' }]);
	});

	// The extension left `current` pointing at the last ACCEPTED reaction when it rejected a
	// speaker, so the rejected character's following lines were appended to a real one: words
	// nobody wrote, over a name that is in the cast.
	test('a rejected speaker does not donate its continuation to the reaction above', () => {
		const raw = 'Mai Azabu: fine.\nSteve: I am not in this story\nand neither is this line';
		const out = parseReactions(raw, { limit: 10, castNames: cast });
		expect(out).toEqual([{ username: 'Mai Azabu', text: 'fine.' }]);
	});
});

describe('resolveEchoChamberSettings', () => {
	test('an absent blob is the defaults', () => {
		expect(resolveEchoChamberSettings(null)).toEqual(DEFAULT_ECHOCHAMBER_SETTINGS);
		expect(resolveEchoChamberSettings(undefined)).toEqual(DEFAULT_ECHOCHAMBER_SETTINGS);
	});

	test('clamps a count past its bound instead of trusting it', () => {
		expect(resolveEchoChamberSettings({ reactionCount: 9999 }).reactionCount).toBe(
			BOUNDS.reactionCount.max
		);
		expect(resolveEchoChamberSettings({ reactionCount: 0 }).reactionCount).toBe(
			BOUNDS.reactionCount.min
		);
	});

	test('a field of the wrong type falls back rather than reaching the prompt', () => {
		const resolved = resolveEchoChamberSettings({
			enabled: 'yes',
			reactionCount: 'lots',
			messageOrder: 'sideways'
		} as never);
		expect(resolved.enabled).toBe(DEFAULT_ECHOCHAMBER_SETTINGS.enabled);
		expect(resolved.reactionCount).toBe(DEFAULT_ECHOCHAMBER_SETTINGS.reactionCount);
		expect(resolved.messageOrder).toBe(DEFAULT_ECHOCHAMBER_SETTINGS.messageOrder);
	});

	test('ships disabled, so no install starts paying for a feed it never asked for', () => {
		expect(DEFAULT_ECHOCHAMBER_SETTINGS.enabled).toBe(false);
	});
});

describe('styles', () => {
	test('every shipped style has an id, a name and a prompt', () => {
		for (const style of BUILT_IN_STYLES) {
			expect(style.id).toBeTruthy();
			expect(style.name).toBeTruthy();
			expect(style.prompt.trim().length).toBeGreaterThan(100);
			expect(style.custom).toBe(false);
		}
	});

	test('ids are unique, since one indexes the other', () => {
		const ids = BUILT_IN_STYLES.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test('the default style names one that ships', () => {
		expect(builtInStyle(DEFAULT_ECHOCHAMBER_SETTINGS.styleId)).toBeDefined();
	});

	test('only the cast styles leave a macro for the builder to resolve', () => {
		for (const style of BUILT_IN_STYLES) {
			const hasMacro = /\{\{(characters|story_characters_block)\}\}/.test(style.prompt);
			expect(hasMacro).toBe(style.usesStoryCast);
		}
	});
});

describe('resolveStyleMacros', () => {
	test('{{characters}} becomes the cast as a list', () => {
		expect(resolveStyleMacros('{{characters}}', ['Mai', 'Polka'])).toBe('- Mai\n- Polka');
	});

	test('a multi-name cast is told to use exactly those names', () => {
		const out = resolveStyleMacros('{{story_characters_block}}', ['Mai', 'Polka']);
		expect(out).toContain('- Mai');
		expect(out).toContain('ONLY chatters');
	});

	test('a one-card story is told its card name is the title, not a chatter', () => {
		const out = resolveStyleMacros('{{story_characters_block}}', ['The Long Dark']);
		expect(out).toContain('The Long Dark');
		expect(out).toContain('not a character');
	});

	test('leaves a prompt with no macros alone', () => {
		expect(resolveStyleMacros(CROWD.prompt, ['Mai'])).toBe(CROWD.prompt);
	});
});

describe('castNamesForStyle', () => {
	test('a crowd style snaps against nothing, so its invented handles survive', () => {
		expect(castNamesForStyle(CROWD, context({ castNames: ['Mai'] }))).toEqual([]);
	});

	test('a cast style snaps against the real cast', () => {
		expect(castNamesForStyle(CAST, context({ castNames: ['Mai', 'Polka', ' '] }))).toEqual([
			'Mai',
			'Polka'
		]);
	});

	// One card usually names the story, not a speaker, so its name is not the cast list.
	// Snapping to it would discard every character the model drew out of the narrative.
	test('a cast of one does not snap, so a one-card story still gets a feed', () => {
		expect(castNamesForStyle(CAST, context({ castNames: ['The Long Dark'] }))).toEqual([]);
	});
});

describe('buildPrompt', () => {
	const settings = { ...DEFAULT_ECHOCHAMBER_SETTINGS, reactionCount: 6 };

	test('opens chat_history in the system turn and closes it in the last user turn', () => {
		const { messages } = buildPrompt(CROWD, settings, context());
		expect(messages[0].role).toBe('system');
		expect(messages[0].content).toContain('<chat_history>');
		expect(messages[0].content).not.toContain('</chat_history>');
		expect(messages[messages.length - 1].content).toContain('</chat_history>');
	});

	test('the story turns ride between them, in order and with their own roles', () => {
		const history: StoryContext['history'] = [
			{ role: 'user', content: 'I open the door.' },
			{ role: 'assistant', content: 'It creaks.' }
		];
		const { messages } = buildPrompt(CROWD, settings, context({ history }));
		expect(messages.slice(1, -1)).toEqual([
			{ role: 'user', content: 'I open the door.' },
			{ role: 'assistant', content: 'It creaks.' }
		]);
	});

	test('a thinking block in a stored turn never reaches the crowd', () => {
		const history: StoryContext['history'] = [
			{ role: 'assistant', content: '<think>plotting</think>She smiled.' }
		];
		const { messages } = buildPrompt(CROWD, settings, context({ history }));
		expect(messages[1].content).toBe('She smiled.');
	});

	test('asks for the configured count, and reports it for the parser to cap with', () => {
		const built = buildPrompt(CROWD, { ...settings, reactionCount: 9 }, context());
		expect(built.requestedCount).toBe(9);
		expect(built.messages[built.messages.length - 1].content).toContain('exactly 9');
	});

	test('a narrator style asks for messages from one voice', () => {
		const { messages } = buildPrompt(NARRATOR, settings, context());
		expect(messages[messages.length - 1].content).toContain('same narrator/character');
	});

	test('an off toggle keeps its block out of the prompt entirely', () => {
		const ctx = context({ lorebook: 'A door.', memory: 'They met.' });
		const off = buildPrompt(
			CROWD,
			{ ...settings, includeLorebook: false, includeMemory: false },
			ctx
		);
		expect(off.messages[0].content).not.toContain('<world_info>');
		expect(off.messages[0].content).not.toContain('<summary>');

		const on = buildPrompt(CROWD, { ...settings, includeLorebook: true, includeMemory: true }, ctx);
		expect(on.messages[0].content).toContain('<world_info>');
		expect(on.messages[0].content).toContain('<summary>');
	});

	test('an enabled toggle with nothing behind it adds no empty block', () => {
		const { messages } = buildPrompt(
			CROWD,
			{
				...settings,
				includeLorebook: true,
				includeMemory: true,
				includePersona: false,
				includeCharacterDescription: false
			},
			context({ lorebook: '   ', memory: '' })
		);
		expect(messages[0].content).not.toContain('<world_info>');
		// Every part was empty, so the wrapper itself never opens either.
		expect(messages[0].content).not.toContain('<lore>');
	});

	test('past reactions ride the turn they reacted to, and only when asked for', () => {
		const ctx = context({
			pastReactions: { 0: [{ username: 'dave_99', text: 'pog' }] }
		});
		const off = buildPrompt(CROWD, { ...settings, includePastReactions: false }, ctx);
		expect(off.messages[1].content).not.toContain('dave_99');

		const on = buildPrompt(CROWD, { ...settings, includePastReactions: true }, ctx);
		expect(on.messages[1].content).toContain('dave_99: pog');
	});

	test('a cast style voices the story, a crowd style voices strangers', () => {
		const cast = buildPrompt(CAST, settings, context({ castNames: ['Mai'] }));
		expect(cast.messages[0].content).toContain("the story's cast");

		const crowd = buildPrompt(CROWD, settings, context());
		expect(crowd.messages[0].content).toContain('fake chat feeds');
	});

	test('resolves the cast macro before the style reaches the model', () => {
		const { messages } = buildPrompt(CAST, settings, context({ castNames: ['Mai Azabu'] }));
		const last = messages[messages.length - 1].content;
		expect(last).not.toContain('{{characters}}');
		expect(last).toContain('- Mai Azabu');
	});
});

describe('feed state', () => {
	function feed(createdAt: number, text = 'nice'): EchoChamberFeed {
		return { styleId: 'twitch', reactions: [{ username: 'dave_99', text }], createdAt };
	}

	test('a corrupt or absent blob degrades instead of failing the chat read', () => {
		expect(normalizeEchoChamberChatState(null)).toEqual(defaultEchoChamberChatState());
		expect(normalizeEchoChamberChatState('nonsense')).toEqual(defaultEchoChamberChatState());
		expect(normalizeEchoChamberChatState({ feeds: 7 })).toEqual(defaultEchoChamberChatState());
	});

	test('drops a reaction missing its half, and a feed left with none', () => {
		const state = normalizeEchoChamberChatState({
			feeds: {
				m1: { styleId: 'twitch', createdAt: 1, reactions: [{ username: 'a', text: 'hi' }, { username: 'b' }] },
				m2: { styleId: 'twitch', createdAt: 1, reactions: [{ text: 'orphan' }] }
			}
		});
		expect(state.feeds.m1.reactions).toEqual([{ username: 'a', text: 'hi' }]);
		expect(state.feeds.m2).toBeUndefined();
	});

	// Deleting a CHAT takes its feeds with it for free: feature_state is a column on the
	// chats row. Deleting a MESSAGE does not, and this is what closes that leak.
	test('a feed whose message was deleted is pruned away', () => {
		const state = { feeds: { alive: feed(2), deleted: feed(1) } };
		expect(pruneFeeds(state, ['alive'])).toEqual({ feeds: { alive: feed(2) } });
	});

	test('prunes against every message in the chat, not just the active path', () => {
		// A turn on another branch is not deleted, it is just not being looked at.
		const state = { feeds: { onPath: feed(2), otherBranch: feed(1) } };
		expect(pruneFeeds(state, ['onPath', 'otherBranch'])).toEqual(state);
	});

	test('returns the same object when nothing needed pruning', () => {
		const state = { feeds: { a: feed(1) } };
		expect(pruneFeeds(state, ['a'])).toBe(state);
	});

	test('caps the blob by dropping the oldest feeds', () => {
		const feeds: Record<string, EchoChamberFeed> = {};
		const live: string[] = [];
		for (let i = 0; i < MAX_STORED_FEEDS + 5; i++) {
			feeds[`m${i}`] = feed(i);
			live.push(`m${i}`);
		}
		const pruned = pruneFeeds({ feeds }, live);
		expect(Object.keys(pruned.feeds)).toHaveLength(MAX_STORED_FEEDS);
		expect(pruned.feeds.m0).toBeUndefined();
		expect(pruned.feeds[`m${MAX_STORED_FEEDS + 4}`]).toBeDefined();
	});

	test('putFeed files the new feed and prunes a dead one in the same write', () => {
		const state = { feeds: { dead: feed(1) } };
		const next = putFeed(state, 'fresh', feed(2, 'wow'), ['fresh']);
		expect(next.feeds.fresh.reactions[0].text).toBe('wow');
		expect(next.feeds.dead).toBeUndefined();
	});

	test('putFeed keeps its own message even when the caller hands a stale path', () => {
		const next = putFeed(defaultEchoChamberChatState(), 'fresh', feed(1), []);
		expect(next.feeds.fresh).toBeDefined();
	});

	test('putFeed replaces the feed on a message that already had one', () => {
		const state = putFeed(defaultEchoChamberChatState(), 'm1', feed(1, 'old'), ['m1']);
		const next = putFeed(state, 'm1', feed(2, 'new'), ['m1']);
		expect(Object.keys(next.feeds)).toEqual(['m1']);
		expect(next.feeds.m1.reactions[0].text).toBe('new');
	});

	test('clearFeed forgets one message, leaving the rest', () => {
		const state = { feeds: { a: feed(1), b: feed(2) } };
		expect(clearFeed(state, 'a')).toEqual({ feeds: { b: feed(2) } });
		expect(clearFeed(state, 'missing')).toBe(state);
	});
});

describe('custom styles', () => {
	function custom(name: string, prompt = 'Be a crowd. username: message'): unknown {
		return { name, prompt };
	}

	test('a stored entry becomes a usable style, marked as the reader own', () => {
		const [style] = normalizeCustomStyles([custom('My Style')]);
		expect(style.name).toBe('My Style');
		expect(style.custom).toBe(true);
		expect(style.narrator).toBe(false);
		expect(style.usesStoryCast).toBe(false);
	});

	test('drops an entry with no name or no prompt, since neither can be used', () => {
		expect(normalizeCustomStyles([{ name: '', prompt: 'x' }])).toEqual([]);
		expect(normalizeCustomStyles([{ name: 'x', prompt: '   ' }])).toEqual([]);
		expect(normalizeCustomStyles('nonsense')).toEqual([]);
	});

	test('ids are derived from the name and made unique', () => {
		const styles = normalizeCustomStyles([custom('My Style'), custom('My Style')]);
		expect(styles.map((s) => s.id)).toEqual(['my-style', 'my-style-2']);
	});

	// A custom entry carrying a shipped id would shadow it, so the shipped text could never
	// be got back and an upstream revision to it could never reach this reader.
	test('an id colliding with a built-in is re-derived, keeping the prompt', () => {
		const [style] = normalizeCustomStyles([{ id: 'twitch', name: 'Mine', prompt: 'hello' }]);
		expect(style.id).not.toBe('twitch');
		expect(builtInStyle('twitch')?.custom).toBe(false);
		expect(style.prompt).toBe('hello');
	});

	test('styleIdFor never returns an id a shipped style already answers to', () => {
		for (const shipped of BUILT_IN_STYLES) {
			expect(styleIdFor(shipped.name, [])).not.toBe(shipped.id);
		}
	});

	test('caps how many are kept, so one synced blob cannot grow without bound', () => {
		const many = Array.from({ length: MAX_CUSTOM_STYLES + 10 }, (_, i) => custom(`S${i}`));
		expect(normalizeCustomStyles(many)).toHaveLength(MAX_CUSTOM_STYLES);
	});

	test('truncates a prompt past the cap rather than dropping the style', () => {
		const [style] = normalizeCustomStyles([custom('Long', 'x'.repeat(MAX_PROMPT_LENGTH + 500))]);
		expect(style.prompt).toHaveLength(MAX_PROMPT_LENGTH);
	});

	test('upsert adds, then replaces by id', () => {
		const [a] = normalizeCustomStyles([custom('A')]);
		const list = upsertStyle([], a);
		expect(list).toHaveLength(1);
		expect(upsertStyle(list, { ...a, name: 'B' })).toEqual([{ ...a, name: 'B' }]);
	});

	test('remove takes only the named style', () => {
		const styles = normalizeCustomStyles([custom('A'), custom('B')]);
		expect(removeStyle(styles, styles[0].id).map((s) => s.name)).toEqual(['B']);
	});

	test('duplicating a built-in copies its text under a fresh, unreserved id', () => {
		const copy = duplicateStyle(builtInStyle('twitch')!, ['twitch']);
		expect(copy.custom).toBe(true);
		expect(copy.id).not.toBe('twitch');
		expect(copy.prompt).toBe(builtInStyle('twitch')!.prompt);
		expect(copy.name).toContain('copy');
	});

	// The format IS the extension's: a name and a raw prompt, nothing else. Its export is a
	// plain .md of the prompt, so a style moves between the two by copy and paste.
	test('a style needs nothing beyond a name and a prompt', () => {
		const [style] = normalizeCustomStyles([{ name: 'Pasted', prompt: 'anything at all' }]);
		expect(style).toBeDefined();
		expect(style.prompt).toBe('anything at all');
	});
});

describe('pastReactionsFor', () => {
	const history = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }];
	const feeds: Record<string, { reactions: Reaction[] }> = {
		m1: { reactions: [{ username: 'a', text: 'first' }] },
		m2: { reactions: [{ username: 'b', text: 'second' }] },
		m3: { reactions: [{ username: 'c', text: 'the corrupt one' }] }
	};
	const lookup = (id: string) => feeds[id] ?? null;

	// The turn being reacted to is the last entry in its own history window, so without
	// this a regenerate is shown the very output it is replacing and asked to keep its
	// voice - exactly what pressing regenerate is meant to escape.
	test('never includes the feed of the turn being reacted to', () => {
		const out = pastReactionsFor(history, 'm3', lookup);
		expect(out[2]).toBeUndefined();
		expect(out[0]).toEqual(feeds.m1.reactions);
		expect(out[1]).toEqual(feeds.m2.reactions);
	});

	test('a deleted feed stops being sent as history', () => {
		const afterDelete = (id: string) => (id === 'm2' ? null : (feeds[id] ?? null));
		const out = pastReactionsFor(history, 'm3', afterDelete);
		expect(out[1]).toBeUndefined();
		expect(out[0]).toEqual(feeds.m1.reactions);
	});

	test('indexes against the history window, so the prompt hangs each on its own turn', () => {
		const out = pastReactionsFor(history, 'm3', lookup);
		expect(Object.keys(out)).toEqual(['0', '1']);
	});

	test('an empty feed contributes nothing rather than an empty line', () => {
		const empty = (id: string) => (id === 'm1' ? { reactions: [] } : null);
		expect(pastReactionsFor(history, 'm3', empty)).toEqual({});
	});
});

describe('lorebook context', () => {
	function book(entries: { id: string; content: string }[]): Lorebook {
		return {
			id: 'b1',
			name: 'Book',
			entries: entries.map((e) => ({ id: e.id, content: e.content }))
		} as unknown as Lorebook;
	}

	function trace(records: { entryId: string; status: LorebookStatus }[]): LorebookTrace {
		return {
			silent: 0,
			records: records.map((r) => ({
				bookId: 'b1',
				bookName: 'Book',
				entryId: r.entryId,
				title: r.entryId,
				status: r.status,
				matches: []
			}))
		} as unknown as LorebookTrace;
	}

	const books = [book([
		{ id: 'e1', content: 'The tower is sealed.' },
		{ id: 'e2', content: 'Mai hates mornings.' },
		{ id: 'e3', content: 'A secret nobody was told.' }
	])];

	test('takes the entries the story actually injected', () => {
		const text = lorebookTextFromTrace(
			trace([
				{ entryId: 'e1', status: 'constant' },
				{ entryId: 'e2', status: 'keyword' }
			]),
			books
		);
		expect(text).toBe('The tower is sealed.\n\nMai hates mornings.');
	});

	test('a sticky entry still counts, since its text did reach the prompt', () => {
		expect(lorebookTextFromTrace(trace([{ entryId: 'e1', status: 'sticky' }]), books)).toBe(
			'The tower is sealed.'
		);
	});

	// The point of reusing the turn's own trace: an entry that was matched but never made it
	// into the story's prompt must not reach the crowd either.
	test('an entry that matched but never reached the model is left out', () => {
		for (const status of ['trimmed', 'groupLost', 'rolledOut', 'filtered', 'cooldown'] as const) {
			expect(lorebookTextFromTrace(trace([{ entryId: 'e3', status }]), books)).toBe('');
		}
	});

	test('a deleted entry drops out rather than leaving a placeholder', () => {
		expect(lorebookTextFromTrace(trace([{ entryId: 'gone', status: 'constant' }]), books)).toBe('');
	});

	test('an entry recorded twice by a recursive scan is sent once', () => {
		const text = lorebookTextFromTrace(
			trace([
				{ entryId: 'e1', status: 'constant' },
				{ entryId: 'e1', status: 'keyword' }
			]),
			books
		);
		expect(text).toBe('The tower is sealed.');
	});

	test('no trace and no records both mean nothing to say', () => {
		expect(lorebookTextFromTrace(null, books)).toBe('');
		expect(lorebookTextFromTrace(undefined, books)).toBe('');
		expect(lorebookTextFromTrace(trace([]), books)).toBe('');
	});
});

describe('the round trip', () => {
	test('what the prompt asks for is what the parser keeps', () => {
		const settings = { ...DEFAULT_ECHOCHAMBER_SETTINGS, reactionCount: 3 };
		const style: ChatStyle = CROWD;
		const ctx = context();

		const built = buildPrompt(style, settings, ctx);
		const reply = 'a: one\nb: two\nc: three\nd: four\ne: five';
		const out = parseReactions(reply, {
			limit: built.requestedCount,
			castNames: castNamesForStyle(style, ctx),
			order: settings.messageOrder
		});

		expect(out).toHaveLength(3);
	});
});
