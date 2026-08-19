<script lang="ts">
	/**
	 * The whole Ambient Effects settings surface: stage, catalog, mix, whole-mix.
	 *
	 * One interface for both readers of it. Picking a single effect is one tap in
	 * the catalog; its row appears just below with that effect's own settings
	 * unfolded, and nothing else is in the way. Stacking is the same gesture
	 * repeated: every active effect holds a row in the mix, each tunable on its
	 * own, with the whole-mix sliders scaling all of them at once.
	 *
	 * Zone order is load-bearing: everything the selection adds (rows, whole-mix
	 * controls) appends BELOW the catalog, so a tapped pill never moves under the
	 * pointer. The stage keeps one size whether empty or playing, for the same
	 * reason.
	 *
	 * The hosting card, its title/InfoTip and the Clear all action live in
	 * settings/InterfacePage.svelte, which also carries data-setting="ambient-effects".
	 */
	import type { AmbientEffect, AmbientType } from '$lib/types/ambient';
	import {
		AMBIENT_EFFECTS,
		AMBIENT_LABELS,
		AMBIENT_DESCRIPTIONS,
		AMBIENT_EFFECT_SETTINGS,
		getEffectSettingDefaults
	} from '$lib/types/ambient';
	import {
		ambientStore,
		DENSITY_RANGE,
		SPEED_RANGE,
		VISIBILITY_RANGE
	} from '$lib/stores/ambient.svelte';
	import { backgroundStore } from '$lib/stores/background.svelte';
	import AmbientCanvas from './AmbientCanvas.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Slider from '$lib/components/ui/Slider.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import { rangeReset } from '$lib/actions/rangeReset';
	import { toggleRow } from '$lib/actions/toggleRow';

	const SHELVES = [
		{ id: 'weather', label: 'Weather' },
		{ id: 'nature', label: 'Nature' },
		{ id: 'scene', label: 'Scene' }
	] as const;

	type ShelfId = (typeof SHELVES)[number]['id'];

	// Which catalog shelf each effect sits on. Exhaustive by type on purpose: a
	// new AMBIENT_EFFECTS entry that is not placed here is a compile error, not a
	// pill that silently never appears.
	const EFFECT_SHELF: Record<AmbientEffect, ShelfId> = {
		rain: 'weather',
		snow: 'weather',
		storm: 'weather',
		fog: 'weather',
		sandstorm: 'weather',
		aurora: 'weather',
		blizzard: 'weather',
		leaves: 'nature',
		petals: 'nature',
		pollen: 'nature',
		sunshine: 'nature',
		starlight: 'nature',
		fireflies: 'nature',
		smoke: 'scene',
		underwater: 'scene',
		ash: 'scene',
		wisps: 'scene',
		fireplace: 'scene',
		lanterns: 'scene',
		filmgrain: 'scene'
	};

	/** Shelf contents in AMBIENT_EFFECTS order, so the picker still follows THE list. */
	function effectsOn(shelf: ShelfId): AmbientEffect[] {
		return AMBIENT_EFFECTS.filter((effect) => EFFECT_SHELF[effect] === shelf);
	}

	let config = $derived(ambientStore.config);
	let active = $derived(config.types);
	let backgroundUrl = $derived(backgroundStore.url);
	let backgroundDim = $derived(backgroundStore.config.dim);

	// Mix rows whose settings are unfolded. Session state only; a just-added
	// configurable effect unfolds so its knobs introduce themselves.
	let expanded = $state<AmbientType[]>([]);

	function isOn(type: AmbientType): boolean {
		return active.includes(type);
	}

	function hasSettings(type: AmbientType): boolean {
		return (AMBIENT_EFFECT_SETTINGS[type]?.length ?? 0) > 0;
	}

	function toggleEffect(type: AmbientType): void {
		const adding = !isOn(type);
		ambientStore.toggleAmbient(type);
		if (adding && hasSettings(type)) {
			if (!expanded.includes(type)) expanded = [...expanded, type];
		} else if (!adding) {
			expanded = expanded.filter((t) => t !== type);
		}
	}

	function toggleExpanded(type: AmbientType): void {
		expanded = expanded.includes(type)
			? expanded.filter((t) => t !== type)
			: [...expanded, type];
	}

	function effectSettingValue(type: AmbientType, key: string): number {
		return config.effectSettings[type]?.[key] ?? getEffectSettingDefaults(type)[key] ?? 0;
	}

	const pct = (v: number) => `${Math.round(v * 100)}%`;

	// The three sliders that scale every active effect at once.
	const WHOLE_MIX_SLIDERS = [
		{
			id: 'ambient-density',
			label: 'Density',
			range: DENSITY_RANGE,
			value: () => config.density,
			set: (v: number) => ambientStore.setDensity(v)
		},
		{
			id: 'ambient-speed',
			label: 'Speed',
			range: SPEED_RANGE,
			value: () => config.speed,
			set: (v: number) => ambientStore.setSpeed(v)
		},
		{
			id: 'ambient-visibility',
			label: 'Visibility',
			range: VISIBILITY_RANGE,
			value: () => config.visibility,
			set: (v: number) => ambientStore.setVisibility(v)
		}
	];
</script>

<div class="mixer">
	<!-- Stage: the mix as it will play, over the real workspace background and its
	     dim. One fixed footprint whether empty or playing, so the first pick never
	     shifts the catalog below it. -->
	<div class="stage" class:stage-unset={active.length === 0}>
		{#if active.length === 0}
			<div class="stage-invite">
				<span class="stage-invite-title">Still air</span>
				<span class="stage-invite-hint">Pick an effect below to set the scene.</span>
			</div>
		{:else}
			{#if backgroundUrl}
				<img class="stage-bg" src={backgroundUrl} alt="" />
				<!-- The workspace dim is always plain black; the stage mirrors it. -->
				<div class="stage-dim" style="opacity: {backgroundDim}"></div>
			{/if}
			<div class="stage-chat" aria-hidden="true">
				<div class="stage-bubble stage-bubble-user">The storm rolled in just after dusk.</div>
				<div class="stage-bubble">She watched the first drops streak the glass.</div>
			</div>
			<AmbientCanvas
				types={active}
				density={config.density}
				speed={config.speed}
				visibility={config.visibility}
				effectSettings={config.effectSettings}
			/>
		{/if}
	</div>

	<!-- Catalog: every effect, one tap to add or remove. A new effect joins its
	     shelf through EFFECT_SHELF and the grid absorbs it. -->
	<div class="catalog">
		{#each SHELVES as shelf (shelf.id)}
			<div class="shelf">
				<span class="section-label">{shelf.label}</span>
				<div class="shelf-pills" role="group" aria-label="{shelf.label} effects">
					{#each effectsOn(shelf.id) as type (type)}
						<button
							type="button"
							class="fx-pill"
							class:is-active-tint={isOn(type)}
							aria-pressed={isOn(type)}
							title={AMBIENT_DESCRIPTIONS[type]}
							onclick={() => toggleEffect(type)}
						>
							{AMBIENT_LABELS[type]}
						</button>
					{/each}
				</div>
			</div>
		{/each}
	</div>

	{#if active.length > 0}
		<!-- The mix: one row per active effect, its own settings folded inside. -->
		<div class="mix">
			<span class="section-label">In the mix</span>
			{#each active as type (type)}
				{@const defs = AMBIENT_EFFECT_SETTINGS[type] ?? []}
				{@const open = expanded.includes(type)}
				<div class="fx-row" class:fx-row-open={open}>
					<div class="fx-row-head">
						{#if defs.length > 0}
							<button
								type="button"
								class="fx-row-main"
								aria-expanded={open}
								onclick={() => toggleExpanded(type)}
							>
								<span class="fx-name">{AMBIENT_LABELS[type]}</span>
								<Icon name="chevronDown" class="w-3.5 h-3.5 fx-chevron" />
							</button>
						{:else}
							<span class="fx-row-main">
								<span class="fx-name">{AMBIENT_LABELS[type]}</span>
							</span>
						{/if}
						<button
							type="button"
							class="fx-remove"
							aria-label="Remove {AMBIENT_LABELS[type]}"
							title="Remove from the mix"
							onclick={() => toggleEffect(type)}
						>
							<Icon name="x" class="w-3.5 h-3.5" />
						</button>
					</div>

					{#if open}
						<div class="fx-settings">
							{#each defs as def (def.key)}
								<span class="fx-setting-label">{def.label}</span>
								{#if def.kind === 'toggle'}
									<div class="fx-setting-toggle">
										<Toggle
											checked={effectSettingValue(type, def.key) >= 0.5}
											label={def.label}
											onchange={(on) => ambientStore.setEffectSetting(type, def.key, on ? 1 : 0)}
										/>
									</div>
								{:else}
									<Slider
										value={effectSettingValue(type, def.key)}
										min={def.min}
										max={def.max}
										step={def.step}
										defaultValue={def.defaultValue}
										format={pct}
										label={def.label}
										oninput={(v) => ambientStore.setEffectSetting(type, def.key, v)}
									/>
								{/if}
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>

		<!-- Whole mix: scales every active effect at once, and where particles sit
		     relative to message bubbles. -->
		<div class="whole" data-setting="ambient-display">
			<span class="section-label">Whole mix</span>
			{#each WHOLE_MIX_SLIDERS as s (s.id)}
				<div class="slider-block">
					<div class="slider-top">
						<label for={s.id} class="slider-label">{s.label}</label>
						<span class="slider-value">{pct(s.value())}</span>
					</div>
					<input
						id={s.id}
						type="range"
						class="slider"
						min={s.range.min}
						max={s.range.max}
						step="0.05"
						value={s.value()}
						oninput={(e) => s.set(parseFloat(e.currentTarget.value))}
						use:rangeReset={{ defaultValue: s.range.default, apply: s.set }}
					/>
				</div>
			{/each}

			<div class="toggle-row" use:toggleRow>
				<span class="slider-label">Show particles over messages</span>
				<Toggle
					checked={config.particlesOverMessages}
					label="Show particles over messages"
					onchange={(on) => ambientStore.setParticlesOverMessages(on)}
				/>
			</div>
		</div>
	{/if}
</div>

<style>
	.mixer {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	/* --- Stage --- */

	.stage {
		position: relative;
		aspect-ratio: 5 / 2;
		min-height: 8rem;
		max-height: 13rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg-primary);
		overflow: hidden;
	}

	.stage-unset {
		border-style: dashed;
	}

	.stage-bg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	/* Photographic scrim over a picture, like the workspace's own: always plain black. */
	.stage-dim {
		position: absolute;
		inset: 0;
		background: black;
	}

	.stage-invite {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.2rem;
		text-align: center;
		padding: 0 1rem;
	}

	.stage-invite-title {
		font-family: var(--font-ui);
		font-size: 0.78rem;
		font-weight: 650;
		color: var(--color-text-secondary);
	}

	.stage-invite-hint {
		font-family: var(--font-ui);
		font-size: 0.68rem;
		color: var(--color-text-muted);
	}

	.stage-chat {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.45rem;
		padding: 0.85rem;
		pointer-events: none;
	}

	.stage-bubble {
		max-width: 72%;
		align-self: flex-start;
		padding: 0.3rem 0.6rem;
		border-radius: 0.75rem;
		background: var(--color-assistant-bubble);
		font-size: 0.7rem;
		line-height: 1.4;
		color: var(--color-text-primary);
	}

	.stage-bubble-user {
		align-self: flex-end;
		background: var(--color-user-bubble);
	}

	/* --- Catalog --- */

	/* Shelves stack in a dock and sit side by side once the card is wide enough;
	   auto-fill lets a future fourth shelf wrap in without a breakpoint. */
	.catalog {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
		gap: 0.8rem 1.1rem;
	}

	.shelf {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.shelf-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	/* Multi-select twin of ui/PillRow's pill: same body, aria-pressed instead of
	   radio semantics, since any number can be on at once. */
	.fx-pill {
		padding: 0.28rem 0.65rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
		border-radius: var(--radius-full);
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.74rem;
		font-weight: 550;
		cursor: pointer;
		transition: color 90ms ease, border-color 90ms ease, background 90ms ease;
	}

	.fx-pill:hover {
		color: var(--color-text-primary);
		border-color: color-mix(in srgb, var(--color-border) 90%, transparent);
	}

	/* Scoped active tint: the canonical .is-active-tint recipe is in a cascade layer,
	   so this unlayered scoped base would otherwise override it. Placed after :hover so
	   the active pill stays tinted while hovered. */
	.fx-pill.is-active-tint {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 13%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 33%, transparent);
	}

	/* --- The mix --- */

	.mix {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.fx-row {
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-bg-tertiary) 35%, transparent);
	}

	.fx-row-head {
		display: flex;
		align-items: center;
	}

	.fx-row-main {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.42rem 0.35rem 0.42rem 0.6rem;
		text-align: left;
	}

	button.fx-row-main {
		cursor: pointer;
		border-radius: var(--radius-md);
		transition: background-color 120ms ease;
	}

	button.fx-row-main:hover {
		background: color-mix(in srgb, var(--color-bg-tertiary) 55%, transparent);
	}

	.fx-name {
		font-family: var(--font-ui);
		font-size: 0.76rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.fx-row-main :global(.fx-chevron) {
		flex-shrink: 0;
		color: var(--color-text-muted);
		transition: transform 160ms ease;
	}

	.fx-row-open .fx-row-main :global(.fx-chevron) {
		transform: rotate(180deg);
	}

	@media (prefers-reduced-motion: reduce) {
		.fx-row-main :global(.fx-chevron) {
			transition: none;
		}
	}

	.fx-remove {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.7rem;
		height: 1.7rem;
		margin-right: 0.2rem;
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: color 120ms ease, background-color 120ms ease;
	}

	.fx-remove:hover {
		color: var(--color-text-primary);
		background: color-mix(in srgb, var(--color-bg-tertiary) 70%, transparent);
	}

	.fx-settings {
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: center;
		gap: 0.4rem 0.75rem;
		padding: 0.5rem 0.6rem 0.55rem;
		border-top: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
	}

	.fx-setting-label {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-text-secondary);
	}

	.fx-setting-toggle {
		justify-self: end;
	}

	/* --- Whole mix --- */

	.whole {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
</style>
