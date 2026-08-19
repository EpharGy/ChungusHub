/**
 * Lorebook-entry capabilities: read any book's entries in full, and add/edit/remove
 * entries by id. The book itself (name/description, create/delete) is managed through
 * the generic entity tools; these operate INSIDE one book by lorebookId.
 */
import { serverDb } from '../../db';
import type { ApprovalPreview, AssistantToolResult } from '../types';
import type { Capability } from './types';
import type { RawLibraryEntry, RawLorebookBook, RawLorebookEntry } from '../rows';
import { stampState } from '../freshness';
import { ToolError, str, requireStr, strList, boolArg, clampInt, ok } from './util';

/** Load a book (entries normalized to an array), or a loud error. */
export function loadLorebookBook(lorebookId: unknown): RawLorebookBook {
	const id = str(lorebookId).trim();
	if (!id) throw new ToolError('A lorebookId is required. Use find_entities kind:lorebook to list books, or read_chat_context for the ones in the scene.');
	const raw = serverDb.getLorebook(id) as RawLorebookBook | null;
	if (!raw) throw new ToolError(`No lorebook with id "${id}".`);
	if (!Array.isArray(raw.entries)) raw.entries = [];
	return raw;
}

/** The character or persona whose links are being changed, or a loud error. */
function loadLinkTarget(entryId: unknown): RawLibraryEntry {
	const entry = serverDb.getLibraryEntry(str(entryId).trim()) as RawLibraryEntry | null;
	if (!entry || (entry.type !== 'character' && entry.type !== 'persona')) {
		throw new ToolError(`No character or persona with id "${str(entryId)}". Use find_entities to locate the right id.`);
	}
	return entry;
}

/** Locate one entry inside a loaded book, or a loud error (the same lookup every write and
 *  every preview of a write makes). */
function findEntry(book: RawLorebookBook, entryId: unknown): RawLorebookEntry {
	const entry = book.entries.find((e) => e.id === str(entryId).trim());
	if (!entry) throw new ToolError(`No lorebook entry with id "${str(entryId)}" in book "${book.name}". Use read_lorebook_entries for ids.`);
	return entry;
}

export const readLorebookEntries: Capability = {
	name: 'read_lorebook_entries',
	summary: 'Read the entries of ANY lorebook by lorebookId, with full content, including books not linked to the open chat. Optional query filters by substring across title, keys, and content. Read the target entry here before editing it.',
	risk: 'read',
	params: [
		{ name: 'lorebookId', type: 'string', describe: 'The book to read (from find_entities kind:lorebook or read_chat_context).', required: true },
		{ name: 'query', type: 'string', describe: 'Case-insensitive substring matched against comment, keys, and content.' },
		{ name: 'limit', type: 'integer', describe: 'Max entries returned (default 30, max 100).', minimum: 1, maximum: 100 }
	],
	run(args) {
		const book = loadLorebookBook(args.lorebookId);
		const q = str(args.query).trim().toLowerCase();
		const limit = clampInt(args.limit, 1, 100, 30);
		let rows = book.entries;
		if (q) {
			rows = rows.filter((e) => [e.comment, e.key.join(' '), e.keysecondary.join(' '), e.content].join('\n').toLowerCase().includes(q));
		}
		const entries = rows.slice(0, limit).map((e) => ({
			id: e.id,
			comment: e.comment,
			keys: e.key,
			secondaryKeys: e.keysecondary,
			constant: e.constant,
			enabled: !e.disable,
			content: e.content
		}));
		return ok(
			{ type: 'read_lorebook_entries', id: book.id, name: book.name, label: `Read ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} from ${book.name}` },
			{ lorebookId: book.id, name: book.name, total: book.entries.length, matched: rows.length, returned: entries.length, entries, ...stampState(['lorebook', book.id]) }
		);
	}
};

export const createLorebookEntry: Capability = {
	name: 'create_lorebook_entry',
	summary: 'Add an entry to a lorebook: a world fact injected into context when its keywords appear. Create the book first with create_entity kind:lorebook, or reuse one from read_chat_context / find_entities kind:lorebook.',
	risk: 'write',
	params: [
		{ name: 'lorebookId', type: 'string', describe: 'The book to add the entry to.', required: true },
		{ name: 'content', type: 'string', describe: 'The lore text injected into context.', required: true },
		{ name: 'comment', type: 'string', describe: 'Short title for the entry (organizational; never injected).' },
		{ name: 'keys', type: 'string', describe: 'Comma-separated trigger keywords. Omit + set constant:true for an always-on entry.' },
		{ name: 'secondaryKeys', type: 'string', describe: 'Optional comma-separated secondary keywords (all must also be present, AND ANY logic).' },
		{ name: 'constant', type: 'boolean', describe: 'true = always in context regardless of keywords. Default false (keyword-triggered).' }
	],
	run(args, ctx) {
		const book = loadLorebookBook(args.lorebookId);
		const content = str(args.content).trim();
		if (!content) throw new ToolError('create_lorebook_entry requires content.');
		const entry: RawLorebookEntry = {
			id: crypto.randomUUID(),
			comment: args.comment === undefined ? '' : requireStr(args.comment, 'comment'),
			// Reads return keys as arrays, so models echo both shapes; anything else fails loud
			// (a `constant === true` gate silently makes the string "true" a keyword entry).
			key: args.keys === undefined ? [] : strList(args.keys, 'keys'),
			keysecondary: args.secondaryKeys === undefined ? [] : strList(args.secondaryKeys, 'secondaryKeys'),
			selectiveLogic: 0,
			content,
			constant: args.constant === undefined ? false : boolArg(args.constant, 'constant'),
			disable: false,
			order: book.entries.length * 100,
			probability: 100,
			useProbability: true,
			caseSensitive: null,
			matchWholeWords: null,
			rest: {}
		};
		book.entries.push(entry);
		serverDb.updateLorebook(book);
		ctx.broadcast('lorebooks');
		const label = entry.comment || content.slice(0, 40);
		return ok({ type: 'create_lorebook_entry', id: entry.id, name: label, label: `Created lorebook entry in ${book.name}` }, { id: entry.id, lorebookId: book.id, ...stampState(['lorebook', book.id]) });
	},
	preview(args) {
		const book = loadLorebookBook(args.lorebookId);
		const content = str(args.content).trim();
		const keys = args.keys === undefined ? [] : strList(args.keys, 'keys');
		const constant = args.constant === undefined ? false : boolArg(args.constant, 'constant');
		return {
			act: 'Add lorebook entry',
			within: book.name,
			label: str(args.comment).trim() || content.slice(0, 60) || '(empty entry)',
			target: { kind: 'lorebook', id: book.id },
			// Whether it can ever fire is the one thing a reader cannot see in the text itself.
			notes: [
				constant
					? { text: 'Always in context, no keywords needed.' }
					: keys.length
						? { text: `Injects when the story mentions: ${keys.join(', ')}.` }
						: { text: 'No keywords and not always-on, so it would sit in the book and never inject.', warn: true }
			],
			diff: { before: '', after: content, title: str(args.comment).trim() || 'New lorebook entry' }
		};
	}
};

export const editLorebookEntry: Capability = {
	name: 'edit_lorebook_entry',
	summary: 'Update an existing lorebook entry by id. Only the fields you pass are changed.',
	risk: 'write',
	params: [
		{ name: 'lorebookId', type: 'string', describe: 'The book the entry belongs to.', required: true },
		{ name: 'id', type: 'string', describe: 'Lorebook entry id (from read_chat_context).', required: true },
		{ name: 'comment', type: 'string', describe: 'New title.' },
		{ name: 'content', type: 'string', describe: 'New lore text.' },
		{ name: 'keys', type: 'string', describe: 'New comma-separated keywords.' },
		{ name: 'secondaryKeys', type: 'string', describe: 'New comma-separated secondary keywords.' },
		{ name: 'constant', type: 'boolean', describe: 'Always-on (true) or keyword-triggered (false).' },
		{ name: 'enabled', type: 'boolean', describe: 'Enable/disable the entry.' }
	],
	run(args, ctx) {
		const book = loadLorebookBook(args.lorebookId);
		const entry = findEntry(book, args.id);
		// Which fields the call actually provided: a call that provides none is a no-op
		// and must fail loudly rather than report an edit that never happened.
		const touched: string[] = [];
		const touch = (key: keyof RawLorebookEntry) => touched.push(key);
		// Every PROVIDED field is applied or fails loud. A typeof gate instead silently
		// skips wrong-typed values (keys as the array a read returns!) and still reports
		// "Edited", telling the user a change happened when nothing did.
		const beforeContent = entry.content;
		if (args.comment !== undefined) { const v = requireStr(args.comment, 'comment'); touch('comment'); entry.comment = v; }
		if (args.content !== undefined) { const v = requireStr(args.content, 'content'); touch('content'); entry.content = v; }
		if (args.keys !== undefined) { const v = strList(args.keys, 'keys'); touch('key'); entry.key = v; }
		if (args.secondaryKeys !== undefined) { const v = strList(args.secondaryKeys, 'secondaryKeys'); touch('keysecondary'); entry.keysecondary = v; }
		if (args.constant !== undefined) { const v = boolArg(args.constant, 'constant'); touch('constant'); entry.constant = v; }
		if (args.enabled !== undefined) { const v = boolArg(args.enabled, 'enabled'); touch('disable'); entry.disable = !v; }
		if (!touched.length) {
			throw new ToolError('edit_lorebook_entry received nothing to change. Pass at least one of comment, content, keys, secondaryKeys, constant, enabled.');
		}
		serverDb.updateLorebook(book);
		ctx.broadcast('lorebooks');
		const name = entry.comment || entry.content.slice(0, 40);
		const result: AssistantToolResult = { type: 'edit_lorebook_entry', id: entry.id, name, label: `Edited lorebook entry in ${book.name}` };
		if (typeof args.content === 'string' && args.content !== beforeContent) {
			result.diff = { before: beforeContent, after: entry.content, title: `Lorebook · ${name}` };
		}
		return ok(result, { id: entry.id, lorebookId: book.id, ...stampState(['lorebook', book.id]) });
	},
	preview(args) {
		const book = loadLorebookBook(args.lorebookId);
		const entry = findEntry(book, args.id);
		const name = entry.comment || entry.content.slice(0, 40);
		// Which fields the call actually provides, named the way the editor names them.
		const CHANGES: [string, string][] = [
			['comment', 'title'],
			['content', 'text'],
			['keys', 'keywords'],
			['secondaryKeys', 'secondary keywords'],
			['constant', 'always-on'],
			['enabled', 'enabled']
		];
		const touched = CHANGES.filter(([key]) => args[key] !== undefined).map(([, label]) => label);
		const preview: ApprovalPreview = {
			act: 'Edit lorebook entry',
			within: book.name,
			label: name,
			target: { kind: 'lorebook', id: book.id },
			notes: touched.length ? [{ text: `Changes its ${touched.join(', ')}.` }] : [{ text: 'Nothing to change, so the call would be refused.', warn: true }]
		};
		if (args.content !== undefined) {
			preview.diff = { before: entry.content, after: requireStr(args.content, 'content'), title: `Lorebook · ${name}` };
		}
		return preview;
	}
};

/**
 * The activation half of the lorebook family: a book only ever INJECTS once it is
 * linked: a chat scans the books linked by its character plus the globally active
 * persona. Without this, the assistant could author a whole book and then had to end
 * with "now link it yourself"; the one workflow it does best died on its last step.
 */
export const manageEntryLorebooks: Capability = {
	name: 'manage_entry_lorebooks',
	summary: 'Link or unlink a lorebook to a character or persona. Linking is what makes a book actually inject: a chat scans the books linked by its character and by the globally active persona. A freshly created book usually wants a link right after. Book ids: find_entities kind:lorebook or read_chat_context; entry ids: find_entities kind:character/persona.',
	risk: 'write',
	params: [
		{ name: 'entryId', type: 'string', describe: 'The character or persona whose links to change.', required: true },
		{ name: 'lorebookId', type: 'string', describe: 'The book to link or unlink.', required: true },
		{ name: 'action', type: 'string', describe: 'What to do.', required: true, enum: ['link', 'unlink'] }
	],
	run(args, ctx) {
		const action = str(args.action).trim();
		if (action !== 'link' && action !== 'unlink') throw new ToolError(`\`action\` must be "link" or "unlink"; got "${action}".`);
		const entry = loadLinkTarget(args.entryId);
		const book = loadLorebookBook(args.lorebookId);
		const before = [...(entry.data.lorebookIds ?? [])];
		const linked = before.includes(book.id);
		if (action === 'link' && linked) throw new ToolError(`"${book.name}" is already linked to ${entry.identity.name}.`);
		if (action === 'unlink' && !linked) throw new ToolError(`"${book.name}" is not linked to ${entry.identity.name}, so there is nothing to unlink.`);
		const after = action === 'link' ? [...before, book.id] : before.filter((id) => id !== book.id);
		// An empty set means "no such key" in a stored entry, not an empty array.
		if (after.length) entry.data.lorebookIds = after;
		else delete entry.data.lorebookIds;
		entry.updatedAt = Date.now();
		serverDb.updateLibraryEntry(entry);
		ctx.broadcast('library');
		return ok(
			{
				type: 'manage_entry_lorebooks',
				kind: entry.type,
				id: entry.id,
				name: entry.identity.name,
				label: action === 'link' ? `Linked "${book.name}" to ${entry.identity.name}` : `Unlinked "${book.name}" from ${entry.identity.name}`
			},
			// Links live on the entry, so the entry is what this re-claims.
			{ entryId: entry.id, lorebookId: book.id, action, lorebookIds: after, ...stampState([entry.type, entry.id]) }
		);
	},
	preview(args) {
		const entry = loadLinkTarget(args.entryId);
		const book = loadLorebookBook(args.lorebookId);
		const unlink = str(args.action).trim() === 'unlink';
		return {
			act: unlink ? 'Unlink lorebook' : 'Link lorebook',
			label: `${book.name} ${unlink ? 'from' : 'to'} ${entry.identity.name}`,
			target: { kind: entry.type, id: entry.id },
			// Linking is the step that makes a book do anything at all, so the card says what
			// changes in the story rather than what changes on the entry.
			notes: [
				{
					text: unlink
						? `Chats with ${entry.identity.name} stop pulling anything from this book.`
						: `Chats with ${entry.identity.name} start pulling its entries in when their keywords come up.`
				}
			]
		};
	}
};

export const deleteLorebookEntry: Capability = {
	name: 'delete_lorebook_entry',
	summary: 'Remove an entry from a lorebook by id.',
	risk: 'delete',
	params: [
		{ name: 'lorebookId', type: 'string', describe: 'The book the entry belongs to.', required: true },
		{ name: 'id', type: 'string', describe: 'Lorebook entry id.', required: true }
	],
	run(args, ctx) {
		const book = loadLorebookBook(args.lorebookId);
		const removed = findEntry(book, args.id);
		book.entries.splice(book.entries.indexOf(removed), 1);
		serverDb.updateLorebook(book);
		ctx.broadcast('lorebooks');
		const name = removed.comment || removed.content.slice(0, 40);
		// The BOOK is re-claimed, not gone-stamped: the entry died, the book lives on.
		return ok({ type: 'delete_lorebook_entry', id: removed.id, name, label: `Deleted lorebook entry from ${book.name}` }, { id: removed.id, lorebookId: book.id, ...stampState(['lorebook', book.id]) });
	},
	preview(args) {
		const book = loadLorebookBook(args.lorebookId);
		const entry = findEntry(book, args.id);
		const name = entry.comment || entry.content.slice(0, 40);
		return {
			act: 'Delete lorebook entry',
			within: book.name,
			label: name,
			target: { kind: 'lorebook', id: book.id },
			diff: { before: entry.content, after: '', title: `Lorebook · ${name}` }
		};
	}
};
