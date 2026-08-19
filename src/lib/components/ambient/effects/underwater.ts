// Underwater ambient effect - caustic light waves with bubbles and plankton

import type { AmbientParams } from '$lib/types/ambient';
import { randomRange, getRgbaStyle } from './particles';
import { createDitherCache, getDitheredLinearGradient, type DitherCache } from './dither';

export interface Bubble {
	x: number;
	y: number;
	vx: number;
	vy: number;
	size: number;
	opacity: number;
	wobble: number;
	wobbleSpeed: number;
}

export interface Plankton {
	x: number;
	y: number;
	size: number;
	opacity: number;
	phase: number;
	phaseSpeed: number;
}

export interface UnderwaterState {
	bubbles: Bubble[];
	plankton: Plankton[];
	waterCache: DitherCache;
}

export function createUnderwaterState(
	count: number,
	width: number,
	height: number
): UnderwaterState {
	const bubbles: Bubble[] = [];
	const bubbleCount = Math.max(4, Math.floor(count * 0.45));
	for (let i = 0; i < bubbleCount; i++) {
		bubbles.push(createBubble(width, height, true));
	}

	const plankton: Plankton[] = [];
	const planktonCount = Math.max(6, Math.floor(count * 0.7));
	for (let i = 0; i < planktonCount; i++) {
		plankton.push(createPlankton(width, height, true));
	}

	return {
		bubbles,
		plankton,
		waterCache: createDitherCache()
	};
}

function createBubble(width: number, height: number, randomY = false): Bubble {
	return {
		x: randomRange(0, width),
		y: randomY ? randomRange(0, height + 20) : randomRange(height + 10, height + 60),
		vx: randomRange(-0.2, 0.2),
		vy: randomRange(-1.9, -0.7),
		size: randomRange(2, 9),
		opacity: randomRange(0.22, 0.65),
		wobble: randomRange(0, Math.PI * 2),
		wobbleSpeed: randomRange(0.01, 0.04)
	};
}

function createPlankton(width: number, height: number, randomY = false): Plankton {
	return {
		x: randomRange(0, width),
		y: randomY ? randomRange(0, height) : randomRange(-15, -5),
		size: randomRange(0.8, 2.6),
		opacity: randomRange(0.18, 0.55),
		phase: randomRange(0, Math.PI * 2),
		phaseSpeed: randomRange(0.01, 0.05)
	};
}

export function updateUnderwater(
	state: UnderwaterState,
	width: number,
	height: number,
	params: AmbientParams,
	deltaTime: number
): void {
	const dt = deltaTime / 16.67;
	const pace = 0.5 * params.speed;

	for (const bubble of state.bubbles) {
		bubble.wobble += bubble.wobbleSpeed * dt * params.speed;
		bubble.x += (bubble.vx + Math.sin(bubble.wobble) * 0.28) * dt * (0.6 + pace * 0.8);
		bubble.y += bubble.vy * dt * (0.65 + pace * 0.85);

		if (bubble.y < -bubble.size - 25 || bubble.x < -30 || bubble.x > width + 30) {
			Object.assign(bubble, createBubble(width, height));
		}
	}

	for (const mote of state.plankton) {
		mote.phase += mote.phaseSpeed * dt * params.speed;
		mote.x += Math.sin(mote.phase) * 0.15 * dt * (0.4 + pace * 0.8);
		mote.y += (0.14 + Math.cos(mote.phase * 0.7) * 0.08) * dt * params.speed;

		if (mote.y > height + 10) {
			Object.assign(mote, createPlankton(width, height));
		}
		if (mote.x < -12) mote.x = width + 12;
		if (mote.x > width + 12) mote.x = -12;
	}
}

export function renderUnderwater(
	ctx: CanvasRenderingContext2D,
	state: UnderwaterState,
	width: number,
	height: number,
	params: AmbientParams
): void {
	const vis = params.visibility;

	const water = getDitheredLinearGradient(state.waterCache, width, height, [
		{ t: 0, r: 36, g: 88, b: 136, a: 0.15 * vis },
		{ t: 0.55, r: 20, g: 72, b: 120, a: 0.12 * vis },
		{ t: 1, r: 10, g: 46, b: 86, a: 0.22 * vis }
	]);
	if (water) ctx.drawImage(water, 0, 0, width, height);

	for (const bubble of state.bubbles) {
		const alpha = bubble.opacity * vis;
		if (alpha <= 0.01) continue;

		ctx.beginPath();
		ctx.arc(bubble.x, bubble.y, bubble.size, 0, Math.PI * 2);
		ctx.strokeStyle = getRgbaStyle(195, 230, 255, alpha);
		ctx.lineWidth = 1;
		ctx.stroke();

		ctx.beginPath();
		ctx.arc(
			bubble.x - bubble.size * 0.35,
			bubble.y - bubble.size * 0.35,
			bubble.size * 0.28,
			0,
			Math.PI * 2
		);
		ctx.fillStyle = getRgbaStyle(220, 245, 255, alpha * 0.8);
		ctx.fill();
	}

	for (const mote of state.plankton) {
		const alpha = mote.opacity * vis;
		if (alpha <= 0.01) continue;
		ctx.fillStyle = getRgbaStyle(180, 220, 240, alpha);
		ctx.fillRect(mote.x, mote.y, mote.size, mote.size);
	}
}
