// Lanterns ambient effect - paper lanterns climbing with warm light

import type { AmbientParams } from '$lib/types/ambient';
import { randomRange } from './particles';
import { createRadialSprite } from './dither';

export interface Lantern {
	x: number;
	y: number;
	width: number;
	height: number;
	speed: number;
	opacity: number;
	swayPhase: number;
	swaySpeed: number;
	swayAmount: number;
	flickerPhase: number;
	flickerSpeed: number;
}

export interface LanternsState {
	lanterns: Lantern[];
	time: number;
	bodySprite: HTMLCanvasElement | null;
	glowSprite: HTMLCanvasElement | null;
}

const TAU = Math.PI * 2;

export function createLanternsState(
	count: number,
	width: number,
	height: number
): LanternsState {
	const lanterns: Lantern[] = [];
	for (let i = 0; i < count; i++) {
		lanterns.push(createLantern(width, height, true));
	}

	// Sorted far to near, so the small distant ones never draw over a close one.
	lanterns.sort((a, b) => a.width - b.width);

	return {
		lanterns,
		time: 0,
		bodySprite: createBodySprite(),
		glowSprite: createRadialSprite(48, [
			{ t: 0, r: 255, g: 196, b: 118, a: 0.55 },
			{ t: 0.4, r: 255, g: 158, b: 78, a: 0.2 },
			{ t: 1, r: 255, g: 140, b: 60, a: 0 }
		])
	};
}

function createLantern(width: number, height: number, settled = false): Lantern {
	// Size is the only depth cue: smaller means further, so it rises slower and
	// sits dimmer.
	const w = randomRange(7, 21);
	return {
		x: randomRange(-20, width + 20),
		y: settled ? randomRange(-height * 0.1, height) : randomRange(height + 20, height * 1.4),
		width: w,
		height: w * randomRange(1.15, 1.4),
		speed: randomRange(0.16, 0.52) * (w / 14),
		opacity: randomRange(0.5, 1) * (0.55 + (w / 21) * 0.45),
		swayPhase: randomRange(0, TAU),
		swaySpeed: randomRange(0.008, 0.024),
		swayAmount: randomRange(6, 20),
		flickerPhase: randomRange(0, TAU),
		flickerSpeed: randomRange(0.03, 0.09)
	};
}

export function updateLanterns(
	state: LanternsState,
	width: number,
	height: number,
	params: AmbientParams,
	deltaTime: number
): void {
	const dt = deltaTime / 16.67;
	state.time += dt;

	const movementScale = 0.6 + 0.5 * params.speed;

	for (const lantern of state.lanterns) {
		lantern.swayPhase += lantern.swaySpeed * dt * params.speed;
		lantern.flickerPhase += lantern.flickerSpeed * dt * params.speed;

		lantern.y -= lantern.speed * dt * movementScale;
		lantern.x += Math.sin(lantern.swayPhase) * lantern.swayAmount * 0.004 * dt * movementScale;

		if (lantern.y < -lantern.height * 3) {
			const respawned = createLantern(width, height);
			// Keep the depth this slot was sorted into, or the draw order breaks.
			respawned.width = lantern.width;
			respawned.height = lantern.height;
			respawned.speed = lantern.speed;
			respawned.opacity = lantern.opacity;
			Object.assign(lantern, respawned);
		}
	}
}

export function renderLanterns(
	ctx: CanvasRenderingContext2D,
	state: LanternsState,
	_width: number,
	_height: number,
	params: AmbientParams
): void {
	const vis = params.visibility;

	for (const lantern of state.lanterns) {
		const flicker = 0.88 + Math.sin(lantern.flickerPhase) * 0.12;
		const alpha = lantern.opacity * flicker * vis;
		if (alpha <= 0.01) continue;

		if (state.glowSprite) {
			const glow = lantern.width * 2.6;
			ctx.globalAlpha = alpha * 0.75;
			ctx.drawImage(state.glowSprite, lantern.x - glow, lantern.y - glow, glow * 2, glow * 2);
		}

		if (state.bodySprite) {
			ctx.globalAlpha = alpha;
			ctx.drawImage(
				state.bodySprite,
				lantern.x - lantern.width / 2,
				lantern.y - lantern.height / 2,
				lantern.width,
				lantern.height
			);
		}
		ctx.globalAlpha = 1;
	}
}

/**
 * One paper body, baked once and scaled per lantern: the shape is identical for
 * all of them, so a per-frame gradient per lantern would buy nothing.
 */
function createBodySprite(): HTMLCanvasElement | null {
	if (typeof document === 'undefined') return null;

	const w = 64;
	const h = 80;
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;

	// A barrel that narrows at both ends, drawn with curves rather than
	// roundRect so the taper is asymmetric: wider at the belly, tight at the top.
	ctx.beginPath();
	ctx.moveTo(w * 0.28, h * 0.06);
	ctx.bezierCurveTo(w * 0.02, h * 0.3, w * 0.02, h * 0.72, w * 0.24, h * 0.94);
	ctx.lineTo(w * 0.76, h * 0.94);
	ctx.bezierCurveTo(w * 0.98, h * 0.72, w * 0.98, h * 0.3, w * 0.72, h * 0.06);
	ctx.closePath();

	// Lit from inside and below, where the flame sits.
	const paper = ctx.createLinearGradient(0, 0, 0, h);
	paper.addColorStop(0, 'rgba(255,214,152,0.72)');
	paper.addColorStop(0.45, 'rgba(255,186,104,0.92)');
	paper.addColorStop(0.82, 'rgba(255,150,66,1)');
	paper.addColorStop(1, 'rgba(238,116,48,0.85)');
	ctx.fillStyle = paper;
	ctx.fill();

	// The flame itself, a hot core near the base.
	const core = ctx.createRadialGradient(w * 0.5, h * 0.78, 0, w * 0.5, h * 0.78, w * 0.34);
	core.addColorStop(0, 'rgba(255,246,214,0.95)');
	core.addColorStop(1, 'rgba(255,214,152,0)');
	ctx.fillStyle = core;
	ctx.fill();

	return canvas;
}
