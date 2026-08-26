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

	// The density a settling drag is heading for, when it last moved, whether it has
	// stopped, and whether a bake is already queued (NOT reactive).
	let driftKey = '';
	let driftSince = 0;
	let driftSettled = false;
	let bakeQueued = false;

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

	// How long a bake may be held for a frame that has better things to do before it is
	// forced through anyway.
	const BAKE_TIMEOUT_MS = 600;

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
	function hasDeparted(activeTypes: AmbientEffect[]): boolean {
		for (const existing of effectStates.keys()) {
			if (!activeTypes.includes(existing)) return true;
		}
		return false;
	}

	function densityDrifted(activeTypes: AmbientEffect[]): boolean {
		for (const type of activeTypes) {
			if (effectStates.has(type) && stateDensity.get(type) !== densityFor(type)) return true;
		}
		return false;
	}

	/** Leaving the mix costs nothing, so it happens the moment it is noticed. */
	function dropDeparted(activeTypes: AmbientEffect[]): void {
		const active = new Set<AmbientEffect>(activeTypes);
		for (const existing of [...effectStates.keys()]) {
			if (!active.has(existing)) {
				effectStates.delete(existing);
				stateDensity.delete(existing);
			}
		}
	}

	/** Whether the densities that have moved have stopped moving. Baking one mid-drag
	 *  would bake it again on the next pointer move, and the one before that was wasted. */
	function trackDensityDrift(activeTypes: AmbientEffect[], now: number): void {
		if (!densityDrifted(activeTypes)) {
			driftKey = '';
			driftSettled = false;
			return;
		}
		let key = '';
		for (const type of activeTypes) {
			if (!effectStates.has(type)) continue;
			const density = densityFor(type);
			if (stateDensity.get(type) !== density) key += `${type}@${density.toFixed(2)}|`;
		}
		if (key !== driftKey) {
			driftKey = key;
			driftSince = now;
			driftSettled = false;
			return;
		}
		driftSettled = now - driftSince >= DENSITY_SETTLE_MS;
	}

	/** The one effect owed a bake, or null. An effect that has JOINED comes first: it has
	 *  nothing on screen at all, while one whose density moved is still drawing. */
	function nextBake(activeTypes: AmbientEffect[]): AmbientEffect | null {
		for (const type of activeTypes) if (!effectStates.has(type)) return type;
		if (!driftSettled) return null;
		for (const type of activeTypes) {
			if (stateDensity.get(type) !== densityFor(type)) return type;
		}
		return null;
	}

	function whenIdle(run: () => void): void {
		if (typeof requestIdleCallback === 'function') {
			requestIdleCallback(run, { timeout: BAKE_TIMEOUT_MS });
		} else {
			// Safari before 16.4 has no idle callback. A timeout at least keeps the bake
			// out of the frame that noticed it was needed.
			setTimeout(run, 32);
		}
	}

	/**
	 * Bake one effect in the browser's own idle time, then queue the next.
	 *
	 * Baking is the expensive half by far and **nothing is waiting on it**: a texture that
	 * lands a moment late costs the reader nothing, while one baked inside a frame that
	 * had work to do costs them that frame. While a chat is opening the main thread is
	 * rendering a transcript and there IS no idle time, so a whole scene simply arrives
	 * once the chat is on screen instead of competing with it. One bake per callback, so
	 * two of them never share a frame.
	 */
	function queueBake(): void {
		if (bakeQueued) return;
		bakeQueued = true;
		whenIdle(() => {
			bakeQueued = false;
			if (!canvas) return;
			const activeTypes = resolveAmbientTypes();
			const type = nextBake(activeTypes);
			if (!type) return;
			bakeState(type, canvas.clientWidth, canvas.clientHeight);
			if (nextBake(activeTypes)) queueBake();
		});
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
		// The frame decides what is owed; the browser's idle time is where it gets paid.
		if (hasDeparted(activeTypes)) dropDeparted(activeTypes);
		trackDensityDrift(activeTypes, currentTime);
		if (nextBake(activeTypes)) queueBake();

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
