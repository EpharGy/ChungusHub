/**
 * Derivation layer: capability params → OpenAI JSON Schema, and the entity
 * registry → the system-prompt data-model section. Both are generated, never
 * hand-maintained, so the tools and the prompt can never drift from the registry.
 */
import type { LLMToolDef } from '../../llm/types';
import type { Capability, ParamDef } from './types';
import { ENTITIES } from './entities';

function paramSchema(p: ParamDef): Record<string, unknown> {
	const base: Record<string, unknown> = { description: p.describe };
	switch (p.type) {
		case 'integer':
			base.type = 'integer';
			if (p.minimum !== undefined) base.minimum = p.minimum;
			if (p.maximum !== undefined) base.maximum = p.maximum;
			break;
		case 'boolean':
			base.type = 'boolean';
			break;
		case 'object':
			base.type = 'object';
			// freeform:true → a map with arbitrary keys (where/set/fields). The flag drives
			// this, so a future fixed-shape object param won't silently allow extra keys.
			base.additionalProperties = p.freeform === true;
			break;
		case 'array':
			base.type = 'array';
			// An array whose elements have no schema tells the model nothing about what to put
			// in it, and it would find out only by having the call refused. A registration bug,
			// so it fails here rather than shipping a tool nobody can call correctly.
			if (!p.items) throw new Error(`Array param "${p.name}" has no \`items\` schema.`);
			base.items = p.items;
			break;
		default:
			base.type = 'string';
			if (p.enum) base.enum = [...p.enum];
	}
	return base;
}

/** One capability → its OpenAI function-tool definition. */
export function toolFor(cap: Capability): LLMToolDef {
	const properties: Record<string, unknown> = {};
	const required: string[] = [];
	for (const p of cap.params) {
		properties[p.name] = paramSchema(p);
		if (p.required) required.push(p.name);
	}
	return {
		type: 'function',
		function: {
			name: cap.name,
			description: cap.summary,
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties,
				...(required.length ? { required } : {})
			}
		}
	};
}

/**
 * Conservative token estimate for a serialized tool block (real usage runs ~4 chars/token in
 * English, denser elsewhere; overestimating trims a turn early, underestimating 400s). One
 * definition, so the number the Capabilities page prices a family at and the number the
 * loop's context budget reserves for the same schemas are the same number.
 */
export const ESTIMATE_CHARS_PER_TOKEN = 3.5;

export function estimateTextTokens(text: string): number {
	return Math.ceil(text.length / ESTIMATE_CHARS_PER_TOKEN);
}

export function estimateToolTokens(tools: LLMToolDef[]): number {
	return tools.length ? estimateTextTokens(JSON.stringify(tools)) : 0;
}

/**
 * How much content may land in the conversation without anyone having asked for THAT much,
 * in estimated tokens. Two surfaces ask it, and they are the same question: a workspace
 * attachment the user ticked "in full" (loop.ts), and a file read with no range on it
 * (registry/files.ts). Past it, both degrade to an honest refusal naming the way to get the
 * content deliberately, never to a silent clip, because content the model believes it holds
 * whole is the worst of the three outcomes.
 */
export const INLINE_CONTENT_TOKEN_LIMIT = 5000;

/** The data-model section of the system prompt, generated from the entity registry. A kind
 *  riding a switched-off family (EntityDef.group) is left out: the generic reads would refuse
 *  it, and a data model that still names it would invite exactly those calls. */
export function describeDataModel(disabledGroups: readonly string[]): string {
	const off = new Set(disabledGroups);
	const lines = ENTITIES.filter((e) => !e.group || !off.has(e.group)).map((e) => {
		const editable = e.fields.filter((f) => f.editable).map((f) => fieldLabel(f));
		const readOnly = e.fields.filter((f) => !f.editable).map((f) => f.key);
		const parts = [`- **${e.kind}**: ${e.describe}`];
		if (editable.length) parts.push(`  - Fields: ${editable.join(', ')}.`);
		if (readOnly.length) parts.push(`  - Read-only: ${readOnly.join(', ')}.`);
		if (e.note) parts.push(`  - ${e.note}`);
		return parts.join('\n');
	});
	return lines.join('\n');
}

function fieldLabel(f: { key: string; type: string; enumValues?: readonly string[] }): string {
	if (f.type === 'enum' && f.enumValues) return `${f.key} [${f.enumValues.join('|')}]`;
	return f.key;
}
