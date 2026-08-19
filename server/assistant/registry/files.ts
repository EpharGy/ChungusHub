/**
 * Attached-file capabilities: the assistant's reading end of the files the user drops on
 * the panel (architecture/chungus-assistant.md).
 *
 * Files are reference material and nothing else: there is no write here, no edit, no
 * import, and no way to name a path. A file is addressed by the id its row was minted with,
 * so the model can no more reach into the filesystem than it can hand over an image path.
 *
 * The reads are bounded by the ROOM LEFT in the conversation rather than by a constant, and
 * that is the whole design. A tool result is persisted verbatim and the context trim cannot
 * split one turn, so a read that overshoots does not fail one request: it leaves the tab
 * unable to send anything ever again. Refusing early, with the numbers and the way forward,
 * is the only version of this that a person can recover from.
 */
import { serverDb } from '../../db';
import { readAssistantFileText } from '../../files';
import { clampRange, renderNumbered, searchFile, splitLines } from '../files-core';
import { fileKindLabel } from '../../../shared/assistant-files';
import type { AssistantContext } from '../types';
import type { Capability } from './types';
import { estimateTextTokens, INLINE_CONTENT_TOKEN_LIMIT } from './schema';
import { ToolError, requireStr, clampInt, boolArg, ok } from './util';

/** Search pages default small and are capped: a page is a map of where to read, and a
 *  hundred clipped lines answer "where is this mentioned" without becoming the read. */
const SEARCH_LIMIT_MAX = 100;

/** Room left in the conversation, in estimated tokens. Absent when no conversation stands
 *  behind the call (a preview, the smoke script), where nothing can be spent and the
 *  inline limit is the only bound that means anything. */
function roomLeft(ctx: AssistantContext): number | null {
	return ctx.roomTokens ? ctx.roomTokens() : null;
}

function tokensPhrase(tokens: number): string {
	return tokens >= 1000 ? `~${Math.round(tokens / 1000)}k tokens` : `~${tokens} tokens`;
}

/** The file, or a refusal naming how to find the right id. */
function loadFile(ctx: AssistantContext, args: Record<string, unknown>) {
	const id = requireStr(args.fileId, 'fileId');
	const file = serverDb.getAssistantFile(id);
	// Scoped to this tab: a file belongs to the session it was attached to, and reading
	// across tabs would hand the model material the user attached somewhere else entirely.
	if (!file || (ctx.assistantSessionId && file.sessionId !== ctx.assistantSessionId)) {
		throw new ToolError(`No file attached to this conversation with id "${id}". List what is attached with list_files.`);
	}
	return file;
}

export const listFiles: Capability = {
	name: 'list_files',
	summary:
		'List the files the user has attached to this conversation: id, name, what each one turned out to be, its length in lines, and what reading it whole would cost. Reference material only: files are read-only and cannot be edited.',
	risk: 'read',
	params: [],
	run(_args, ctx) {
		if (!ctx.assistantSessionId) throw new ToolError('list_files has no conversation to list files for.');
		// Only files that actually rode a turn: one still staged in the composer has not
		// been sent, and reporting it would announce something the user has not handed over.
		const files = serverDb.listAssistantFiles(ctx.assistantSessionId).filter((f) => f.messageId !== null);
		const room = roomLeft(ctx);
		return ok(
			{ type: 'list_files', label: `Listed attached files: ${files.length}` },
			{
				count: files.length,
				...(room !== null ? { roomLeftTokens: room } : {}),
				files: files.map((f) => ({
					id: f.id,
					name: f.name,
					kind: f.kind,
					what: fileKindLabel(f.kind),
					lines: f.lines,
					estimatedTokens: f.tokenEstimate
				})),
				...(files.length === 0
					? { note: 'Nothing is attached to this conversation. The user attaches a file with the paperclip in the assistant composer, or by dropping it on the panel.' }
					: {})
			}
		);
	}
};

export const readFile: Capability = {
	name: 'read_file',
	summary:
		"Read an attached file's text, by 1-based line numbers. With no range it returns the whole file when that is small enough to land unasked, and otherwise refuses with its size: read a range, or find what you need with search_file first. Results never go stale: an attached file is read-only for its whole life, so a range you have already read never needs reading again.",
	risk: 'read',
	params: [
		{ name: 'fileId', type: 'string', describe: 'The file id from list_files.', required: true },
		{ name: 'fromLine', type: 'integer', describe: 'First line to return, 1-based. Omit both bounds for the whole file.', minimum: 1 },
		{ name: 'toLine', type: 'integer', describe: 'Last line to return, inclusive. Clamped to the end of the file.', minimum: 1 }
	],
	run(args, ctx) {
		const file = loadFile(ctx, args);
		const text = readAssistantFileText(file.textPath);
		const lines = splitLines(text);
		const asked = args.fromLine != null || args.toLine != null;
		const from = args.fromLine != null ? clampInt(args.fromLine, 1, Number.MAX_SAFE_INTEGER, 1) : undefined;
		const to = args.toLine != null ? clampInt(args.toLine, 1, Number.MAX_SAFE_INTEGER, file.lines) : undefined;
		const range = clampRange(lines.length, from, to);
		if (lines.length === 0) {
			return ok(
				{ type: 'read_file', id: file.id, name: file.name, label: `Read "${file.name}": the file is empty` },
				{ fileId: file.id, name: file.name, lines: 0, content: '', note: 'This file has no lines.' }
			);
		}

		const slice = lines.slice(range.from - 1, range.to);
		// Measured on the RENDERED text, gutter included: a 20k-line read carries several
		// thousand tokens of line numbers, and a check against the bare text under-counts by
		// exactly the amount that would push the turn over.
		const content = renderNumbered(slice, range.from, lines.length);
		const cost = estimateTextTokens(content);
		const room = roomLeft(ctx);

		// An explicit range is a deliberate size, so it may spend the room the conversation
		// actually has. No range is not a request for any particular amount, so it may only
		// take what may land unasked.
		const ceiling = asked ? (room ?? INLINE_CONTENT_TOKEN_LIMIT) : Math.min(INLINE_CONTENT_TOKEN_LIMIT, room ?? INLINE_CONTENT_TOKEN_LIMIT);
		if (cost > ceiling) {
			const size = `${file.lines} lines, ${tokensPhrase(file.tokenEstimate)}`;
			if (asked) {
				throw new ToolError(
					`Lines ${range.from} to ${range.to} of "${file.name}" are ${tokensPhrase(cost)}, and this conversation has ${tokensPhrase(ceiling)} of room left. Read a smaller range, or ask the user whether to start a new tab (the room is the Assistant connection's Context Size minus what this conversation already holds).`
				);
			}
			throw new ToolError(
				`"${file.name}" is ${size}, too much to read whole without being asked for. Use search_file to find what matters, or read_file with fromLine/toLine.${room !== null ? ` This conversation has ${tokensPhrase(room)} of room left.` : ''}`
			);
		}

		const whole = range.from === 1 && range.to === lines.length;
		return ok(
			{
				type: 'read_file',
				id: file.id,
				name: file.name,
				label: whole ? `Read "${file.name}" (${lines.length} lines)` : `Read "${file.name}" lines ${range.from} to ${range.to} of ${lines.length}`
			},
			{
				fileId: file.id,
				name: file.name,
				what: fileKindLabel(file.kind),
				fromLine: range.from,
				toLine: range.to,
				totalLines: lines.length,
				content,
				...(whole ? {} : { note: `This is lines ${range.from} to ${range.to} of ${lines.length}. Read another range with read_file.` })
			}
		);
	}
};

export const searchFileTool: Capability = {
	name: 'search_file',
	summary:
		'Find where something appears in an attached file: matching lines with their line numbers, so read_file can then fetch the part that matters. Plain substring matching, not a pattern. The first move on any file too big to read whole.',
	risk: 'read',
	params: [
		{ name: 'fileId', type: 'string', describe: 'The file id from list_files.', required: true },
		{ name: 'query', type: 'string', describe: 'The text to look for.', required: true },
		{ name: 'caseSensitive', type: 'boolean', describe: 'Match case exactly. Default false.' },
		{ name: 'limit', type: 'integer', describe: `Max matching lines to return (default 30, max ${SEARCH_LIMIT_MAX}).`, minimum: 1, maximum: SEARCH_LIMIT_MAX }
	],
	run(args, ctx) {
		const file = loadFile(ctx, args);
		const query = requireStr(args.query, 'query');
		if (!query.trim()) throw new ToolError('search_file needs something to look for.');
		const caseSensitive = args.caseSensitive != null ? boolArg(args.caseSensitive, 'caseSensitive') : false;
		const limit = clampInt(args.limit, 1, SEARCH_LIMIT_MAX, 30);
		const text = readAssistantFileText(file.textPath);
		const result = searchFile(text, query, caseSensitive, limit);

		// The same room the reads answer to. A search over a 10 MB file with a one-character
		// query is otherwise a read of the whole file wearing another tool's name.
		const room = roomLeft(ctx);
		const payload = JSON.stringify(result.matches);
		if (room !== null && estimateTextTokens(payload) > room) {
			throw new ToolError(
				`Those matches are ${tokensPhrase(estimateTextTokens(payload))} and this conversation has ${tokensPhrase(room)} of room left. Search for something more specific, or lower \`limit\`.`
			);
		}

		return ok(
			{
				type: 'search_file',
				id: file.id,
				name: file.name,
				label: `Searched "${file.name}" for "${query}": ${result.total} match${result.total === 1 ? '' : 'es'}`
			},
			{
				fileId: file.id,
				name: file.name,
				query,
				total: result.total,
				returned: result.matches.length,
				matches: result.matches,
				...(result.total > result.matches.length
					? { note: `${result.total - result.matches.length} more matches exist. Raise \`limit\` (max ${SEARCH_LIMIT_MAX}) or search for something narrower.` }
					: {}),
				...(result.total === 0 ? { note: `Nothing in "${file.name}" contains that. The whole file is ${file.lines} lines.` } : {})
			}
		);
	}
};
