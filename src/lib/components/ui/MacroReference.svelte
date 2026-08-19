<script lang="ts">
	/**
	 * The one "Available macros" reference, rendered from the MACROS registry so it
	 * can never drift from what actually resolves. Macros are global: the same
	 * component appears in the Prompt Builder (plus the preset's own control macros).
	 * Flow macros carry their availability in their group hint.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import { MACROS, MACRO_GROUPS } from '$lib/macros';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { copyText } from '$lib/utils/clipboard';

	interface Props {
		/** Dynamic per-preset control macros, rendered as their own group when provided. */
		controls?: { name: string; description: string }[];
	}

	let { controls }: Props = $props();

	const groups = MACRO_GROUPS.map((g) => ({
		...g,
		macros: MACROS.filter((m) => m.group === g.id)
	})).filter((g) => g.macros.length > 0);

	// Click-to-copy feedback: the macro name most recently copied, cleared after a beat.
	// It waits for the copy, so the tick never stands in for a clipboard that stayed empty.
	let copiedMacro = $state<string | null>(null);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;
	async function copyMacro(name: string) {
		try {
			await copyText(`{{${name}}}`);
		} catch {
			toastStore.error('Copy failed. Type the macro out instead.');
			return;
		}
		copiedMacro = name;
		if (copyTimer) clearTimeout(copyTimer);
		copyTimer = setTimeout(() => (copiedMacro = null), 1300);
	}
</script>

<!-- One clickable macro tile: shows the token + description, copies {{name}} on click. -->
{#snippet macroChip(name: string, description: string, tag?: string)}
	<button
		type="button"
		onclick={() => copyMacro(name)}
		title={`Click to copy {{${name}}}`}
		class="group/chip relative flex flex-col items-start gap-1 text-left pl-2.5 pr-7 py-2 rounded-[var(--radius-md)] border border-border-subtle bg-bg-secondary/40 hover:border-accent/50 hover:bg-bg-secondary transition-colors"
	>
		<span class="flex items-center gap-1.5 flex-wrap">
			<code class="text-[11px] font-mono text-accent break-all">{`{{${name}}}`}</code>
			{#if tag}
				<span class="shrink-0 text-[9px] uppercase tracking-wide font-ui font-semibold px-1 py-px rounded bg-bg-tertiary text-text-muted">
					{tag}
				</span>
			{/if}
		</span>
		<span class="text-[11px] font-ui text-text-muted leading-snug">{description}</span>
		<span
			class="absolute top-2 right-2 transition-opacity {copiedMacro === name
				? 'opacity-100'
				: 'opacity-0 group-hover/chip:opacity-100'}"
		>
			<Icon
				name={copiedMacro === name ? 'check' : 'copy'}
				class="w-3 h-3 {copiedMacro === name ? 'text-success' : 'text-text-muted'}"
			/>
		</span>
	</button>
{/snippet}

<details class="group/macros rounded-[var(--radius-lg)] border border-border-subtle bg-bg-secondary/30">
	<summary
		class="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden"
	>
		<Icon
			name="chevronDown"
			class="w-3.5 h-3.5 shrink-0 text-accent transition-transform -rotate-90 group-open/macros:rotate-0"
		/>
		<Icon name="sparkles" class="w-3.5 h-3.5 shrink-0 text-accent" />
		<span class="text-sm font-ui font-semibold text-text-primary">Available macros</span>
		<span class="hidden sm:inline text-xs font-ui text-text-muted">
			Click to copy · a macro resolves wherever its data exists
		</span>
	</summary>

	<div class="px-3.5 pb-3.5 pt-1 space-y-4">
		{#each groups as group (group.id)}
			<div class="space-y-2">
				<div class="flex items-baseline gap-2">
					<span class="text-xs font-ui font-semibold uppercase tracking-wide text-text-secondary">
						{group.label}
					</span>
					<span class="text-[11px] font-ui text-text-muted">{group.hint}</span>
					<span class="flex-1 border-t border-border-subtle/60"></span>
				</div>
				<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
					{#each group.macros as macro (macro.name)}
						{@render macroChip(
							macro.name,
							macro.description,
							macro.structural ? 'structural' : undefined
						)}
					{/each}
				</div>
			</div>
		{/each}

		<!-- The preset's own control macros: dynamic, so they read as a distinct group. -->
		{#if controls}
			<div class="space-y-2">
				<div class="flex items-baseline gap-2">
					<span class="text-xs font-ui font-semibold uppercase tracking-wide text-text-secondary">
						This preset's controls
					</span>
					<span class="text-[11px] font-ui text-text-muted">widgets you wired up above</span>
					<span class="flex-1 border-t border-border-subtle/60"></span>
				</div>
				{#if controls.length > 0}
					<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
						{#each controls as control (control.name)}
							{@render macroChip(control.name, control.description, 'control')}
						{/each}
					</div>
				{:else}
					<p class="text-[11px] font-ui text-text-muted italic">
						No controls yet. Add one above to expose its macro here.
					</p>
				{/if}
			</div>
		{/if}

		<!-- The pruning rule, stated once where every macro author already looks. -->
		<p class="text-[11px] font-ui text-text-muted leading-snug border-t border-border-subtle/60 pt-2.5">
			<span class="font-semibold text-text-secondary">Empty blocks can prune themselves:</span>
			with the preset's “Prune empty blocks” toggle on, wrapping a macro in a plain tag
			(<code class="font-mono text-accent">&lt;memory&gt;{'{{memory}}'}&lt;/memory&gt;</code>) drops the whole
			block (tags and framing text included) from the prompt when every macro inside it comes back
			empty. Static-only blocks and unknown macro names are never touched.
		</p>
	</div>
</details>
