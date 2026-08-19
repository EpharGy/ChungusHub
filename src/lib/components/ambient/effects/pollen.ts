// Pollen ambient effect - golden forest motes hanging in still air

import type { AmbientParams } from '$lib/types/ambient';
import { randomRange, getRgbaStyle } from './particles';
import { createDitherCache, createRadialSprite, getDitheredLinearGradient, type DitherCache } from './dither';

export interface PollenMote {
	x: number;
	y: number;
	vx: number;
	vy: number;
	size: number;
	opacity: number;
	driftPhase: number;
	driftSpeed: number;
	driftRadius: number;
	life: number;
	maxLife: number;
}

export interface PollenState {
	motes: PollenMote[];
	time: number;
	breathPhase: number;
	tintCache: DitherCache;
	glowSprite: HTMLCanvasElement | null;
}

export function createPollenState(count: number, width: number, height: number): PollenState {
	const motes: PollenMote[] = [];
	for (let i = 0; i < count; i++) {
		motes.push(createMote(width, height, true));
	}

	return {
		motes,
		time: 0,
		breathPhase: randomRange(0, Math.PI * 2),
		tintCache: createDitherCache(),
		glowSprite: createRadialSprite(14, [
			{ t: 0, r: 255, g: 244, b: 196, a: 0.9 },
			{ t: 0.5, r: 236, g: 216, b: 138, a: 0.3 },
			{ t: 1, r: 226, g: 208, b: 130, a: 0 }
		])
	};
}

function createMote(width: number, height: number, randomY = false): PollenMote {
	return {
		x: randomRange(-20, width + 20),
		y: randomY ? randomRange(0, height) : randomRange(height * 0.75, height + 40),
		// Barely negative: pollen hangs rather than falls, which is the whole
		// difference between this and dust or ash.
		vx: randomRange(-0.14, 0.14),
		vy: randomRange(-0.16, 0.05),
		size: randomRange(0.9, 2.6),
		opacity: randomRange(0.3, 0.85),
		driftPhase: randomRange(0, Math.PI * 2),
		driftSpeed: randomRange(0.006, 0.022),
		driftRadius: randomRange(8, 30),
		life: 0,
		maxLife: randomRange(400, 900)
	};
}

export function updatePollen(
	state: PollenState,
	width: number,
	height: number,
	params: AmbientParams,
	deltaTime: number
): void {
	const dt = deltaTime / 16.67;
	state.time += dt;
	state.breathPhase += dt * 0.004 * params.speed;

	// One slow breath moves the whole cloud, so the motes read as air rather
	// than as unrelated dots.
	const breathX = Math.sin(state.breathPhase) * 0.12;
	const movementScale = 0.55 + 0.5 * params.speed;

	for (const mote of state.motes) {
		mote.life += dt;
		mote.driftPhase += mote.driftSpeed * dt * params.speed;

		const swirlX = Math.sin(mote.driftPhase) * mote.driftRadius * 0.018;
		const swirlY = Math.cos(mote.driftPhase * 0.63) * mote.driftRadius * 0.012;

		mote.x += (mote.vx + swirlX + breathX) * dt * movementScale;
		mote.y += (mote.vy + swirlY) * dt * movementScale;

		if (mote.x < -30) mote.x = width + 30;
		if (mote.x > width + 30) mote.x = -30;

		if (mote.y < -40 || mote.life >= mote.maxLife) {
			Object.assign(mote, createMote(width, height));
		}
	}
}

export function renderPollen(
	ctx: CanvasRenderingContext2D,
	state: PollenState,
	width: number,
	height: number,
	params: AmbientParams
): void {
	const vis = params.visibility;

	const tint = getDitheredLinearGradient(state.tintCache, width, height, [
		{ t: 0, r: 198, g: 200, b: 138, a: 0.05 * vis },
		{ t: 0.6, r: 176, g: 186, b: 122, a: 0.07 * vis },
		{ t: 1, r: 138, g: 156, b: 100, a: 0.1 * vis }
	]);
	if (tint) ctx.drawImage(tint, 0, 0, width, height);

	for (const mote of state.motes) {
		const lifeRatio = mote.life / mote.maxLife;
		// Fade in as well as out: a mote appearing at full strength pops.
		const fade =
			lifeRatio < 0.12 ? lifeRatio / 0.12 : lifeRatio > 0.8 ? 1 - (lifeRatio - 0.8) / 0.2 : 1;
		const alpha = mote.opacity * fade * vis;
		if (alpha <= 0.01) continue;

		if (state.glowSprite) {
			const glow = mote.size * 4.5;
			ctx.globalAlpha = alpha * 0.6;
			ctx.drawImage(state.glowSprite, mote.x - glow, mote.y - glow, glow * 2, glow * 2);
			ctx.globalAlpha = 1;
		}

		ctx.beginPath();
		ctx.arc(mote.x, mote.y, mote.size, 0, Math.PI * 2);
		ctx.fillStyle = getRgbaStyle(255, 240, 186, Math.min(1, alpha));
		ctx.fill();
	}
}
