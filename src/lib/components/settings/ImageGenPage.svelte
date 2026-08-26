<script lang="ts">
	/**
	 * Settings → App → Image Generation: the ComfyUI the engine talks to, and everything it
	 * decides on the model's behalf.
	 *
	 * The page is ordered by how often a reader touches it: the switch and the connection at
	 * the top (set once, then never), the prompt fragments next (edited while tuning a look),
	 * and the framing tables at the bottom (edited once per checkpoint, if ever).
	 *
	 * It deliberately does NOT live on the Engines page. Every engine there is a routing
	 * point for an LLM connection, and this one answers to a diffusion server with a workflow
	 * and a sampler; putting it in that list would mean a Connections row that can never be
	 * pointed at a language model.
	 */
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import InfoTip from '$lib/components/ui/InfoTip.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { toggleRow } from '$lib/actions/toggleRow';
	import { imagegenStore } from '$lib/stores/imagegen.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { fetchCheckpoints, fetchWorkflows, pingComfy, type WorkflowEntry } from '$lib/services/imagegenService';
	import { AR_TOKENS, SHOT_TOKENS, type ArToken, type ShotToken } from '$lib/imagegen/types';
	import { MARKER_INSTRUCTIONS } from '$lib/imagegen/instructions';
	import { copyText } from '$lib/utils/clipboard';
	import { formatDate } from '$lib/utils/date';
	import { db } from '$lib/services/database';
	import type { ImagegenCacheReport } from '$shared/imagegen';

	const settings = $derived(imagegenStore.settings);

	let workflows = $state<WorkflowEntry[]>([]);
	let checkpoints = $state<string[]>([]);
	/** null = not asked yet. Kept separate from "offline" so the button never claims to know
	 *  something it has not checked. */
	let online = $state<boolean | null>(null);
	let checking = $state(false);

	async function loadWorkflows(): Promise<void> {
		try {
			workflows = await fetchWorkflows();
		} catch (error) {
			toastStore.failed('list the workflows', error);
		}
	}

	/** One button for both questions a reader has about the host: is it there, and what can
	 *  it load. Asking them separately means two round trips to answer "is this set up". */
	async function testConnection(): Promise<void> {
		checking = true;
		try {
			online = await pingComfy(settings.host);
			if (!online) {
				checkpoints = [];
				return;
			}
			checkpoints = await fetchCheckpoints(settings.host);
			if (checkpoints.length && !settings.checkpoint) {
				imagegenStore.update({ checkpoint: checkpoints[0] });
			}
		} catch (error) {
			toastStore.failed('read the checkpoint list', error);
		} finally {
			checking = false;
		}
	}

	$effect(() => {
		void loadWorkflows();
	});

	/** null = not asked yet. Only the server can answer (the files are its), and drawing a
	 *  zero before the answer lands would read as "nothing stored". */
	let cache = $state<ImagegenCacheReport | null>(null);
	let cacheBusy = $state(false);
	let confirmingSweep = $state(false);

	const limitBytes = $derived(settings.cacheLimitMb * 1024 * 1024);

	function megabytes(bytes: number): string {
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	async function refreshCache(bytes: number): Promise<void> {
		cacheBusy = true;
		try {
			cache = await db.imagegenCacheReport(bytes);
		} catch (error) {
			toastStore.failed('read the picture cache', error);
		} finally {
			cacheBusy = false;
		}
	}

	// Re-asked whenever the budget moves, because half the answer - what a sweep would take -
	// is a function of it. Every other settings change recomputes the same number and the
	// effect does not re-run.
	$effect(() => {
		void refreshCache(limitBytes);
	});

	async function runSweep(): Promise<void> {
		confirmingSweep = false;
		cacheBusy = true;
		try {
			const report = await db.sweepGeneratedImageCache(limitBytes);
			toastStore.success(
				report.files
					? `Removed ${report.files} picture${report.files === 1 ? '' : 's'}, freeing ${megabytes(report.bytes)}`
					: 'Nothing old enough to remove'
			);
		} catch (error) {
			toastStore.failed('clean up the pictures', error);
		} finally {
			cacheBusy = false;
		}
		await refreshCache(limitBytes);
	}

	const sweepMessage = $derived(
		cache && cache.files
			? `${cache.files} picture${cache.files === 1 ? '' : 's'} go, freeing ${megabytes(cache.bytes)}.` +
				(cache.oldest !== null && cache.newest !== null
					? ` They were generated between ${formatDate(cache.oldest)} and ${formatDate(cache.newest)}.`
					: '') +
				' Their markers stay in the text with a Generate button, so any of them can be made again.'
			: ''
	);

	function number(value: string, fallback: number): number {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	}

	function setResolution(token: ArToken, patch: { width?: number; height?: number }): void {
		imagegenStore.update({
			resolutions: { ...settings.resolutions, [token]: { ...settings.resolutions[token], ...patch } }
		});
	}

	function setShotTag(token: ShotToken, value: string): void {
		imagegenStore.update({ shotTags: { ...settings.shotTags, [token]: value } });
	}

	async function copyInstructions(): Promise<void> {
		await copyText(MARKER_INSTRUCTIONS);
		toastStore.success('Marker instructions copied');
	}
</script>

<div class="imagegen-page">
	<section class="card" data-setting="imagegen-engine">
		<div class="card-head">
			<span class="card-title">Image Generation</span>
			<InfoTip
				text="When a reply contains an image marker, the engine sends its prompt to ComfyUI and draws the picture where the marker stands. The marker itself stays in the text, so the model can see what it asked for last time."
			/>
		</div>

		<div class="card-body">
			<div class="toggle-row" use:toggleRow>
				<span class="slider-label">Generate images from markers</span>
				<Toggle
					checked={settings.enabled}
					onchange={(v) => imagegenStore.update({ enabled: v })}
					label="Generate images from markers"
				/>
			</div>

			<div class="toggle-row" use:toggleRow>
				<span class="slider-label">Start as soon as a reply lands</span>
				<Toggle
					checked={settings.autoGenerate}
					onchange={(v) => imagegenStore.update({ autoGenerate: v })}
					label="Start as soon as a reply lands"
				/>
			</div>
			<p class="hint">
				Off leaves every marker with its own Generate button, which is the cheaper way to
				read back a long chat.
			</p>

			<div class="row">
				<Button variant="secondary" size="sm" onclick={copyInstructions}>
					Copy marker instructions
				</Button>
				<span class="hint">
					Paste them into your preset or the character's post-history instructions. Nothing
					generates until the model writes markers.
				</span>
			</div>
		</div>
	</section>

	<section class="card" data-setting="imagegen-connection">
		<div class="card-head">
			<span class="card-title">ComfyUI</span>
			<InfoTip
				text="ChungusHub's server talks to ComfyUI, not your browser, so ComfyUI needs no CORS flag. Any address this machine can reach works, including another box on the network."
			/>
		</div>

		<div class="card-body">
			<label class="field">
				<span class="field-label">Host</span>
				<input
					class="input-base"
					type="text"
					value={settings.host}
					placeholder="http://127.0.0.1:8188"
					onchange={(e) => {
						imagegenStore.update({ host: e.currentTarget.value });
						online = null;
					}}
				/>
			</label>

			<div class="row">
				<Button variant="secondary" size="sm" disabled={checking} onclick={testConnection}>
					{checking ? 'Checking…' : 'Test connection'}
				</Button>
				{#if online === true}
					<span class="status status-ok">Reachable{checkpoints.length ? ` · ${checkpoints.length} checkpoints` : ''}</span>
				{:else if online === false}
					<span class="status status-bad">No answer at that address</span>
				{/if}
			</div>

			<label class="field">
				<span class="field-label">Checkpoint</span>
				{#if checkpoints.length}
					<Select
						value={settings.checkpoint}
						onchange={(e) => imagegenStore.update({ checkpoint: e.currentTarget.value })}
					>
						{#each checkpoints as name (name)}
							<option value={name}>{name}</option>
						{/each}
					</Select>
				{:else}
					<input
						class="input-base"
						type="text"
						value={settings.checkpoint}
						placeholder="model.safetensors"
						onchange={(e) => imagegenStore.update({ checkpoint: e.currentTarget.value })}
					/>
					<span class="hint">Test the connection to pick from the models ComfyUI has.</span>
				{/if}
			</label>

			<label class="field">
				<span class="field-label">Workflow</span>
				<Select
					value={settings.workflow}
					onchange={(e) => imagegenStore.update({ workflow: e.currentTarget.value })}
				>
					{#each workflows as workflow (workflow.name)}
						<option value={workflow.name}>
							{workflow.name}{workflow.source === 'user' ? ' (yours)' : ''}
						</option>
					{/each}
					{#if !workflows.some((w) => w.name === settings.workflow)}
						<option value={settings.workflow}>{settings.workflow} (missing)</option>
					{/if}
				</Select>
				<span class="hint">
					Drop your own API-format workflows in <code>data/imagegen-workflows/</code>. See the
					README beside the bundled one for the placeholders.
				</span>
			</label>
		</div>
	</section>

	<section class="card" data-setting="imagegen-prompt">
		<div class="card-head">
			<span class="card-title">Prompt</span>
			<InfoTip
				text="Wrapped around what the model writes: prepend, then the marker's shot tags, then its prompt, then append."
			/>
		</div>

		<div class="card-body">
			<label class="field">
				<span class="field-label">Prepend</span>
				<input
					class="input-base"
					type="text"
					value={settings.prependPrompt}
					placeholder="masterpiece, best quality"
					onchange={(e) => imagegenStore.update({ prependPrompt: e.currentTarget.value })}
				/>
			</label>

			<label class="field">
				<span class="field-label">Append</span>
				<input
					class="input-base"
					type="text"
					value={settings.appendPrompt}
					onchange={(e) => imagegenStore.update({ appendPrompt: e.currentTarget.value })}
				/>
			</label>

			<label class="field">
				<span class="field-label">Negative prompt</span>
				<textarea
					class="input-base"
					rows="2"
					value={settings.negativePrompt}
					onchange={(e) => imagegenStore.update({ negativePrompt: e.currentTarget.value })}
				></textarea>
			</label>
		</div>
	</section>

	<section class="card" data-setting="imagegen-sampling">
		<div class="card-head">
			<span class="card-title">Sampling</span>
			<InfoTip text="Passed straight to the workflow. Sampler and scheduler names must be ones your ComfyUI knows." />
		</div>

		<div class="card-body">
			<div class="grid">
				<label class="field">
					<span class="field-label">Steps</span>
					<input
						class="input-base"
						type="number"
						min="1"
						max="150"
						value={settings.steps}
						onchange={(e) => imagegenStore.update({ steps: number(e.currentTarget.value, settings.steps) })}
					/>
				</label>
				<label class="field">
					<span class="field-label">CFG</span>
					<input
						class="input-base"
						type="number"
						min="0"
						max="30"
						step="0.5"
						value={settings.cfg}
						onchange={(e) => imagegenStore.update({ cfg: number(e.currentTarget.value, settings.cfg) })}
					/>
				</label>
				<label class="field">
					<span class="field-label">Sampler</span>
					<input
						class="input-base"
						type="text"
						value={settings.sampler}
						onchange={(e) => imagegenStore.update({ sampler: e.currentTarget.value })}
					/>
				</label>
				<label class="field">
					<span class="field-label">Scheduler</span>
					<input
						class="input-base"
						type="text"
						value={settings.scheduler}
						onchange={(e) => imagegenStore.update({ scheduler: e.currentTarget.value })}
					/>
				</label>
				<label class="field">
					<span class="field-label">Denoise</span>
					<input
						class="input-base"
						type="number"
						min="0"
						max="1"
						step="0.05"
						value={settings.denoise}
						onchange={(e) => imagegenStore.update({ denoise: number(e.currentTarget.value, settings.denoise) })}
					/>
				</label>
				<label class="field">
					<span class="field-label">Timeout (s)</span>
					<input
						class="input-base"
						type="number"
						min="10"
						max="1800"
						value={settings.timeoutSeconds}
						onchange={(e) =>
							imagegenStore.update({ timeoutSeconds: number(e.currentTarget.value, settings.timeoutSeconds) })}
					/>
				</label>
			</div>
		</div>
	</section>

	<section class="card" data-setting="imagegen-framing">
		<div class="card-head">
			<span class="card-title">Framing</span>
			<InfoTip
				text="What each aspect-ratio token means in pixels, and the overrides that ignore what the model asked for. Defaults are SD1.5 sized; SDXL wants roughly 832x1216 for a portrait."
			/>
		</div>

		<div class="card-body">
			<div class="grid">
				{#each AR_TOKENS as token (token)}
					<label class="field">
						<span class="field-label">{token}</span>
						<div class="pair">
							<input
								class="input-base"
								type="number"
								min="64"
								max="4096"
								step="8"
								value={settings.resolutions[token].width}
								onchange={(e) =>
									setResolution(token, { width: number(e.currentTarget.value, settings.resolutions[token].width) })}
							/>
							<span class="times">×</span>
							<input
								class="input-base"
								type="number"
								min="64"
								max="4096"
								step="8"
								value={settings.resolutions[token].height}
								onchange={(e) =>
									setResolution(token, { height: number(e.currentTarget.value, settings.resolutions[token].height) })}
							/>
						</div>
					</label>
				{/each}
			</div>

			<div class="toggle-row" use:toggleRow>
				<span class="slider-label">Always use one resolution</span>
				<Toggle
					checked={settings.resolutionLockEnabled}
					onchange={(v) => imagegenStore.update({ resolutionLockEnabled: v })}
					label="Always use one resolution"
				/>
			</div>
			{#if settings.resolutionLockEnabled}
				<div class="pair pair-inset">
					<input
						class="input-base"
						type="number"
						min="64"
						max="4096"
						step="8"
						value={settings.resolutionLock.width}
						onchange={(e) =>
							imagegenStore.update({
								resolutionLock: {
									...settings.resolutionLock,
									width: number(e.currentTarget.value, settings.resolutionLock.width)
								}
							})}
					/>
					<span class="times">×</span>
					<input
						class="input-base"
						type="number"
						min="64"
						max="4096"
						step="8"
						value={settings.resolutionLock.height}
						onchange={(e) =>
							imagegenStore.update({
								resolutionLock: {
									...settings.resolutionLock,
									height: number(e.currentTarget.value, settings.resolutionLock.height)
								}
							})}
					/>
				</div>
			{/if}

			<div class="toggle-row" use:toggleRow>
				<span class="slider-label">Always use one shot type</span>
				<Toggle
					checked={settings.shotLockEnabled}
					onchange={(v) => imagegenStore.update({ shotLockEnabled: v })}
					label="Always use one shot type"
				/>
			</div>
			{#if settings.shotLockEnabled}
				<div class="pair-inset">
					<Select
						value={settings.shotLock}
						onchange={(e) => imagegenStore.update({ shotLock: e.currentTarget.value as ShotToken })}
					>
						{#each SHOT_TOKENS as token (token)}
							<option value={token}>{token}</option>
						{/each}
					</Select>
				</div>
			{/if}

			<div class="toggle-row" use:toggleRow>
				<span class="slider-label">Always use one seed rule</span>
				<Toggle
					checked={settings.seedLockEnabled}
					onchange={(v) => imagegenStore.update({ seedLockEnabled: v })}
					label="Always use one seed rule"
				/>
			</div>
			{#if settings.seedLockEnabled}
				<div class="pair pair-inset">
					<Select
						value={settings.seedLockMode}
						onchange={(e) =>
							imagegenStore.update({ seedLockMode: e.currentTarget.value as 'RANDOM' | 'LOCK' | 'CUSTOM' })}
					>
						<option value="RANDOM">New seed every time</option>
						<option value="LOCK">Reuse the last picture's seed</option>
						<option value="CUSTOM">A fixed seed</option>
					</Select>
					{#if settings.seedLockMode === 'CUSTOM'}
						<input
							class="input-base"
							type="number"
							min="0"
							value={settings.seedLockValue}
							onchange={(e) =>
								imagegenStore.update({ seedLockValue: number(e.currentTarget.value, settings.seedLockValue) })}
						/>
					{/if}
				</div>
			{/if}
			<p class="hint">
				Retry on a picture always takes a new random seed, whatever this says: you clicked it
				because you did not want that picture.
			</p>
		</div>
	</section>

	<section class="card" data-setting="imagegen-shot-tags">
		<div class="card-head">
			<span class="card-title">Shot tags</span>
			<InfoTip
				text="Prepended to the prompt for each shot token the model can write. The defaults are Danbooru vocabulary, which is what illustration checkpoints understand; change them to suit yours."
			/>
		</div>

		<div class="card-body">
			<div class="grid">
				{#each SHOT_TOKENS as token (token)}
					<label class="field">
						<span class="field-label">{token}</span>
						<input
							class="input-base"
							type="text"
							value={settings.shotTags[token]}
							onchange={(e) => setShotTag(token, e.currentTarget.value)}
						/>
					</label>
				{/each}
			</div>
		</div>
	</section>

	<section class="card" data-setting="imagegen-storage">
		<div class="card-head">
			<span class="card-title">Stored pictures</span>
			<InfoTip
				text="Generated pictures are kept on the server so a chat reads the same with ComfyUI switched off. Give them a size budget and the oldest are removed to stay inside it. Only pictures this engine made are ever removed - never one you attached yourself."
			/>
		</div>

		<div class="card-body">
			<p class="hint">
				{#if cache}
					{cache.totalFiles} picture{cache.totalFiles === 1 ? '' : 's'} stored, {megabytes(
						cache.totalBytes
					)}.
				{:else}
					Reading what is stored…
				{/if}
			</p>

			<label class="field">
				<span class="field-label">Budget (MB, 0 for no limit)</span>
				<input
					class="input-base"
					type="number"
					min="0"
					step="100"
					value={settings.cacheLimitMb}
					onchange={(e) =>
						imagegenStore.update({ cacheLimitMb: number(e.currentTarget.value, settings.cacheLimitMb) })}
				/>
			</label>

			<div class="toggle-row" use:toggleRow>
				<span class="slider-label">Stay inside the budget on its own</span>
				<Toggle
					checked={settings.cacheAutoSweep}
					onchange={(v) => imagegenStore.update({ cacheAutoSweep: v })}
					label="Stay inside the budget on its own"
				/>
			</div>
			<p class="hint">
				Runs after a picture lands, which is the only moment the cache grows. Off leaves the
				button below as the only thing that removes anything. Pictures made in the last hour
				are never removed either way.
			</p>

			<div class="row">
				<Button
					variant="secondary"
					size="sm"
					disabled={cacheBusy || !cache || cache.files === 0}
					onclick={() => (confirmingSweep = true)}
				>
					{cache && cache.files
						? `Clean up now (${cache.files}, ${megabytes(cache.bytes)})`
						: 'Clean up now'}
				</Button>
				<span class="hint">
					{#if !settings.cacheLimitMb}
						Set a budget above and this says what it would remove.
					{:else if cache && cache.files === 0}
						Already inside the budget. Nothing to remove.
					{:else}
						Removes the oldest pictures until the cache fits the budget.
					{/if}
				</span>
			</div>
		</div>
	</section>
</div>

<ConfirmDialog
	open={confirmingSweep}
	title="Clean up stored pictures?"
	message={sweepMessage}
	confirmLabel="Clean up"
	variant="danger"
	destructive
	onConfirm={runSweep}
	onCancel={() => (confirmingSweep = false)}
/>

<style>
	.imagegen-page {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
	}

	.field-label {
		font-family: var(--font-ui);
		font-size: 0.78rem;
		color: var(--color-text-secondary);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 0.7rem;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	.pair {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	/* Indented under the switch that reveals it, so the pair reads as that switch's
	   detail rather than as another row in the card. */
	.pair-inset {
		margin-left: 0.5rem;
		max-width: 22rem;
	}

	.times {
		opacity: 0.5;
	}

	.hint {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		margin: 0;
	}

	.status {
		font-size: 0.78rem;
	}

	.status-ok {
		color: var(--color-success);
	}

	.status-bad {
		color: var(--color-danger, #c55);
	}
</style>
