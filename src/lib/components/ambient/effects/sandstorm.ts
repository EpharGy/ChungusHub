// Sandstorm ambient effect - driven grit under a gusting dust haze

import type { AmbientParams } from '$lib/types/ambient';
import { randomRange, getRgbaStyle } from './particles';
import { createDitherCache, getDitheredLinearGradient, type DitherCache } from './dither';

export interface SandGrain {
	x: number;
	y: number;
	vx: number;
	vy: number;
	size: number;
	opacity: number;
	phase: number;
	phaseSpeed: number;
	life: number;
	maxLife: number;
}

export interface SandstormState {
	grains: SandGrain[];
	time: number;
	gustPhase: number;
	/** Current gust strength, 0.55-1.6. Drives both grain speed and haze weight. */
	gust: number;
	hazeCache: DitherCache;
}

export function createSandstormState(
	count: number,
	width: number,
	height: number
): SandstormState {
	const grains: SandGrain[] = [];
	for (let i = 0; i < count; i++) {
		grains.push(createGrain(width, height, true));
	}

	return {
		grains,
		time: 0,
		gustPhase: randomRange(0, Math.PI * 2),
		gust: 1,
		hazeCache: createDitherCache()
	};
}

function createGrain(width: number, height: number, randomX = false): SandGrain {
	return {
		x: randomX ? randomRange(0, width) : randomRange(-90, -10),
		y: randomRange(-20, height + 20),
		vx: randomRange(4.5, 12),
		vy: randomRange(-0.5, 1.1),
		size: randomRange(0.6, 1.9),
		opacity: randomRange(0.2, 0.62),
		phase: randomRange(0, Math.PI * 2),
		phaseSpeed: randomRange(0.03, 0.09),
		life: 0,
		maxLife: randomRange(150, 320)
	};
}

export function updateSandstorm(
	state: SandstormState,
	width: number,
	height: number,
	params: AmbientParams,
	deltaTime: number
): void {
	const dt = deltaTime / 16.67;
	state.time += dt;
	state.gustPhase += dt * 0.011 * params.speed;

	// Two detuned sines so the storm never settles into an audible-looking loop.
	state.gust =
		1.05 + Math.sin(state.gustPhase) * 0.32 + Math.sin(state.gustPhase * 2.7 + 1.1) * 0.18;

	const movementScale = (0.6 + 0.5 * params.speed) * state.gust;

	for (const grain of state.grains) {
		grain.life += dt;
		grain.phase += grain.phaseSpeed * dt * params.speed;

		const lift = Math.sin(grain.phase) * 0.45;
		grain.x += grain.vx * dt * movementScale;
		grain.y += (grain.vy + lift) * dt * movementScale;

		if (grain.y < -30) grain.y = height + 30;
		if (grain.y > height + 30) grain.y = -30;

		if (grain.x > width + 40 || grain.life >= grain.maxLife) {
			Object.assign(grain, createGrain(width, height));
		}
	}
}

export function renderSandstorm(
	ctx: CanvasRenderingContext2D,
	state: SandstormState,
	width: number,
	height: number,
	params: AmbientParams
): void {
	const vis = params.visibility;
	const haze = params.settings.haze;

	// Tan wash, weighted by the gust so the air visibly thickens and thins.
	if (haze > 0) {
		const weight = haze * vis * (0.72 + state.gust * 0.28);
		const dust = getDitheredLinearGradient(state.hazeCache, width, height, [
			{ t: 0, r: 196, g: 158, b: 104, a: 0.1 * weight },
			{ t: 0.55, r: 178, g: 141, b: 92, a: 0.15 * weight },
			{ t: 1, r: 150, g: 116, b: 74, a: 0.2 * weight }
		]);
		if (dust) ctx.drawImage(dust, 0, 0, width, height);
	}

	// Grains streak along their own velocity, so a gust stretches them without
	// any extra state. Saved because the stack renders effects back to back on
	// one context: a stroke style left behind here would repaint the next one.
	ctx.save();
	ctx.lineCap = 'round';
	for (const grain of state.grains) {
		const lifeRatio = grain.life / grain.maxLife;
		const fade = lifeRatio > 0.8 ? 1 - (lifeRatio - 0.8) / 0.2 : 1;
		const alpha = grain.opacity * fade * vis;
		if (alpha <= 0.01) continue;

		const trail = grain.vx * state.gust * 1.6;
		ctx.beginPath();
		ctx.moveTo(grain.x, grain.y);
		ctx.lineTo(grain.x - trail, grain.y - grain.vy * 1.6);
		ctx.strokeStyle = getRgbaStyle(226, 197, 149, alpha);
		ctx.lineWidth = grain.size;
		ctx.stroke();
	}
	ctx.restore();
}
