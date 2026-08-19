// Leaves ambient effect - swirling autumn leaves with layered depth

import type { AmbientParams } from '$lib/types/ambient';
import { randomRange, getRgbaStyle } from './particles';
import { createDitherCache, getDitheredLinearGradient, type DitherCache } from './dither';

export interface Leaf {
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
	hue: number;
	layer: 0 | 1 | 2;
}

export interface LeavesState {
	leaves: Leaf[];
	time: number;
	wind: number;
	atmosphereCache: DitherCache;
}

const LAYER_SPEED = [0.55, 1, 1.35];
const LAYER_OPACITY = [0.55, 0.78, 1];

export function createLeavesState(count: number, width: number, height: number): LeavesState {
	const leaves: Leaf[] = [];
	for (let i = 0; i < count; i++) {
		leaves.push(createLeaf(width, height, true));
	}

	return {
		leaves,
		time: 0,
		wind: 0,
		atmosphereCache: createDitherCache()
	};
}

function createLeaf(width: number, height: number, randomY = false): Leaf {
	const layer = (Math.random() < 0.34 ? 0 : Math.random() < 0.7 ? 1 : 2) as 0 | 1 | 2;
	const size = randomRange(3.5, 9.5) * (0.8 + layer * 0.2);
	const warm = Math.random();
	const hue =
		warm < 0.33 ? randomRange(18, 34) :
		warm < 0.66 ? randomRange(34, 48) :
		randomRange(6, 16);

	return {
		x: randomRange(-40, width + 40),
		y: randomY ? randomRange(-height * 0.2, height + 20) : randomRange(-25, -5),
		vx: randomRange(-0.4, 0.9),
		vy: randomRange(0.55, 1.8),
		size,
		rotation: randomRange(0, Math.PI * 2),
		rotationSpeed: randomRange(-0.08, 0.08),
		swayPhase: randomRange(0, Math.PI * 2),
		swaySpeed: randomRange(0.015, 0.05),
		opacity: randomRange(0.42, 0.92),
		hue,
		layer
	};
}

export function updateLeaves(
	state: LeavesState,
	width: number,
	height: number,
	params: AmbientParams,
	deltaTime: number
): void {
	const dt = deltaTime / 16.67;
	const pace = 0.5 * params.speed;
	state.time += dt * 0.01 * params.speed;
	state.wind = Math.sin(state.time * 1.25) * 0.8 + Math.sin(state.time * 2.8) * 0.35;

	const windStrength = 0.35 + pace * 1.3;

	for (const leaf of state.leaves) {
		leaf.swayPhase += leaf.swaySpeed * dt * params.speed;
		leaf.rotation += leaf.rotationSpeed * dt * params.speed;

		const layerSpeed = LAYER_SPEED[leaf.layer];
		const sway = Math.sin(leaf.swayPhase) * (0.7 + leaf.layer * 0.25);
		const driftX = (leaf.vx + state.wind * 0.32 + sway) * dt * windStrength * layerSpeed;
		const driftY = leaf.vy * dt * (0.6 + pace * 0.9) * layerSpeed;

		leaf.x += driftX;
		leaf.y += driftY;

		if (leaf.x < -120 || leaf.x > width + 120 || leaf.y > height + 80) {
			Object.assign(leaf, createLeaf(width, height));
		}
	}
}

export function renderLeaves(
	ctx: CanvasRenderingContext2D,
	state: LeavesState,
	width: number,
	height: number,
	params: AmbientParams
): void {
	const vis = params.visibility;

	const atmosphere = getDitheredLinearGradient(state.atmosphereCache, width, height, [
		{ t: 0, r: 130, g: 100, b: 70, a: 0.02 * vis },
		{ t: 1, r: 95, g: 70, b: 50, a: 0.07 * vis }
	]);
	if (atmosphere) ctx.drawImage(atmosphere, 0, 0, width, height);

	for (const leaf of state.leaves) {
		const layerOpacity = LAYER_OPACITY[leaf.layer];
		const alpha = leaf.opacity * layerOpacity * vis;
		if (alpha <= 0.02) continue;

		ctx.save();
		ctx.translate(leaf.x, leaf.y);
		ctx.rotate(leaf.rotation);

		// Leaf body (simple pointed ellipse shape)
		ctx.beginPath();
		ctx.moveTo(0, -leaf.size);
		ctx.quadraticCurveTo(leaf.size * 0.9, -leaf.size * 0.15, 0, leaf.size);
		ctx.quadraticCurveTo(-leaf.size * 0.9, -leaf.size * 0.15, 0, -leaf.size);

		ctx.fillStyle = `hsla(${Math.round(leaf.hue)}, 78%, ${48 + leaf.layer * 7}%, ${alpha.toFixed(3)})`;
		ctx.fill();

		// Midrib
		ctx.beginPath();
		ctx.moveTo(0, -leaf.size * 0.8);
		ctx.lineTo(0, leaf.size * 0.8);
		ctx.strokeStyle = getRgbaStyle(120, 85, 55, alpha * 0.45);
		ctx.lineWidth = 0.7;
		ctx.stroke();

		ctx.restore();
	}
}
