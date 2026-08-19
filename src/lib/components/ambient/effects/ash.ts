// Ash ambient effect - drifting soot with occasional hot embers

import type { AmbientParams } from '$lib/types/ambient';
import { randomRange, getRgbaStyle } from './particles';
import {
	createDitherCache,
	createRadialSprite,
	getDitheredLinearGradient,
	type DitherCache
} from './dither';

export interface AshParticle {
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
	hot: boolean;
}

export interface AshState {
	particles: AshParticle[];
	time: number;
	windPhase: number;
	smokeCache: DitherCache;
	hotSprite: HTMLCanvasElement | null;
}

export function createAshState(count: number, width: number, height: number): AshState {
	const particles: AshParticle[] = [];
	for (let i = 0; i < count; i++) {
		particles.push(createAshParticle(width, height, true));
	}

	return {
		particles,
		time: 0,
		windPhase: 0,
		smokeCache: createDitherCache(),
		hotSprite: createRadialSprite(16, [
			{ t: 0, r: 255, g: 190, b: 120, a: 1 },
			{ t: 0.45, r: 255, g: 125, b: 70, a: 0.45 },
			{ t: 1, r: 255, g: 100, b: 55, a: 0 }
		])
	};
}

function createAshParticle(width: number, height: number, randomY = false): AshParticle {
	return {
		x: randomRange(-20, width + 20),
		y: randomY ? randomRange(-height * 0.2, height + 10) : randomRange(-40, -5),
		vx: randomRange(-0.35, 0.35),
		vy: randomRange(0.8, 2.3),
		size: randomRange(1, 3.2),
		opacity: randomRange(0.25, 0.75),
		phase: randomRange(0, Math.PI * 2),
		phaseSpeed: randomRange(0.01, 0.04),
		life: 0,
		maxLife: randomRange(220, 480),
		hot: Math.random() < 0.14
	};
}

export function updateAsh(
	state: AshState,
	width: number,
	height: number,
	params: AmbientParams,
	deltaTime: number
): void {
	const dt = deltaTime / 16.67;
	state.time += dt;
	state.windPhase += dt * 0.01 * params.speed;

	const wind = Math.sin(state.windPhase) * 0.6;
	const movementScale = 0.6 + 0.5 * params.speed * 1.1;

	for (const particle of state.particles) {
		particle.life += dt;
		particle.phase += particle.phaseSpeed * dt * params.speed;

		const swirl = Math.sin(particle.phase) * 0.5;
		particle.x += (particle.vx + swirl + wind) * dt * movementScale;
		particle.y += particle.vy * dt * movementScale;

		if (particle.x < -30) particle.x = width + 30;
		if (particle.x > width + 30) particle.x = -30;

		if (particle.y > height + 30 || particle.life >= particle.maxLife) {
			Object.assign(particle, createAshParticle(width, height));
		}
	}
}

export function renderAsh(
	ctx: CanvasRenderingContext2D,
	state: AshState,
	width: number,
	height: number,
	params: AmbientParams
): void {
	const vis = params.visibility;

	const smokeLayer = getDitheredLinearGradient(state.smokeCache, width, height, [
		{ t: 0, r: 50, g: 54, b: 60, a: 0.04 * vis },
		{ t: 0.6, r: 60, g: 56, b: 52, a: 0.07 * vis },
		{ t: 1, r: 90, g: 64, b: 38, a: 0.12 * vis }
	]);
	if (smokeLayer) ctx.drawImage(smokeLayer, 0, 0, width, height);

	for (const particle of state.particles) {
		const lifeRatio = particle.life / particle.maxLife;
		const fade = lifeRatio > 0.72 ? 1 - (lifeRatio - 0.72) / 0.28 : 1;
		const alpha = particle.opacity * fade * vis;
		if (alpha <= 0.01) continue;

		if (particle.hot && state.hotSprite) {
			ctx.globalAlpha = alpha;
			ctx.drawImage(
				state.hotSprite,
				particle.x - particle.size * 4,
				particle.y - particle.size * 4,
				particle.size * 8,
				particle.size * 8
			);
			ctx.globalAlpha = 1;
		}

		ctx.beginPath();
		ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
		ctx.fillStyle = particle.hot
			? getRgbaStyle(255, 185, 125, Math.min(1, alpha * 1.05))
			: getRgbaStyle(190, 184, 176, alpha);
		ctx.fill();
	}
}
