<script lang="ts">
	/**
	 * One tool definition sent with a request. Tool schemas are routinely more than half of
	 * an assistant prompt, so they are READABLE here rather than reduced to a count: the
	 * whole point of the Pretty view is that the biggest part of the payload can be read in
	 * it. Collapsed shows the name, its one-line summary and its size; expanded shows the
	 * full description and the exact JSON Schema the model received.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import CopyButton from './CopyButton.svelte';
	import { roleColor, toolTokens } from '$lib/debug/format';

	interface Props {
		tool: unknown;
		model?: string;
		collapsed: boolean;
		onToggle: () => void;
	}

	let { tool, model, collapsed, onToggle }: Props = $props();

	/** Providers take tool definitions in OpenAI's `{type:'function', function:{…}}` shape,
	 *  which is what every caller here builds. Anything else is shown as raw JSON under an
	 *  explicit label rather than silently rendered as an empty tool. */
	let shape = $derived.by(() => {
		const fn = (tool as { function?: { name?: unknown; description?: unknown; parameters?: unknown } })?.function;
		if (fn && typeof fn.name === 'string') {
			return {
				name: fn.name,
				description: typeof fn.description === 'string' ? fn.description : '',
				schema: JSON.stringify(fn.parameters ?? {}, null, 2)
			};
		}
		return { name: '(unrecognized tool shape)', description: '', schema: JSON.stringify(tool, null, 2) };
	});

	let tokens = $derived(toolTokens([tool], model));
	const json = () => JSON.stringify(tool, null, 2);
</script>

<div class="tool-def" style={`--tool-color: ${roleColor('tool')}`}>
	<div class="head">
		<button class="toggle" type="button" onclick={onToggle} aria-expanded={!collapsed}>
			<Icon name={collapsed ? 'chevronRight' : 'chevronDown'} class="w-3 h-3 shrink-0" strokeWidth={2.25} />
			<span class="name">{shape.name}</span>
			{#if collapsed && shape.description}<span class="summary">{shape.description}</span>{/if}
			<span class="meta">~{tokens.toLocaleString()} tok</span>
		</button>
		<CopyButton quiet text={json} title="Copy this tool definition as JSON" />
	</div>

	{#if !collapsed}
		{#if shape.description}<p class="desc">{shape.description}</p>{/if}
		<pre class="schema">{shape.schema}</pre>
	{/if}
</div>

<style>
	.tool-def {
		border-left: 2px solid var(--tool-color);
		border-bottom: 1px solid var(--color-border-subtle);
		min-width: 0;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding-right: 0.35rem;
	}

	.toggle {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.32rem 0.5rem;
		border: 0;
		background: transparent;
		cursor: pointer;
		text-align: left;
		color: var(--color-text-muted);
		transition: background-color 110ms ease;
	}

	.toggle:hover {
		background: color-mix(in srgb, var(--tool-color) 8%, transparent);
	}

	.name {
		flex-shrink: 0;
		font-family: var(--font-mono, monospace);
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	/* One line, clipped: 25 of these are a list to scan, not 25 paragraphs to read. The
	   full text is one click away and never truncated there. */
	.summary {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-ui);
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	.meta {
		margin-left: auto;
		flex-shrink: 0;
		font-family: var(--font-mono, monospace);
		font-size: 0.64rem;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.desc {
		margin: 0;
		padding: 0.1rem 0.6rem 0.45rem 0.95rem;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		line-height: 1.5;
		color: var(--color-text-secondary);
	}

	.schema {
		margin: 0 0.6rem 0.55rem 0.95rem;
		padding: 0.4rem;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-family: var(--font-mono, monospace);
		font-size: 0.72rem;
		line-height: 1.5;
		color: var(--color-text-secondary);
		background: color-mix(in srgb, var(--color-bg-tertiary) 35%, transparent);
		border-radius: var(--radius-sm);
	}
</style>
