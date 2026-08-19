// Wisps ambient effect - pale spirits drifting with fading trails

import type { AmbientParams } from '$lib/types/ambient';
import { randomRange } from './particles';
import { createRadialSprite } from './dither';

/** Trail samples per wisp. Short on purpose: a long tail reads as a comet. */
const TRAIL_POINTS = 14;

/** Frames between trail samples. Denser sampling just draws the same curve twice. */
const TRAIL_INTERVAL = 2.5;

export interface Wisp {
	x: number;
	y: number;
	vx: number;
	vy: number;
	size: number;
	opacity: number;
	wanderPhase: number;
	wanderSpeed: number;
	pulsePhase: number;
	pulseSpeed: number;
	trailX: number[];
	trailY: number[];
	life: number;
	maxLife: number;
}

export interface WispsState {
	wisps: Wisp[];
	time: number;
	sampleTimer: number;
	glowSprite: HTMLCanvasElement | null;
}

const TAU = Math.PI * 2;

export function createWispsState(count: number, width: number, height: number): WispsState {
	const wisps: Wisp[] = [];
	for (let i = 0; i < count; i++) {
		wisps.push(createWisp(width, height, true));
	}

	return {
		wisps,
		time: 0,
		sampleTimer: 0,
		glowSprite: createRadialSprite(24, [
			{ t: 0, r: 226, g: 244, b: 250, a: 0.85 },
			{ t: 0.35, r: 168, g: 214, b: 232, a: 0.3 },
			{ t: 1, r: 140, g: 190, b: 216, a: 0 }
		])
	};
}

function createWisp(width: number, height: number, settled = false): Wisp {
	const x = settled ? randomRange(0, width) : randomRange(-40, width + 40);
	const y = settled ? randomRange(0, height) : randomRange(height * 0.3, height + 40);
	return {
		x,
		y,
		vx: randomRange(-0.35, 0.35),
		vy: randomRange(-0.42, -0.08),
		size: randomRange(2.2, 5.6),
		opacity: randomRange(0.28, 0.7),
		wanderPhase: randomRange(0, TAU),
		wanderSpeed: randomRange(0.012, 0.038),
		pulsePhase: randomRange(0, TAU),
		pulseSpeed: randomRange(0.02, 0.055),
		// Seeded at the spawn point so a new wisp has no trail whipping in from
		// wherever the last one died.
		trailX: new Array(TRAIL_POINTS).fill(x),
		trailY: new Array(TRAIL_POINTS).fill(y),
		life: 0,
		maxLife: randomRange(380, 820)
	};
}

export function updateWisps(
	state: WispsState,
	width: number,
	height: number,
	params: AmbientParams,
	deltaTime: number
): void {
	const dt = deltaTime / 16.67;
	state.time += dt;
	state.sampleTimer += dt;

	const sampling = state.sampleTimer >= TRAIL_INTERVAL;
	if (sampling) state.sampleTimer = 0;

	const movementScale = 0.55 + 0.5 * params.speed;

	for (const wisp of state.wisps) {
		wisp.life += dt;
		wisp.wanderPhase += wisp.wanderSpeed * dt * params.speed;
		wisp.pulsePhase += wisp.pulseSpeed * dt * params.speed;

		// Two out-of-phase sines: the drift curls instead of weaving evenly.
		const curlX = Math.sin(wisp.wanderPhase) * 0.42;
		const curlY = Math.cos(wisp.wanderPhase * 0.58) * 0.22;

		wisp.x += (wisp.vx + curlX) * dt * movementScale;
		wisp.y += (wisp.vy + curlY) * dt * movementScale;

		if (sampling) {
			wisp.trailX.shift();
			wisp.trailY.shift();
			wisp.trailX.push(wisp.x);
			wisp.trailY.push(wisp.y);
		}

		if (
			wisp.life >= wisp.maxLife ||
			wisp.x < -60 ||
			wisp.x > width + 60 ||
			wisp.y < -60 ||
			wisp.y > height + 60
		) {
			Object.assign(wisp, createWisp(width, height));
		}
	}
}

export function renderWisps(
	ctx: CanvasRenderingContext2D,
	state: WispsState,
	_width: number,
	_height: number,
	params: AmbientParams
): void {
	const vis = params.visibility;
	const trailsOn = params.settings.trails >= 0.5;
	if (!state.glowSprite) return;

	for (const wisp of state.wisps) {
		const lifeRatio = wisp.life / wisp.maxLife;
		const fade =
			lifeRatio < 0.1 ? lifeRatio / 0.1 : lifeRatio > 0.78 ? 1 - (lifeRatio - 0.78) / 0.22 : 1;
		const pulse = 0.65 + (Math.sin(wisp.pulsePhase) * 0.5 + 0.5) * 0.35;
		const alpha = wisp.opacity * fade * pulse * vis;
		if (alpha <= 0.01) continue;

		if (trailsOn) {
			// Oldest sample is faintest and smallest, so the tail tapers into nothing.
			for (let i = 0; i < TRAIL_POINTS; i++) {
				const t = i / (TRAIL_POINTS - 1);
				const tailAlpha = alpha * t * t * 0.4;
				if (tailAlpha <= 0.01) continue;
				const r = wisp.size * (0.3 + t * 0.9) * 2.4;
				ctx.globalAlpha = tailAlpha;
				ctx.drawImage(state.glowSprite, wisp.trailX[i] - r, wisp.trailY[i] - r, r * 2, r * 2);
			}
		}

		const head = wisp.size * 3.4;
		ctx.globalAlpha = alpha;
		ctx.drawImage(state.glowSprite, wisp.x - head, wisp.y - head, head * 2, head * 2);
	}
	ctx.globalAlpha = 1;
}
