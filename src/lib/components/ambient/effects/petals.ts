// Petals ambient effect - soft drifting blossom petals

import type { AmbientParams } from '$lib/types/ambient';
import { randomRange, getRgbaStyle } from './particles';
import { createDitherCache, getDitheredLinearGradient, type DitherCache } from './dither';

export interface Petal {
	x: number;
	y: number;
	vx: number;
	vy: number;
	size: number;
	rotation: number;
	rotationSpeed: number;
	swayPhase: number;
	swaySpeed: number;
	opacity: number;
	layer: 0 | 1 | 2;
	tint: number;
}

export interface PetalsState {
	petals: Petal[];
	time: number;
	wind: number;
	blushCache: DitherCache;
}

const LAYER_SPEED = [0.55, 1, 1.25];

export function createPetalsState(count: number, width: number, height: number): PetalsState {
	const petals: Petal[] = [];
	for (let i = 0; i < count; i++) {
		petals.push(createPetal(width, height, true));
	}

	return {
		petals,
		time: 0,
		wind: 0,
		blushCache: createDitherCache()
	};
}

function createPetal(width: number, height: number, randomY = false): Petal {
	const layer = (Math.random() < 0.35 ? 0 : Math.random() < 0.72 ? 1 : 2) as 0 | 1 | 2;
	return {
		x: randomRange(-40, width + 40),
		y: randomY ? randomRange(-height * 0.2, height + 20) : randomRange(-25, -8),
		vx: randomRange(0.1, 0.85),
		vy: randomRange(0.45, 1.5),
		size: randomRange(3.5, 9) * (0.8 + layer * 0.22),
		rotation: randomRange(0, Math.PI * 2),
		rotationSpeed: randomRange(-0.06, 0.06),
		swayPhase: randomRange(0, Math.PI * 2),
		swaySpeed: randomRange(0.012, 0.045),
		opacity: randomRange(0.38, 0.86),
		layer,
		tint: randomRange(-10, 10)
	};
}

export function updatePetals(
	state: PetalsState,
	width: number,
	height: number,
	params: AmbientParams,
	deltaTime: number
): void {
	const dt = deltaTime / 16.67;
	const pace = 0.5 * params.speed;
	state.time += dt * 0.01 * params.speed;
	state.wind = Math.sin(state.time * 0.9) * 0.55 + Math.sin(state.time * 2.1) * 0.22;

	for (const petal of state.petals) {
		petal.swayPhase += petal.swaySpeed * dt * params.speed;
		petal.rotation += petal.rotationSpeed * dt * params.speed;

		const layerSpeed = LAYER_SPEED[petal.layer];
		const sway = Math.sin(petal.swayPhase) * 0.7;
		petal.x += (petal.vx + state.wind + sway) * dt * (0.5 + pace * 1.05) * layerSpeed;
		petal.y += petal.vy * dt * (0.5 + pace * 0.85) * layerSpeed;

		if (petal.x < -120 || petal.x > width + 120 || petal.y > height + 90) {
			Object.assign(petal, createPetal(width, height));
		}
	}
}

export function renderPetals(
	ctx: CanvasRenderingContext2D,
	state: PetalsState,
	width: number,
	height: number,
	params: AmbientParams
): void {
	const vis = params.visibility;

	const blush = getDitheredLinearGradient(state.blushCache, width, height, [
		{ t: 0, r: 255, g: 215, b: 225, a: 0.02 * vis },
		{ t: 1, r: 255, g: 200, b: 215, a: 0.05 * vis }
	]);
	if (blush) ctx.drawImage(blush, 0, 0, width, height);

	for (const petal of state.petals) {
		const alpha = petal.opacity * vis;
		if (alpha <= 0.02) continue;

		const lightness = 72 + petal.layer * 8 + petal.tint * 0.15;
		const color = `hsla(${Math.round(340 + petal.tint)}, 72%, ${lightness.toFixed(1)}%, ${alpha.toFixed(3)})`;

		ctx.save();
		ctx.translate(petal.x, petal.y);
		ctx.rotate(petal.rotation);

		// Two-lobed petal silhouette.
		ctx.beginPath();
		ctx.moveTo(0, -petal.size);
		ctx.bezierCurveTo(
			petal.size * 0.85, -petal.size * 0.75,
			petal.size * 0.95, petal.size * 0.35,
			0, petal.size
		);
		ctx.bezierCurveTo(
			-petal.size * 0.95, petal.size * 0.35,
			-petal.size * 0.85, -petal.size * 0.75,
			0, -petal.size
		);
		ctx.fillStyle = color;
		ctx.fill();

		ctx.beginPath();
		ctx.moveTo(0, -petal.size * 0.8);
		ctx.lineTo(0, petal.size * 0.75);
		ctx.strokeStyle = getRgbaStyle(255, 240, 245, alpha * 0.45);
		ctx.lineWidth = 0.6;
		ctx.stroke();

		ctx.restore();
	}
}
