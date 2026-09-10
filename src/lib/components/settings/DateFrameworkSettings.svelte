<script lang="ts">
	/**
	 * The Date framework's app-wide tunables: the instruction block, and where it lands.
	 *
	 * Everything here is the same for every chat. Whether a story runs on real time, and
	 * whether it wants the marker visible, are that story's own decisions and live on the
	 * frameworks panel instead: a template and a position are configuration, a mode is a fact
	 * about one story.
	 *
	 * The warning under the editor is the same gentle half of the rule the engines' prompt
	 * editor uses: a template that no longer says what time it is has quietly stopped doing
	 * the only thing this framework is for, while still looking like a page of sensible
	 * instructions.
	 */
	import {
		DATE_FRAMEWORK_ID,
		DATE_PLACEHOLDERS,
		DATE_REQUIRED_PLACEHOLDERS,
		defaultDateSettings,
		normalizeDateSettings
	} from '$lib/frameworks/date';
	import { frameworkSettingsStore } from '$lib/stores/frameworkSettings.svelte';

	const settings = $derived(normalizeDateSettings(frameworkSettingsStore.configFor(DATE_FRAMEWORK_ID)));

	const missing = $derived(
		DATE_REQUIRED_PLACEHOLDERS.filter((p) => !settings.instructions.includes(p))
	);

	const isDefault = $derived(settings.instructions === defaultDateSettings().instructions);

	function patch(fields: Record<string, unknown>) {
		frameworkSettingsStore.patchConfig(DATE_FRAMEWORK_ID, fields);
	}

	const ROLES = [
		{ value: 'system', label: 'System' },
		{ value: 'user', label: 'User' },
		{ value: 'assistant', label: 'Assistant' }
	] as const;
</script>

<section class="card">
	<h4>Instructions</h4>
	<p class="hint">
		Sent every turn while a chat is on real time. These placeholders are filled in:
		{#each DATE_PLACEHOLDERS as placeholder, i (placeholder)}<code>{placeholder}</code
			>{#if i < DATE_PLACEHOLDERS.length - 1}{', '}{/if}{/each}. Nothing else is: this block is
		injected after macros have already been expanded, so any other <code>{'{{'}...{'}}'}</code> reaches
		the model as written.
	</p>
	<textarea
		rows="14"
		spellcheck="false"
		value={settings.instructions}
		oninput={(e) => patch({ instructions: e.currentTarget.value })}
		aria-label="Date framework instructions"
	></textarea>
	{#if missing.length > 0}
		<p class="warn">
			This no longer says what time it is ({missing.join(' and ')} is gone), so the model is
			being given rules about a time it was never told.
		</p>
	{/if}
	{#if !isDefault}
		<button type="button" class="reset" onclick={() => patch({ instructions: undefined })}>
			Restore the default text
		</button>
	{/if}
</section>

<section class="card">
	<h4>Placement</h4>
	<p class="hint">
		In the chat is where an instruction about THIS reply belongs: at depth 0 it sits right
		against the generation point, where a long prompt cannot bury it. The lorebook block is
		further from the model's attention but keeps the chat clean.
	</p>
	<label class="row">
		<span>Where</span>
		<select
			value={settings.atDepth ? 'depth' : 'block'}
			onchange={(e) => patch({ atDepth: e.currentTarget.value === 'depth' })}
		>
			<option value="depth">In the chat, at a depth</option>
			<option value="block">In the lorebook block</option>
		</select>
	</label>
	{#if settings.atDepth}
		<label class="row">
			<span>Depth</span>
			<input
				type="number"
				min="0"
				max="100"
				value={settings.depth}
				oninput={(e) => patch({ depth: Number(e.currentTarget.value) })}
			/>
		</label>
		<label class="row">
			<span>As</span>
			<select value={settings.role} onchange={(e) => patch({ role: e.currentTarget.value })}>
				{#each ROLES as role (role.value)}
					<option value={role.value}>{role.label}</option>
				{/each}
			</select>
		</label>
	{/if}
</section>

<style>
	h4 {
		margin: 0 0 0.3rem;
		font-family: var(--font-ui);
		font-size: 0.8rem;
		font-weight: 640;
		color: var(--color-text-primary);
	}

	.hint {
		margin: 0 0 0.6rem;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		line-height: 1.5;
		color: var(--color-text-muted);
	}

	textarea {
		width: 100%;
		resize: vertical;
		padding: 0.55rem 0.6rem;
		border-radius: var(--radius-md);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
		background: color-mix(in srgb, var(--color-bg-tertiary) 40%, transparent);
		color: var(--color-text-primary);
		font-family: var(--font-mono, monospace);
		font-size: 0.72rem;
		line-height: 1.55;
	}

	.warn {
		margin: 0.5rem 0 0;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		line-height: 1.45;
		color: var(--color-warning);
	}

	.reset {
		margin-top: 0.5rem;
		align-self: flex-start;
		padding: 0.25rem 0.5rem;
		border-radius: var(--radius-md);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
		background: transparent;
		cursor: pointer;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-text-secondary);
	}

	.reset:hover {
		color: var(--color-text-primary);
	}

	.row {
		display: grid;
		grid-template-columns: 5rem minmax(0, 1fr);
		align-items: center;
		gap: 0.6rem;
		margin-top: 0.4rem;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		color: var(--color-text-secondary);
	}

	.row select,
	.row input {
		padding: 0.3rem 0.4rem;
		border-radius: var(--radius-md);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
		background: color-mix(in srgb, var(--color-bg-tertiary) 40%, transparent);
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 0.74rem;
	}
</style>
