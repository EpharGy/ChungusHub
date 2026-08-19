// Snow ambient effect

import type { AmbientParams } from '$lib/types/ambient';
import { randomRange } from './particles';
import { createRadialSprite } from './dither';

export interface SnowFlake {
	x: number;
	y: number;
	vx: number;
	vy: number;
	size: number;
	opacity: number;
	wobble: number;
	wobbleSpeed: number;
	wobbleAmount: number;
}

export interface SnowState {
	flakes: SnowFlake[];
	time: number;
	sprite: HTMLCanvasElement | null;
}

// One shared flake sprite instead of a radial gradient per flake per frame.
const SPRITE_RADIUS = 16;

export function createSnowState(count: number, width: number, height: number): SnowState {
	const flakes: SnowFlake[] = [];
	for (let i = 0; i < count; i++) {
		flakes.push(createSnowFlake(width, height, true));
	}
	return {
		flakes,
		time: 0,
		sprite: createRadialSprite(SPRITE_RADIUS, [
			{ t: 0, r: 255, g: 255, b: 255, a: 1 },
			{ t: 0.5, r: 240, g: 245, b: 255, a: 0.5 },
			{ t: 1, r: 255, g: 255, b: 255, a: 0 }
		])
	};
}

function createSnowFlake(width: number, height: number, randomY = false): SnowFlake {
	return {
		x: randomRange(0, width),
		y: randomY ? randomRange(-height * 0.5, height) : randomRange(-50, -10),
		vx: randomRange(-0.5, 0.5),
		vy: randomRange(1, 3),
		size: randomRange(2, 5),
		opacity: randomRange(0.4, 0.9),
		wobble: randomRange(0, Math.PI * 2),
		wobbleSpeed: randomRange(0.02, 0.05),
		wobbleAmount: randomRange(0.5, 1.5)
	};
}

export function updateSnow(
	state: SnowState,
	width: number,
	height: number,
	params: AmbientParams,
	deltaTime: number
): void {
	const dt = deltaTime / 16.67;
	const pace = 0.5 * params.speed;
	state.time += dt * 0.01;

	// Global wind effect
	const windX = Math.sin(state.time * 0.5) * 0.3;

	for (const flake of state.flakes) {
		// Wobble motion
		flake.wobble += flake.wobbleSpeed * dt;
		const wobbleOffset = Math.sin(flake.wobble) * flake.wobbleAmount;

		flake.x += (flake.vx + wobbleOffset + windX) * dt * pace;
		flake.y += flake.vy * dt * pace;

		// Wrap horizontally
		if (flake.x < -10) flake.x = width + 10;
		if (flake.x > width + 10) flake.x = -10;

		// Reset when off screen
		if (flake.y > height + 10) {
			Object.assign(flake, createSnowFlake(width, height, false));
		}
	}
}

export function renderSnow(
	ctx: CanvasRenderingContext2D,
	state: SnowState,
	_width: number,
	_height: number,
	params: AmbientParams
): void {
	if (!state.sprite) return;
	const vis = params.visibility;

	for (const flake of state.flakes) {
		ctx.globalAlpha = flake.opacity * vis;
		ctx.drawImage(
			state.sprite,
			flake.x - flake.size,
			flake.y - flake.size,
			flake.size * 2,
			flake.size * 2
		);
	}
	ctx.globalAlpha = 1;
}
