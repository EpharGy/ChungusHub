// Rain ambient effect - optimized for performance

import type { AmbientParams } from '$lib/types/ambient';
import { randomRange, getRgbaStyle } from './particles';

export interface RainDrop {
	x: number;
	y: number;
	vy: number;
	length: number;
	opacity: number;
	width: number;
}

export interface RainSplash {
	x: number;
	y: number;
	frame: number;
	maxFrames: number;
	size: number;
	active: boolean;
}

export interface RainState {
	drops: RainDrop[];
	splashPool: RainSplash[];
	activeSplashCount: number;
}

const MAX_SPLASHES = 30;

export function createRainState(count: number, width: number, height: number): RainState {
	const drops: RainDrop[] = [];
	for (let i = 0; i < count; i++) {
		drops.push({
			x: randomRange(0, width),
			y: randomRange(-height, height),
			vy: randomRange(15, 25),
			length: randomRange(15, 30),
			opacity: randomRange(0.2, 0.5),
			width: randomRange(1, 2)
		});
	}

	// Pre-allocate splash pool
	const splashPool: RainSplash[] = [];
	for (let i = 0; i < MAX_SPLASHES; i++) {
		splashPool.push({
			x: 0,
			y: 0,
			frame: 0,
			maxFrames: 8,
			size: 3,
			active: false
		});
	}

	return { drops, splashPool, activeSplashCount: 0 };
}

function resetDrop(drop: RainDrop, width: number): void {
	drop.x = randomRange(0, width);
	drop.y = randomRange(-100, -10);
	drop.vy = randomRange(15, 25);
	drop.length = randomRange(15, 30);
	drop.opacity = randomRange(0.2, 0.5);
	drop.width = randomRange(1, 2);
}

function activateSplash(state: RainState, x: number, y: number, size: number): void {
	// Find an inactive splash in the pool
	for (let i = 0; i < MAX_SPLASHES; i++) {
		const splash = state.splashPool[i];
		if (!splash.active) {
			splash.x = x;
			splash.y = y;
			splash.frame = 0;
			splash.size = size;
			splash.active = true;
			state.activeSplashCount++;
			return;
		}
	}
}

export function updateRain(
	state: RainState,
	width: number,
	height: number,
	params: AmbientParams,
	deltaTime: number
): void {
	const dt = deltaTime / 16.67;
	const pace = 0.5 * params.speed;
	const dropSpeed = dt * pace;
	const splashesOn = params.settings.splashes >= 0.5;

	// Update drops
	for (let i = 0; i < state.drops.length; i++) {
		const drop = state.drops[i];
		drop.y += drop.vy * dropSpeed;

		if (drop.y > height) {
			// Activate a splash from pool
			if (splashesOn && state.activeSplashCount < MAX_SPLASHES) {
				activateSplash(state, drop.x, height - 5, drop.width * 3);
			}
			resetDrop(drop, width);
		}
	}

	// Update active splashes
	const splashSpeed = dt * pace;
	for (let i = 0; i < MAX_SPLASHES; i++) {
		const splash = state.splashPool[i];
		if (splash.active) {
			splash.frame += splashSpeed;
			if (splash.frame >= splash.maxFrames) {
				splash.active = false;
				state.activeSplashCount--;
			}
		}
	}
}

export function renderRain(
	ctx: CanvasRenderingContext2D,
	state: RainState,
	_width: number,
	_height: number,
	params: AmbientParams
): void {
	const vis = params.visibility;

	// Batch render drops by opacity buckets - cached styles
	ctx.lineCap = 'round';
	ctx.lineWidth = 1.5;

	const drops = state.drops;
	const len = drops.length;

	// Bucket 0: opacity < 0.3
	ctx.strokeStyle = getRgbaStyle(180, 200, 220, 0.25 * vis);
	ctx.beginPath();
	for (let i = 0; i < len; i++) {
		const drop = drops[i];
		if (drop.opacity < 0.3) {
			ctx.moveTo(drop.x, drop.y);
			ctx.lineTo(drop.x, drop.y + drop.length);
		}
	}
	ctx.stroke();

	// Bucket 1: 0.3 <= opacity < 0.4
	ctx.strokeStyle = getRgbaStyle(180, 200, 220, 0.35 * vis);
	ctx.beginPath();
	for (let i = 0; i < len; i++) {
		const drop = drops[i];
		if (drop.opacity >= 0.3 && drop.opacity < 0.4) {
			ctx.moveTo(drop.x, drop.y);
			ctx.lineTo(drop.x, drop.y + drop.length);
		}
	}
	ctx.stroke();

	// Bucket 2: opacity >= 0.4
	ctx.strokeStyle = getRgbaStyle(180, 200, 220, 0.45 * vis);
	ctx.beginPath();
	for (let i = 0; i < len; i++) {
		const drop = drops[i];
		if (drop.opacity >= 0.4) {
			ctx.moveTo(drop.x, drop.y);
			ctx.lineTo(drop.x, drop.y + drop.length);
		}
	}
	ctx.stroke();

	// Render active splashes - batched by progress ranges
	if (state.activeSplashCount > 0 && params.settings.splashes >= 0.5) {
		ctx.lineWidth = 1;
		const splashPool = state.splashPool;

		// Batch splashes into 3 progress buckets to reduce draw calls
		const progressMids = [0.17, 0.5, 0.83];

		for (let b = 0; b < 3; b++) {
			const bucketAlpha = (1 - progressMids[b]) * 0.4 * vis;
			ctx.strokeStyle = getRgbaStyle(180, 200, 220, bucketAlpha);
			ctx.beginPath();

			let hasContent = false;
			for (let i = 0; i < MAX_SPLASHES; i++) {
				const splash = splashPool[i];
				if (!splash.active) continue;

				const progress = splash.frame / splash.maxFrames;
				const bucket = progress < 0.33 ? 0 : progress < 0.66 ? 1 : 2;
				if (bucket !== b) continue;

				const radius = splash.size * (1 + progress * 2);
				ctx.moveTo(splash.x + radius, splash.y);
				ctx.arc(splash.x, splash.y, radius, 0, Math.PI, true);
				hasContent = true;
			}

			if (hasContent) ctx.stroke();
		}
	}
}
