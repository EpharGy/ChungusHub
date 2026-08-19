// Fireplace ambient effect - embers and warm flickering glow

import type { AmbientParams } from '$lib/types/ambient';
import { randomRange } from './particles';
import {
	createDitherCache,
	createRadialSprite,
	getDitheredLinearGradient,
	type DitherCache
} from './dither';

export interface Ember {
	x: number;
	y: number;
	vx: number;
	vy: number;
	size: number;
	opacity: number;
	life: number;
	maxLife: number;
	hue: number; // 15-40 for orange to red
	spriteIndex: number; // nearest EMBER_HUES bucket
	flickerPhase: number;
	flickerSpeed: number;
	// Physics
	swayPhase: number;
	swaySpeed: number;
	swayAmplitude: number;
	drag: number;
	heat: number; // Initial upward boost
}

export interface FireplaceState {
	embers: Ember[];
	time: number;
	glowPhase: number;
	glowIntensity: number;
	warmCache: DitherCache;
	emberSprites: (HTMLCanvasElement | null)[];
}

// Glow sprites are bucketed by hue so the render loop is drawImage-only
// instead of building a radial gradient per ember per frame.
const EMBER_HUES = [15, 25, 35, 44];

// Warm tint flickers via globalAlpha (glowIntensity / GLOW_MAX), so the baked
// dither needs extra amplitude to survive the scale-down (see dither.ts).
const GLOW_MAX = 0.7;
const GLOW_DITHER_AMPLITUDE = 2.5;

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const hp = h / 60;
	const x = c * (1 - Math.abs((hp % 2) - 1));
	let r = 0, g = 0, b = 0;
	if (hp < 1) [r, g, b] = [c, x, 0];
	else if (hp < 2) [r, g, b] = [x, c, 0];
	else if (hp < 3) [r, g, b] = [0, c, x];
	else if (hp < 4) [r, g, b] = [0, x, c];
	else if (hp < 5) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];
	const m = l - c / 2;
	return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function createEmberSprite(hue: number): HTMLCanvasElement | null {
	const [r0, g0, b0] = hslToRgb(hue, 1, 0.6);
	const [r1, g1, b1] = hslToRgb(hue, 1, 0.5);
	const [r2, g2, b2] = hslToRgb(Math.max(0, hue - 5), 1, 0.4);
	return createRadialSprite(16, [
		{ t: 0, r: r0, g: g0, b: b0, a: 1 },
		{ t: 0.3, r: r1, g: g1, b: b1, a: 0.5 },
		{ t: 0.6, r: r2, g: g2, b: b2, a: 0.2 },
		{ t: 1, r: r2, g: g2, b: b2, a: 0 }
	]);
}

export function createFireplaceState(count: number, width: number, height: number): FireplaceState {
	const embers: Ember[] = [];
	for (let i = 0; i < count; i++) {
		embers.push(createEmber(width, height));
	}

	return {
		embers,
		time: 0,
		glowPhase: 0,
		glowIntensity: 0.5,
		warmCache: createDitherCache(),
		emberSprites: EMBER_HUES.map(createEmberSprite)
	};
}

function nearestHueIndex(hue: number): number {
	let best = 0;
	let bestDist = Infinity;
	for (let i = 0; i < EMBER_HUES.length; i++) {
		const dist = Math.abs(EMBER_HUES[i] - hue);
		if (dist < bestDist) {
			bestDist = dist;
			best = i;
		}
	}
	return best;
}

function createEmber(width: number, height: number): Ember {
	// Embers rise from bottom area
	const side = Math.random() > 0.5;
	const startX = side ? randomRange(width * 0.7, width + 30) : randomRange(-30, width * 0.3);
	const size = randomRange(1.5, 4);
	const hue = randomRange(12, 45);

	return {
		x: startX,
		y: randomRange(height * 0.75, height + 30),
		vx: randomRange(-0.4, 0.4),
		vy: randomRange(-2.5, -1.0),
		size,
		opacity: randomRange(0.6, 1),
		life: 0,
		maxLife: randomRange(150, 300),
		hue,
		spriteIndex: nearestHueIndex(hue),
		flickerPhase: randomRange(0, Math.PI * 2),
		flickerSpeed: randomRange(0.08, 0.18),
		// Physics - smaller embers are more affected by air
		swayPhase: randomRange(0, Math.PI * 2),
		swaySpeed: randomRange(0.02, 0.05),
		swayAmplitude: randomRange(0.8, 2.0) * (4 / size), // Smaller = more sway
		drag: randomRange(0.985, 0.995),
		heat: randomRange(0.3, 0.8) // Initial boost strength
	};
}

export function updateFireplace(
	state: FireplaceState,
	width: number,
	height: number,
	params: AmbientParams,
	deltaTime: number
): void {
	const dt = deltaTime / 16.67;
	const pace = 0.5 * params.speed;
	state.time += dt * 0.01;

	// Glow flickering
	state.glowPhase += dt * 0.05 * params.speed;
	state.glowIntensity = 0.4 + Math.sin(state.glowPhase) * 0.15 +
		Math.sin(state.glowPhase * 2.3) * 0.1 +
		Math.sin(state.glowPhase * 4.7) * 0.05;

	for (const ember of state.embers) {
		ember.flickerPhase += ember.flickerSpeed * dt * params.speed;
		ember.swayPhase += ember.swaySpeed * dt * params.speed;
		ember.life += dt * params.speed;

		const lifeRatio = ember.life / ember.maxLife;

		// Heat boost early in life (thermal updraft), then drag takes over
		const heatBoost = ember.heat * Math.max(0, 1 - lifeRatio * 3);
		ember.vy -= heatBoost * 0.02 * dt;

		// Apply drag (air resistance) - slows down over time
		ember.vx *= Math.pow(ember.drag, dt);
		ember.vy *= Math.pow(ember.drag, dt);

		// Multi-frequency sway for organic movement
		const sway1 = Math.sin(ember.swayPhase) * ember.swayAmplitude;
		const sway2 = Math.sin(ember.swayPhase * 2.3 + 1.5) * ember.swayAmplitude * 0.4;
		const sway3 = Math.sin(ember.swayPhase * 0.7 + 3.0) * ember.swayAmplitude * 0.6;
		const totalSway = (sway1 + sway2 + sway3) * (1 - lifeRatio * 0.5);

		// Random turbulence - occasional small kicks
		const turbulenceX = (Math.random() - 0.5) * 0.15 * (1 / ember.size);
		const turbulenceY = (Math.random() - 0.5) * 0.08;

		// Apply movement
		ember.x += (ember.vx + totalSway + turbulenceX) * dt * pace;
		ember.y += (ember.vy + turbulenceY) * dt * pace;

		// Fade out - quick fade at end of life
		const fadeStart = 0.6;
		const fadeFactor = lifeRatio > fadeStart
			? 1 - ((lifeRatio - fadeStart) / (1 - fadeStart))
			: 1;
		const flicker = 0.75 + Math.sin(ember.flickerPhase) * 0.25;
		ember.opacity = fadeFactor * flicker;

		// Reset when dead or off screen
		if (ember.life >= ember.maxLife || ember.y < -30 || ember.opacity < 0.02) {
			Object.assign(ember, createEmber(width, height));
		}
	}
}

export function renderFireplace(
	ctx: CanvasRenderingContext2D,
	state: FireplaceState,
	width: number,
	height: number,
	params: AmbientParams
): void {
	const vis = params.visibility;
	const glowSetting = params.settings.glow;

	// Subtle warm tint - dithered buffer baked at max glow, flickered via
	// globalAlpha
	if (glowSetting > 0.05) {
		const maxGlow = GLOW_MAX * vis * glowSetting;
		const warm = getDitheredLinearGradient(
			state.warmCache,
			width,
			height,
			[
				{ t: 0, r: 255, g: 140, b: 60, a: 0.01 * maxGlow },
				{ t: 0.5, r: 255, g: 120, b: 50, a: 0.02 * maxGlow },
				{ t: 1, r: 255, g: 100, b: 40, a: 0.035 * maxGlow }
			],
			GLOW_DITHER_AMPLITUDE
		);
		if (warm) {
			ctx.globalAlpha = Math.max(0, Math.min(1, state.glowIntensity / GLOW_MAX));
			ctx.drawImage(warm, 0, 0, width, height);
			ctx.globalAlpha = 1;
		}
	}

	// Render embers
	for (const ember of state.embers) {
		const flickerBrightness = 0.7 + Math.sin(ember.flickerPhase) * 0.3;
		const emberOpacity = ember.opacity * vis * flickerBrightness;
		if (emberOpacity <= 0.01) continue;

		// Ember glow (pre-rendered sprite per hue bucket)
		const sprite = state.emberSprites[ember.spriteIndex];
		if (sprite) {
			const glowSize = ember.size * 4;
			ctx.globalAlpha = emberOpacity;
			ctx.drawImage(
				sprite,
				ember.x - glowSize,
				ember.y - glowSize,
				glowSize * 2,
				glowSize * 2
			);
			ctx.globalAlpha = 1;
		}

		// Ember core
		ctx.beginPath();
		ctx.arc(ember.x, ember.y, ember.size, 0, Math.PI * 2);
		ctx.fillStyle = `hsla(${Math.round(ember.hue + 10)}, 100%, 70%, ${emberOpacity.toFixed(3)})`;
		ctx.fill();
	}
}
