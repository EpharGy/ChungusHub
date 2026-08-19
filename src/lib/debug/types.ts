/**
 * Shared shapes for the prompt debug log.
 *
 * A `PromptLogEntry` is one logged LLM query: the request snapshot captured at the
 * transport chokepoint, plus the real result envelope once it returns. It is the unit
 * the panel lists, inspects, and compares.
 */
import type { PromptLogMessage } from '$lib/services/transport';
import type { GenerationTuning, RoutingConfig } from '$lib/types/llm';

export type { PromptLogMessage };

/** `pending` → `done`/`error`/`cancelled`, for completions and assistant iterations
 *  alike (each iteration gets its own per-step result patched on). */
export type PromptLogStatus = 'pending' | 'done' | 'error' | 'cancelled';

export interface PromptLogEntry {
	id: string;
	/** What kind of query this is: 'chat', 'memory', 'assistant'… */
	source: string;
	kind: 'completion' | 'assistant';
	provider: string;
	model: string;
	messages: PromptLogMessage[];
	params?: Record<string, string | number>;
	maxTokens?: number;
	temperature?: number;
	stream: boolean;
	/** Reasoning/verbosity/media/caching tuning the request carried. */
	tuning?: GenerationTuning;
	/** The connection's OpenRouter routing for this request (null/absent elsewhere). */
	routing?: RoutingConfig | null;
	/** Assistant only: the tool definitions sent with the prompt. */
	tools?: unknown[];
	/** Assistant only: the tool-loop step this prompt belongs to. */
	iteration?: number;
	assistantSessionId?: string;
	startedAt: number;
	status: PromptLogStatus;
	endedAt?: number;
	usage?: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number };
	finishReason?: string;
	/** The model/provider the server reported back, shown when it differs from the request. */
	resultModel?: string;
	resultProvider?: string;
	error?: string;
	/** The response body the provider returned (thinking is extracted separately). */
	responseContent?: string;
	responseThinking?: string;
	/** Assistant iterations: the tool calls the model issued this step, wire-shape. */
	responseToolCalls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
}
