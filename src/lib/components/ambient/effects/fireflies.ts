// Fireflies ambient effect - living points of light for night scenes

import type { AmbientParams } from '$lib/types/ambient';
import { randomRange, getRgbaStyle } from './particles';
import {
	createDitherCache,
	createRadialSprite,
	getDitheredLinearGradient,
	type DitherCache
} from './dither';

export interface Firefly {
	x: number;
	y: number;
	vx: number;
	vy: number;
	size: number;
	opacity: number;
	pulsePhase: number;
	pulseSpeed: number;
	wanderPhase: number;
	wanderSpeed: number;
	orbitRadius: number;
	life: number;
	maxLife: number;
}

export interface FirefliesState {
	fireflies: Firefly[];
	time: number;
	swarmPhase: number;
	canopyCache: DitherCache;
	glowSprite: HTMLCanvasElement | null;
}

export function createFirefliesState(
	count: number,
	width: number,
	height: number
): FirefliesState {
	const fireflies: Firefly[] = [];
	for (let i = 0; i < count; i++) {
		fireflies.push(createFirefly(width, height, true));
	}

	return {
		fireflies,
		time: 0,
		swarmPhase: 0,
		canopyCache: createDitherCache(),
		glowSprite: createRadialSprite(16, [
			{ t: 0, r: 255, g: 248, b: 170, a: 1 },
			{ t: 0.45, r: 220, g: 255, b: 170, a: 0.45 },
			{ t: 1, r: 220, g: 255, b: 170, a: 0 }
		])
	};
}

function createFirefly(width: number, height: number, randomY = false): Firefly {
	return {
		x: randomRange(0, width),
		y: randomY ? randomRange(height * 0.1, height * 0.95) : randomRange(height * 0.2, height * 0.9),
		vx: randomRange(-0.2, 0.2),
		vy: randomRange(-0.15, 0.1),
		size: randomRange(1.2, 2.8),
		opacity: randomRange(0.35, 0.8),
		pulsePhase: randomRange(0, Math.PI * 2),
		pulseSpeed: randomRange(0.04, 0.13),
		wanderPhase: randomRange(0, Math.PI * 2),
		wanderSpeed: randomRange(0.01, 0.05),
		orbitRadius: randomRange(6, 22),
		life: 0,
		maxLife: randomRange(260, 520)
	};
}

export function updateFireflies(
	state: FirefliesState,
	width: number,
	height: number,
	params: AmbientParams,
	deltaTime: number
): void {
	const dt = deltaTime / 16.67;
	state.time += dt;
	state.swarmPhase += dt * 0.006 * params.speed;

	const swarmDriftX = Math.sin(state.swarmPhase) * 0.18;
	const swarmDriftY = Math.cos(state.swarmPhase * 0.8) * 0.08;
	const movementScale = 0.65 + 0.5 * params.speed * 0.95;

	for (const firefly of state.fireflies) {
		firefly.life += dt;
		firefly.pulsePhase += firefly.pulseSpeed * dt * params.speed;
		firefly.wanderPhase += firefly.wanderSpeed * dt * params.speed;

		const orbitX = Math.sin(firefly.wanderPhase) * firefly.orbitRadius * 0.03;
		const orbitY = Math.cos(firefly.wanderPhase * 0.7) * firefly.orbitRadius * 0.02;

		firefly.x += (firefly.vx + orbitX + swarmDriftX) * dt * movementScale;
		firefly.y += (firefly.vy + orbitY + swarmDriftY) * dt * movementScale;

		if (
			firefly.life >= firefly.maxLife ||
			firefly.x < -30 ||
			firefly.x > width + 30 ||
			firefly.y < -30 ||
			firefly.y > height + 30
		) {
			Object.assign(firefly, createFirefly(width, height));
		}
	}
}

export function renderFireflies(
	ctx: CanvasRenderingContext2D,
	state: FirefliesState,
	width: number,
	height: number,
	params: AmbientParams
): void {
	const vis = params.visibility;

	const canopy = getDitheredLinearGradient(state.canopyCache, width, height, [
		{ t: 0, r: 18, g: 28, b: 38, a: 0.05 * vis },
		{ t: 1, r: 8, g: 14, b: 24, a: 0.1 * vis }
	]);
	if (canopy) ctx.drawImage(canopy, 0, 0, width, height);

	for (const firefly of state.fireflies) {
		const pulse = Math.sin(firefly.pulsePhase) * 0.5 + 0.5;
		const fireflyOpacity = firefly.opacity * (0.25 + pulse * 0.75) * vis;
		if (fireflyOpacity <= 0.01) continue;

		if (state.glowSprite) {
			const glowRadius = firefly.size * (3.5 + pulse * 2.5);
			ctx.globalAlpha = fireflyOpacity;
			ctx.drawImage(
				state.glowSprite,
				firefly.x - glowRadius,
				firefly.y - glowRadius,
				glowRadius * 2,
				glowRadius * 2
			);
			ctx.globalAlpha = 1;
		}

		ctx.beginPath();
		ctx.arc(firefly.x, firefly.y, firefly.size, 0, Math.PI * 2);
		ctx.fillStyle = getRgbaStyle(255, 255, 210, Math.min(1, fireflyOpacity * 1.2));
		ctx.fill();
	}
}
