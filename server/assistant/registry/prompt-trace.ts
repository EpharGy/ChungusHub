/**
 * Prompt-trace capabilities: read the server-side prompt debug log (the durable
 * capture behind the Prompt Debug panel; server/promptLog.ts) so "why did the last
 * generation say X / what is eating my context" gets a real answer instead of a
 * guess. Read-only; paging over previews, one full message per request. A logged
 * prompt can be an entire assembled context, and dumping it whole would sink the
 * assistant's own window.
 *
 * Honest limitation, stated in results: capture is GATED on a device actually having
 * the Prompt Debug panel open (`anyDebug` in server/index.ts): with no device
 * debugging, nothing is recorded and the log reads empty.
 */
import { snapshot, type PromptLogEntry } from '../../promptLog';
import type { Capability } from './types';
import { ToolError, str, clampInt, ok } from './util';

const EMPTY_NOTE =
	'The prompt debug log is empty. Capture only runs while a device has the Prompt Debug panel open. Ask the user to open it, reproduce the generation, and then read the log again.';

/** Clip a preview without pretending it is the full text. */
function preview(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

function summarizeEntry(e: PromptLogEntry): Record<string, unknown> {
	return {
		id: e.id,
		source: e.source,
		kind: e.kind,
		provider: e.provider,
		model: e.model,
		startedAt: e.startedAt,
		status: e.status,
		...(e.finishReason ? { finishReason: e.finishReason } : {}),
		...(e.usage ? { totalTokens: e.usage.totalTokens, promptTokens: e.usage.promptTokens } : {}),
		messageCount: e.messages.length,
		// Tool schemas are often more than half of an assistant prompt. An overview that
		// counts only messages answers "what is eating my context" with the smaller half.
		...(e.tools?.length ? { toolDefinitionCount: e.tools.length } : {}),
		...(e.iteration ? { iteration: e.iteration } : {}),
		...(e.error ? { error: preview(e.error, 200) } : {})
	};
}

export const readPromptLog: Capability = {
	name: 'read_prompt_log',
	summary: "List recent captured LLM requests, newest first: every generation the app made while a Prompt Debug panel was open (story turns, engines, assistant turns), with source, model, token usage, and outcome. THE entry point for \"why did my last generation say X / what's eating my context\": find the request here, then inspect it with read_prompt_entry.",
	risk: 'read',
	params: [
		{ name: 'source', type: 'string', describe: 'Filter by source label (e.g. "primary", "assistant", "memory", "opening-scene").' },
		{ name: 'limit', type: 'integer', describe: 'Max entries (default 15, max 50).', minimum: 1, maximum: 50 }
	],
	run(args) {
		const source = str(args.source).trim();
		const limit = clampInt(args.limit, 1, 50, 15);
		const all = snapshot();
		const filtered = source ? all.filter((e) => e.source === source) : all;
		const entries = filtered.slice(0, limit).map(summarizeEntry);
		return ok(
			{ type: 'read_prompt_log', label: `Read the prompt log: ${entries.length} of ${filtered.length} request${filtered.length === 1 ? '' : 's'}${source ? ` from "${source}"` : ''}` },
			{
				total: all.length,
				matched: filtered.length,
				returned: entries.length,
				entries,
				...(all.length === 0 ? { note: EMPTY_NOTE } : {})
			}
		);
	}
};

export const readPromptEntry: Capability = {
	name: 'read_prompt_entry',
	summary: 'Inspect one captured LLM request by id (from read_prompt_log): what was actually sent (every message with role, size, and a preview), plus params, usage, finish reason, and a response preview. Page message by message; never ask for everything at once.',
	risk: 'read',
	params: [
		{ name: 'id', type: 'string', describe: 'The request id from read_prompt_log.', required: true },
		{ name: 'messageIndex', type: 'integer', describe: '1-based message index: returns that message IN FULL instead of the overview.', minimum: 1 },
		{ name: 'response', type: 'boolean', describe: 'true = return the full response content + reasoning instead of the overview.' }
	],
	run(args) {
		const id = str(args.id).trim();
		if (!id) throw new ToolError('read_prompt_entry requires an id (from read_prompt_log).');
		const entry = snapshot().find((e) => e.id === id);
		if (!entry) {
			throw new ToolError(`No prompt-log entry with id "${id}". It may have aged out (the log keeps the newest 500). List current ids with read_prompt_log.`);
		}

		if (args.messageIndex != null) {
			const index = Math.floor(Number(args.messageIndex));
			if (!Number.isFinite(index) || index < 1 || index > entry.messages.length) {
				throw new ToolError(`\`messageIndex\` must be 1 to ${entry.messages.length} for this entry; got "${String(args.messageIndex)}".`);
			}
			const m = entry.messages[index - 1];
			return ok(
				{ type: 'read_prompt_entry', id, label: `Read message ${index}/${entry.messages.length} of prompt ${entry.source} · ${entry.model}` },
				{
					id,
					messageIndex: index,
					of: entry.messages.length,
					role: m.role,
					content: m.content,
					...(m.name ? { name: m.name } : {}),
					...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
					...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
					...(m.images?.length ? { images: m.images } : {})
				}
			);
		}

		if (args.response === true || args.response === 'true') {
			return ok(
				{ type: 'read_prompt_entry', id, label: `Read the response of prompt ${entry.source} · ${entry.model}` },
				{
					id,
					status: entry.status,
					...(entry.finishReason ? { finishReason: entry.finishReason } : {}),
					responseContent: entry.responseContent ?? '',
					...(entry.responseThinking ? { responseThinking: entry.responseThinking } : {}),
					...(entry.responseToolCalls?.length ? { responseToolCalls: entry.responseToolCalls } : {}),
					...(entry.error ? { error: entry.error } : {})
				}
			);
		}

		const messages = entry.messages.map((m, i) => ({
			index: i + 1,
			role: m.role,
			chars: m.content.length,
			preview: preview(m.content, 200),
			...(m.tool_calls ? { hasToolCalls: true } : {}),
			...(m.images?.length ? { images: m.images.length } : {})
		}));
		return ok(
			{ type: 'read_prompt_entry', id, label: `Read prompt ${entry.source} · ${entry.model} (${entry.messages.length} messages)` },
			{
				...summarizeEntry(entry),
				...(entry.params ? { params: entry.params } : {}),
				...(entry.maxTokens != null ? { maxTokens: entry.maxTokens } : {}),
				...(entry.temperature != null ? { temperature: entry.temperature } : {}),
				stream: entry.stream,
				...(entry.endedAt ? { endedAt: entry.endedAt } : {}),
				messages,
				...(entry.responseContent ? { responsePreview: preview(entry.responseContent, 400) } : {}),
				note: 'Message contents are previews: read one in full with messageIndex, or the full response with response:true.'
			}
		);
	}
};
