<script lang="ts">
	import { onMount } from 'svelte';
	import type {
		AmbientConfig,
		AmbientEffect,
		AmbientParams,
		AmbientPlacement
	} from '$lib/types/ambient';
	import { effectSetting, effectsPlaced, getEffectSettingDefaults } from '$lib/types/ambient';
	import { createRainState, updateRain, renderRain } from './effects/rain';
	import { createSnowState, updateSnow, renderSnow } from './effects/snow';
	import { createStormState, updateStorm, renderStorm } from './effects/storm';
	import { createSunshineState, updateSunshine, renderSunshine } from './effects/sunshine';
	import { createFireplaceState, updateFireplace, renderFireplace } from './effects/fireplace';
	import { createFogState, updateFog, renderFog } from './effects/fog';
	import { createFirefliesState, updateFireflies, renderFireflies } from './effects/fireflies';
	import { createAshState, updateAsh, renderAsh } from './effects/ash';
	import { createStarlightState, updateStarlight, renderStarlight } from './effects/starlight';
	import { createLeavesState, updateLeaves, renderLeaves } from './effects/leaves';
	import { createPetalsState, updatePetals, renderPetals } from './effects/petals';
	import { createSmokeState, updateSmoke, renderSmoke } from './effects/smoke';
	import { createBlizzardState, updateBlizzard, renderBlizzard } from './effects/blizzard';
	import { createUnderwaterState, updateUnderwater, renderUnderwater } from './effects/underwater';
	import { createSandstormState, updateSandstorm, renderSandstorm } from './effects/sandstorm';
	import { createAuroraState, updateAurora, renderAurora } from './effects/aurora';
	import { createPollenState, updatePollen, renderPollen } from './effects/pollen';
	import { createWispsState, updateWisps, renderWisps } from './effects/wisps';
	import { createLanternsState, updateLanterns, renderLanterns } from './effects/lanterns';
	import { createFilmGrainState, updateFilmGrain, renderFilmGrain } from './effects/filmgrain';

	interface Props {
		/** The whole mix. One object rather than a prop per field, so an effect gaining a
		 *  knob never has to be threaded through the call sites. */
		config: AmbientConfig;
		/** Which side of the message layer this canvas is, and therefore which of the
		 *  mix's effects it draws. The caller stacks it accordingly. */
		placement: AmbientPlacement;
		paused?: boolean;
		class?: string;
	}

	let { config, placement, paused = false, class: className = '' }: Props = $props();

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null = null;
	let animationFrame: number | null = null;
	let lastTime = 0;

	// The density a settling drag is heading for, when it last moved, and when a state was
	// last baked (NOT reactive).
	let driftKey = '';
	let driftSince = 0;
	let lastBakeAt = 0;

	interface EffectDef<S> {
		baseCount: number;
		create: (count: number, width: number, height: number) => S;
		update: (state: S, width: number, height: number, params: AmbientParams, deltaTime: number) => void;
		render: (ctx: CanvasRenderingContext2D, state: S, width: number, height: number, params: AmbientParams) => void;
	}

	function defineEffect<S>(def: EffectDef<S>): EffectDef<unknown> {
		return def as EffectDef<unknown>;
	}

	// Base counts are tuned for a 1920x1080 canvas; syncStates scales them by
	// actual canvas area so a phone doesn't get a desktop's particle density
	// crammed into a quarter of the space.
	// Exhaustive by type: a new AMBIENT_EFFECTS entry without a renderer here is a
	// compile error, not an effect that silently paints nothing.
	const EFFECTS: Record<AmbientEffect, EffectDef<unknown>> = {
		rain: defineEffect({ baseCount: 300, create: createRainState, update: updateRain, render: renderRain }),
		snow: defineEffect({ baseCount: 150, create: createSnowState, update: updateSnow, render: renderSnow }),
		storm: defineEffect({ baseCount: 250, create: createStormState, update: updateStorm, render: renderStorm }),
		fog: defineEffect({ baseCount: 120, create: createFogState, update: updateFog, render: renderFog }),
		sandstorm: defineEffect({ baseCount: 260, create: createSandstormState, update: updateSandstorm, render: renderSandstorm }),
		aurora: defineEffect({ baseCount: 60, create: createAuroraState, update: updateAurora, render: renderAurora }),
		leaves: defineEffect({ baseCount: 70, create: createLeavesState, update: updateLeaves, render: renderLeaves }),
		petals: defineEffect({ baseCount: 65, create: createPetalsState, update: updatePetals, render: renderPetals }),
		pollen: defineEffect({ baseCount: 90, create: createPollenState, update: updatePollen, render: renderPollen }),
		smoke: defineEffect({ baseCount: 64, create: createSmokeState, update: updateSmoke, render: renderSmoke }),
		blizzard: defineEffect({ baseCount: 110, create: createBlizzardState, update: updateBlizzard, render: renderBlizzard }),
		underwater: defineEffect({ baseCount: 100, create: createUnderwaterState, update: updateUnderwater, render: renderUnderwater }),
		sunshine: defineEffect({ baseCount: 80, create: createSunshineState, update: updateSunshine, render: renderSunshine }),
		starlight: defineEffect({ baseCount: 110, create: createStarlightState, update: updateStarlight, render: renderStarlight }),
		fireflies: defineEffect({ baseCount: 65, create: createFirefliesState, update: updateFireflies, render: renderFireflies }),
		ash: defineEffect({ baseCount: 120, create: createAshState, update: updateAsh, render: renderAsh }),
		wisps: defineEffect({ baseCount: 26, create: createWispsState, update: updateWisps, render: renderWisps }),
		fireplace: defineEffect({ baseCount: 60, create: createFireplaceState, update: updateFireplace, render: renderFireplace }),
		lanterns: defineEffect({ baseCount: 18, create: createLanternsState, update: updateLanterns, render: renderLanterns }),
		filmgrain: defineEffect({ baseCount: 40, create: createFilmGrainState, update: updateFilmGrain, render: renderFilmGrain })
	};

	// Back-to-front compositing order for stacked effects. Its own information (not the
	// picker order), so it stays a hand-written list. Completeness is asserted in
	// src/lib/contracts.test.ts, since an effect missing here simply never paints.
	const EFFECT_RENDER_ORDER: AmbientEffect[] = [
		'underwater',
		'aurora',
		'sunshine',
		'starlight',
		'lanterns',
		'fog',
		'sandstorm',
		'smoke',
		'rain',
		'snow',
		'blizzard',
		'storm',
		'leaves',
		'petals',
		'pollen',
		'fireflies',
		'ash',
		'wisps',
		'fireplace',
		'filmgrain'
	];

	// Live effect states, keyed by type (plain map, not reactive)
	const effectStates = new Map<AmbientEffect, unknown>();

	// The density each live state was built with. Particle counts are baked in at
	// creation, so a state has to be rebuilt when ITS density moves; keyed per effect so
	// one row's slider never rebuilds the rest of the stack.
	const stateDensity = new Map<AmbientEffect, number>();

	const REFERENCE_AREA = 1920 * 1080;

	// Cap a runaway frame delta (tab jank, breakpoint) so particles don't teleport
	const MAX_DELTA_MS = 64;

	// How still a density has to be before its effect is baked again. Building a state is
	// not a cheap allocation: the textured effects bake full-screen offscreen canvases in
	// `create…State` (fog draws three of them, over a hundred gradient blobs each), so a
	// slider dragged at pointer rate would bake them tens of times a second and take the
	// frame rate with it. Speed and visibility are read fresh every frame and never come
	// through here, so those two drags stay live.
	const DENSITY_SETTLE_MS = 150;

	// Room between two bakes. One effect joining is a tap on a catalog pill and arrives
	// with it, since nothing else is happening in that frame. A whole scene arriving is
	// several at once, on top of the chat that is rendering underneath them, so those
	// leave the frames between them alone: nobody is waiting on weather.
	const JOIN_STAGGER_MS = 80;

	function resolveAmbientTypes(): AmbientEffect[] {
		return effectsPlaced(config, placement);
	}

	function densityFor(type: AmbientEffect): number {
		return effectSetting(config, type, 'density');
	}

	function scaledCount(baseCount: number, width: number, height: number, density: number): number {
		const areaScale = Math.max(0.25, Math.min(1.2, (width * height) / REFERENCE_AREA));
		return Math.max(4, Math.round(baseCount * areaScale * density));
	}

	function bakeState(type: AmbientEffect, width: number, height: number): void {
		const def = EFFECTS[type];
		const density = densityFor(type);
		effectStates.set(type, def.create(scaledCount(def.baseCount, width, height, density), width, height));
		stateDensity.set(type, density);
	}

	// Both of these run on every frame of every canvas, so they allocate nothing: the
	// work below them is what the answer buys.
	function membershipMatches(activeTypes: AmbientEffect[]): boolean {
		if (effectStates.size !== activeTypes.length) return false;
		for (const type of activeTypes) if (!effectStates.has(type)) return false;
		return true;
	}

	function densityDrifted(activeTypes: AmbientEffect[]): boolean {
		for (const type of activeTypes) {
			if (effectStates.has(type) && stateDensity.get(type) !== densityFor(type)) return true;
		}
		return false;
	}

	/**
	 * Drop what has left the mix and bake what has joined it, **one effect at a time**.
	 *
	 * A scene arriving with five effects would otherwise bake five sets of offscreen
	 * textures inside a single frame, which is the lurch a chat with a scene of its own
	 * opens with. One at a time, spaced, the weather arrives over a moment instead, which
	 * is both smoother and closer to what weather does.
	 */
	function syncMembership(
		activeTypes: AmbientEffect[],
		width: number,
		height: number,
		now: number
	): void {
		const active = new Set<AmbientEffect>(activeTypes);

		for (const existing of [...effectStates.keys()]) {
			if (!active.has(existing)) {
				effectStates.delete(existing);
				stateDensity.delete(existing);
			}
		}

		const joined = activeTypes.find((type) => !effectStates.has(type));
		if (!joined || now - lastBakeAt < JOIN_STAGGER_MS) return;
		bakeState(joined, width, height);
		lastBakeAt = now;
	}

	/** Re-bake the effects whose density has moved, once the move has stopped. */
	function bakeSettledDensity(
		activeTypes: AmbientEffect[],
		width: number,
		height: number,
		now: number
	): void {
		const drifted = activeTypes.filter(
			(type) => effectStates.has(type) && stateDensity.get(type) !== densityFor(type)
		);
		const key = drifted.map((type) => `${type}@${densityFor(type).toFixed(2)}`).join('|');
		if (key !== driftKey) {
			driftKey = key;
			driftSince = now;
			return;
		}
		if (now - driftSince < DENSITY_SETTLE_MS) return;

		for (const type of drifted) bakeState(type, width, height);
		lastBakeAt = now;
		driftKey = '';
	}

	/** Everything at once, for a resize: the states hold the size they were baked at. */
	function rebakeAll(width: number, height: number): void {
		for (const type of [...effectStates.keys()]) bakeState(type, width, height);
		driftKey = '';
	}

	/** One merge per effect per frame: the renderer gets every knob of that effect,
	 *  and the two the loop itself needs come out of the same bag, so neither can be
	 *  looking at a different number. */
	function paramsFor(type: AmbientEffect): AmbientParams {
		const settings = { ...getEffectSettingDefaults(type), ...config.effectSettings[type] };
		return { speed: settings.speed, visibility: settings.visibility, settings };
	}

	function resize(): void {
		if (!canvas) return;

		const rect = canvas.getBoundingClientRect();
		// Cap DPR at 1 - ambient effects don't need retina resolution
		// This alone can reduce GPU load by 4x on high-DPI displays
		canvas.width = rect.width;
		canvas.height = rect.height;

		if (ctx) {
			ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset any previous scale
		}

		// The states hold the size they were baked at, so a resize re-bakes them.
		rebakeAll(rect.width, rect.height);
	}

	function update(currentTime: number): void {
		// Keep the last rendered frame visible while paused.
		if (paused) {
			animationFrame = null;
			lastTime = 0;
			return;
		}

		if (!ctx || !canvas) return;

		// Skip rendering when tab is not visible - saves massive GPU
		if (document.hidden) {
			lastTime = 0; // Reset to avoid huge deltaTime spike on resume
			animationFrame = requestAnimationFrame(update);
			return;
		}

		const deltaTime = Math.min(lastTime ? currentTime - lastTime : 16.67, MAX_DELTA_MS);
		lastTime = currentTime;

		const width = canvas.clientWidth;
		const height = canvas.clientHeight;

		const activeTypes = resolveAmbientTypes();
		// Joining and leaving land now, since an effect has to arrive on the tap that
		// added it; a density that is still moving waits until it stops.
		if (!membershipMatches(activeTypes)) syncMembership(activeTypes, width, height, currentTime);
		if (densityDrifted(activeTypes)) bakeSettledDensity(activeTypes, width, height, currentTime);
		else driftKey = '';

		// Clear canvas
		ctx.clearRect(0, 0, width, height);

		const activeSet = new Set(activeTypes);
		for (const ambientType of EFFECT_RENDER_ORDER) {
			if (!activeSet.has(ambientType)) continue;
			const def = EFFECTS[ambientType];
			const state = effectStates.get(ambientType);
			if (state === undefined) continue;

			const params = paramsFor(ambientType);
			def.update(state, width, height, params, deltaTime);
			def.render(ctx, state, width, height, params);
		}

		animationFrame = requestAnimationFrame(update);
	}

	function startAnimationLoop(): void {
		if (animationFrame !== null) return;
		animationFrame = requestAnimationFrame(update);
	}

	function stopAnimationLoop(): void {
		if (animationFrame !== null) {
			cancelAnimationFrame(animationFrame);
			animationFrame = null;
		}
		lastTime = 0;
	}

	onMount(() => {
		ctx = canvas.getContext('2d');
		if (!ctx) return;

		resize();
		startAnimationLoop();

		const resizeObserver = new ResizeObserver(resize);
		resizeObserver.observe(canvas);

		return () => {
			stopAnimationLoop();
			resizeObserver.disconnect();
		};
	});

	$effect(() => {
		if (paused) {
			stopAnimationLoop();
			return;
		}

		if (ctx) {
			startAnimationLoop();
		}
	});
</script>

<canvas
	bind:this={canvas}
	class="absolute inset-0 w-full h-full pointer-events-none {className}"
	aria-hidden="true"
></canvas>
