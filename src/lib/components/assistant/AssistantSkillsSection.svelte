<script lang="ts">
	/**
	 * The Skills section of the embedded Assistant Settings view: one list of the user's
	 * skills and the three ways to get one (blank, from a file, from the shipped catalog).
	 * Content only: the view chrome lives in AssistantSettingsView.
	 */
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import AssistantSkillPickerDialog from './AssistantSkillPickerDialog.svelte';
	import { toastStore, failureText } from '$lib/stores/toast.svelte';
	import {
		getAllSkills,
		getDefaultSkills,
		saveSkills,
		registerSkillsReload,
		downloadSkills,
		type AssistantSkill
	} from '$lib/services/assistantSkillsService';
	import { parseSkillsFile } from '$shared/skills-file';

	/** One editable card. `saved` is the server truth; the flat fields are the draft. */
	interface Item {
		id: string;
		/** Not persisted yet: excluded from saves until its own Save. */
		isNew: boolean;
		saved: AssistantSkill | null;
		name: string;
		description: string;
		body: string;
		enabled: boolean;
		expanded: boolean;
		busy: boolean;
	}

	let items = $state<Item[]>([]);
	let loading = $state(false);
	let error = $state('');

	onMount(() => {
		void load();
		// Another device edited the set. `applySkills` keeps expansion, in-progress drafts
		// and unsaved cards, so refreshing under the user costs them nothing.
		return registerSkillsReload(load);
	});

	async function load(): Promise<void> {
		loading = true;
		error = '';
		try {
			applySkills(await getAllSkills());
		} catch (e) {
			error = failureText('load the skills', e);
		} finally {
			loading = false;
		}
	}

	/** Rebuild from a server response, keeping expansion + drafts-in-progress + unsaved cards. */
	function applySkills(skills: AssistantSkill[]): void {
		const next: Item[] = skills.map((skill) => {
			const prev = items.find((i) => i.id === skill.id);
			const keepDraft = prev && prev.saved && isDirty(prev);
			return {
				id: skill.id,
				isNew: false,
				saved: skill,
				name: keepDraft ? prev.name : skill.name,
				description: keepDraft ? prev.description : skill.description,
				body: keepDraft ? prev.body : skill.body,
				enabled: skill.enabled,
				expanded: prev?.expanded ?? false,
				busy: false
			};
		});
		next.push(...items.filter((i) => i.isNew));
		items = next;
	}

	function isDirty(item: Item): boolean {
		if (!item.saved) return true;
		return item.name !== item.saved.name || item.description !== item.saved.description || item.body !== item.saved.body;
	}

	/**
	 * The full list the server expects. Text fields come from each item's SAVED state
	 * (so saving one card never sneaks in another card's half-typed edits); the
	 * `targets` contribute their drafts instead. Toggles are live values: they save
	 * instantly.
	 */
	function buildPayload(targets: Item[]): AssistantSkill[] {
		const out: AssistantSkill[] = [];
		for (const item of items) {
			if (item.isNew && !targets.includes(item)) continue;
			const useDraft = targets.includes(item) || !item.saved;
			out.push({
				id: item.id,
				name: useDraft ? item.name : item.saved!.name,
				description: useDraft ? item.description : item.saved!.description,
				body: useDraft ? item.body : item.saved!.body,
				enabled: item.enabled
			});
		}
		return out;
	}

	async function persist(targets: Item[], successMessage: string): Promise<boolean> {
		try {
			applySkills(await saveSkills(buildPayload(targets)));
			if (successMessage) toastStore.success(successMessage);
			return true;
		} catch (e) {
			toastStore.failed('save the skills', e);
			await load();
			return false;
		}
	}

	async function toggle(item: Item): Promise<void> {
		if (item.busy) return;
		item.enabled = !item.enabled;
		if (item.isNew) return; // not persisted yet, so the toggle rides along with its first Save
		item.busy = true;
		await persist([], '');
		item.busy = false;
	}

	async function save(item: Item): Promise<void> {
		if (item.busy || (!isDirty(item) && !item.isNew)) return;
		if (!item.name.trim() || !item.description.trim() || !item.body.trim()) {
			toastStore.error('A skill needs a name, a description, and a body');
			return;
		}
		item.busy = true;
		const wasNew = item.isNew;
		if (wasNew) item.isNew = false;
		const ok = await persist([item], `${item.name.trim()} saved`);
		if (!ok && wasNew) {
			// The reload dropped the unsaved card. Put it back so the draft isn't lost.
			item.isNew = true;
			items = [...items, item];
		}
		item.busy = false;
	}

	let deleteTarget = $state<Item | null>(null);
	function requestRemove(item: Item): void {
		if (item.busy) return;
		if (item.isNew) {
			// Unsaved draft: nothing persisted to protect, drop it instantly.
			items = items.filter((i) => i !== item);
			return;
		}
		deleteTarget = item;
	}

	async function remove(): Promise<void> {
		const item = deleteTarget;
		deleteTarget = null;
		if (!item || item.busy) return;
		item.busy = true;
		items = items.filter((i) => i !== item);
		await persist([], `${item.name} deleted`);
	}

	function addBlank(): void {
		const item: Item = {
			id: crypto.randomUUID(),
			isNew: true,
			saved: null,
			name: '',
			description: '',
			body: '',
			enabled: true,
			expanded: true,
			busy: false
		};
		items = [...items, item];
	}

	// ===== Getting skills in and out: a file, or the catalog the app ships =====

	/** A skill waiting on the picker's answer. `id` is a PREFERENCE, honoured only while
	 *  it is free: a shipped skill keeps its readable id, and nothing ever overwrites. */
	interface Staged {
		id?: string;
		name: string;
		description: string;
		body: string;
		enabled: boolean;
	}

	let fileInput = $state<HTMLInputElement | null>(null);
	/** The open picker: which direction it asks about, and the rows it lists. */
	let picker = $state<{ mode: 'export' | 'import' | 'defaults'; rows: { key: string; name: string; description: string; tag?: string }[] } | null>(null);
	let staged: Staged[] = [];

	/** Only saved skills travel. A card the user has never saved is not a skill yet, and
	 *  the file has to carry what the assistant actually reads. */
	let exportable = $derived(items.filter((i) => i.saved !== null));

	function openExport(): void {
		picker = {
			mode: 'export',
			rows: exportable.map((i) => ({ key: i.id, name: i.saved!.name, description: i.saved!.description }))
		};
	}

	async function openDefaults(): Promise<void> {
		try {
			stage('defaults', await getDefaultSkills());
		} catch (e) {
			toastStore.failed('read the bundled skills', e);
		}
	}

	async function readImportFile(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			if (file.size > 2 * 1024 * 1024) throw new Error('skill files must be smaller than 2 MB');
			stage('import', parseSkillsFile(await file.text()));
		} catch (e) {
			toastStore.failed(`import "${file.name}"`, e);
		}
	}

	function stage(mode: 'import' | 'defaults', entries: Staged[]): void {
		staged = entries;
		const have = new Set(items.map((i) => i.name.trim().toLowerCase()));
		picker = {
			mode,
			rows: entries.map((e, i) => ({
				key: String(i),
				name: e.name,
				description: e.description,
				// A name already on the list starts unticked: browsing the defaults or
				// re-reading your own export must not quietly double what is on screen.
				tag: have.has(e.name.trim().toLowerCase()) ? 'In your list' : undefined
			}))
		};
	}

	function confirmPicker(keys: string[]): void {
		const mode = picker?.mode;
		picker = null;
		if (mode === 'export') exportSkills(keys);
		else if (mode) void bringIn(keys);
	}

	function exportSkills(keys: string[]): void {
		downloadSkills(
			exportable
				.filter((i) => keys.includes(i.id))
				.map((i) => ({ name: i.saved!.name, description: i.saved!.description, body: i.saved!.body, enabled: i.enabled }))
		);
	}

	async function bringIn(keys: string[]): Promise<void> {
		const chosen = keys.map((k) => staged[Number(k)]).filter(Boolean);
		staged = [];
		if (chosen.length === 0) return;
		const taken = new Set(items.map((i) => i.id));
		const added: Item[] = chosen.map((s) => {
			const id = s.id && !taken.has(s.id) ? s.id : crypto.randomUUID();
			taken.add(id);
			return { id, isNew: false, saved: null, name: s.name, description: s.description, body: s.body, enabled: s.enabled, expanded: false, busy: false };
		});
		items = [...items, ...added];
		// A failed save reloads from the server, which drops every one of them: nothing
		// lands half-added, and the source is still there to try again.
		await persist(added, `Added ${chosen.length} skill${chosen.length === 1 ? '' : 's'}`);
	}
</script>

{#snippet skillCard(item: Item)}
	<div class="skill-card" class:skill-card--expanded={item.expanded} class:skill-card--off={!item.enabled}>
		<div class="skill-row">
			<!-- Enable/disable, an instant switch: a disabled skill vanishes from the assistant's prompt. -->
			<Toggle
				checked={item.enabled}
				size="sm"
				disabled={item.busy}
				label={item.enabled ? 'Disable skill' : 'Enable skill'}
				onchange={() => toggle(item)}
			/>
			<button type="button" class="skill-summary" onclick={() => (item.expanded = !item.expanded)} aria-expanded={item.expanded}>
				<span class="skill-name">{item.name.trim() || 'New skill'}</span>
				<span class="skill-desc">{item.description.trim() || 'Describe when the assistant should use this.'}</span>
			</button>
			<button type="button" class="skill-icon-btn skill-icon-btn--danger" onclick={() => requestRemove(item)} aria-label="Delete skill" title="Delete skill">
				<Icon name="trash" class="w-3.5 h-3.5" />
			</button>
			<button type="button" class="skill-icon-btn" onclick={() => (item.expanded = !item.expanded)} aria-label={item.expanded ? 'Collapse' : 'Expand'}>
				<Icon name={item.expanded ? 'chevronDown' : 'chevronRight'} class="w-4 h-4" />
			</button>
		</div>

		{#if item.expanded}
			<div class="skill-editor">
				<label class="skill-field">
					<span class="skill-field-label">Title</span>
					<input class="skill-input" bind:value={item.name} placeholder="Skill name" maxlength="120" />
				</label>
				<label class="skill-field">
					<span class="skill-field-label">Description <span class="skill-field-hint">the one line in the assistant's index, which is what it decides from</span></span>
					<input class="skill-input" bind:value={item.description} placeholder="When should the assistant reach for this skill?" maxlength="300" />
				</label>
				<label class="skill-field">
					<span class="skill-field-label">Guide</span>
					<textarea class="skill-textarea" bind:value={item.body} spellcheck="false" rows="12" placeholder="The full instructions the assistant follows…"></textarea>
				</label>
				<div class="skill-actions">
					<div class="skill-actions-left">
						{#if item.saved && isDirty(item)}
							<button
								type="button"
								class="skill-ghost-btn"
								onclick={() => {
									item.name = item.saved!.name;
									item.description = item.saved!.description;
									item.body = item.saved!.body;
								}}
								disabled={item.busy}
							>
								Discard changes
							</button>
						{/if}
					</div>
					<button type="button" class="skill-save-btn" onclick={() => save(item)} disabled={item.busy || (!isDirty(item) && !item.isNew)}>
						<Icon name="check" class="w-3.5 h-3.5" strokeWidth={2} />
						Save
					</button>
				</div>
			</div>
		{/if}
	</div>
{/snippet}

{#if loading}
	<p class="skills-note">Loading skills…</p>
{:else if error}
	<Alert message={error} />
{:else}
	<section class="skills-group">
		<div class="skills-toolbar">
			<button type="button" class="skill-ghost-btn" onclick={openDefaults}>
				<Icon name="bookOpen" class="w-3.5 h-3.5" />
				Defaults
			</button>
			<button type="button" class="skill-ghost-btn" onclick={() => fileInput?.click()}>
				<Icon name="upload" class="w-3.5 h-3.5" />
				Import
			</button>
			<button type="button" class="skill-ghost-btn" onclick={openExport} disabled={exportable.length === 0}>
				<Icon name="download" class="w-3.5 h-3.5" />
				Export
			</button>
			<button type="button" class="skill-ghost-btn" onclick={addBlank}>
				<Icon name="plus" class="w-3.5 h-3.5" />
				New skill
			</button>
		</div>
		{#if items.length === 0}
			<p class="skills-note">No skills yet. Write one, import a set, or take the ones ChungusHub ships with from Defaults.</p>
		{:else}
			{#each items as item (item.id)}
				{@render skillCard(item)}
			{/each}
		{/if}
	</section>
{/if}

<input bind:this={fileInput} type="file" accept=".json,application/json" class="hidden" onchange={readImportFile} />

<AssistantSkillPickerDialog
	open={picker !== null}
	mode={picker?.mode ?? 'export'}
	rows={picker?.rows ?? []}
	onConfirm={confirmPicker}
	onCancel={() => {
		picker = null;
		staged = [];
	}}
/>

<ConfirmDialog
	open={deleteTarget !== null}
	title="Delete skill"
	message={`Delete the skill "${deleteTarget?.name}"? A skill ChungusHub ships with can be taken again from Defaults; one you wrote is gone unless you exported it.`}
	confirmLabel="Delete"
	variant="danger"
	destructive
	onConfirm={remove}
	onCancel={() => (deleteTarget = null)}
/>

<style>
	.skills-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1.1rem;
	}

	.skills-toolbar {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.35rem;
	}

	.skills-note {
		font-family: var(--font-ui);
		font-size: 0.76rem;
		color: var(--color-text-muted);
	}

	.skill-card {
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--color-bg-secondary) 86%, transparent);
		transition: border-color 120ms ease, opacity 120ms ease;
	}

	.skill-card--expanded {
		border-color: color-mix(in srgb, var(--color-accent) 30%, transparent);
	}

	.skill-card--off {
		opacity: 0.6;
	}

	.skill-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.55rem 0.65rem;
	}

	/* On/off switch */





	.skill-summary {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.05rem;
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
		padding: 0;
	}

	.skill-name {
		font-family: var(--font-ui);
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.skill-desc {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.skill-icon-btn {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: var(--radius-sm);
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.skill-icon-btn:hover {
		background: color-mix(in srgb, var(--color-bg-tertiary) 80%, transparent);
		color: var(--color-text-primary);
	}

	.skill-icon-btn--danger:hover {
		background: color-mix(in srgb, var(--color-error) 14%, transparent);
		color: var(--color-error);
	}

	.skill-editor {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0 0.65rem 0.65rem;
		border-top: 1px solid var(--color-border-subtle);
		padding-top: 0.6rem;
	}

	.skill-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.skill-field-label {
		font-family: var(--font-ui);
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	/* Rides the same line as the label it qualifies, so it needs a mark of its own to
	   separate the two: weight and colour alone let the sentence run into the label. */
	.skill-field-hint::before {
		content: '· ';
	}

	.skill-field-hint {
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.skill-input {
		width: 100%;
		padding: 0.45rem 0.6rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 0.8rem;
	}

	.skill-textarea {
		width: 100%;
		resize: vertical;
		min-height: 10rem;
		padding: 0.55rem 0.65rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		color: var(--color-text-primary);
		font-family: var(--font-mono, monospace);
		font-size: 0.78rem;
		line-height: 1.5;
	}

	.skill-input:focus,
	.skill-textarea:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 22%, transparent);
	}

	.skill-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
	}

	.skill-actions-left {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.skill-ghost-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.65rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-weight: 600;
		font-size: 0.74rem;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.skill-ghost-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-bg-tertiary) 80%, transparent);
		color: var(--color-text-primary);
	}

	.skill-ghost-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.skill-save-btn {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.85rem;
		border-radius: var(--radius-md);
		border: 0;
		background: var(--color-accent);
		color: var(--color-on-accent);
		font-family: var(--font-ui);
		font-weight: 600;
		font-size: 0.76rem;
		cursor: pointer;
		transition: background-color 120ms ease;
	}

	.skill-save-btn:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}

	.skill-save-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@container (max-width: 28rem) {
		.skill-row {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr) auto auto;
			gap: 0.5rem;
		}

		.skill-actions {
			align-items: stretch;
			flex-direction: column;
		}

		.skill-save-btn {
			align-self: flex-end;
		}
	}
</style>
