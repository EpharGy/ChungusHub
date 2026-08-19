// Sunshine ambient effect - god rays and floating dust

import type { AmbientParams } from '$lib/types/ambient';
import { randomRange } from './particles';
import {
	createDitherCache,
	createRadialSprite,
	getDitheredRadialGradient,
	type DitherCache
} from './dither';

export interface DustMote {
	x: number;
	y: number;
	size: number;
	opacity: number;
	driftX: number;
	driftY: number;
	phase: number;
	phaseSpeed: number;
	shimmerPhase: number;
	shimmerSpeed: number;
}

export interface GodRay {
	x: number;
	width: number;
	opacity: number;
	angle: number;
}

export interface SunshineState {
	motes: DustMote[];
	rays: GodRay[];
	time: number;
	warmthPulse: number;
	warmCache: DitherCache;
	rayCache: DitherCache;
	moteSprite: HTMLCanvasElement | null;
}

// Warm overlay and rays pulse via globalAlpha (0.7-1), so bake extra dither
// amplitude to survive the scale-down (see dither.ts).
const PULSE_DITHER_AMPLITUDE = 1.8;

export function createSunshineState(count: number, width: number, height: number): SunshineState {
	const motes: DustMote[] = [];
	for (let i = 0; i < count; i++) {
		motes.push(createDustMote(width, height));
	}

	// Create god rays from top-right
	const rays: GodRay[] = [];
	const rayCount = 3;
	for (let i = 0; i < rayCount; i++) {
		rays.push({
			x: width * 0.6 + (i * width * 0.15),
			width: randomRange(80, 150),
			opacity: randomRange(0.03, 0.06),
			angle: randomRange(-0.3, -0.1)
		});
	}

	return {
		motes,
		rays,
		time: 0,
		warmthPulse: 0,
		warmCache: createDitherCache(),
		rayCache: createDitherCache(),
		moteSprite: createRadialSprite(16, [
			{ t: 0, r: 255, g: 240, b: 200, a: 1 },
			{ t: 0.5, r: 255, g: 220, b: 150, a: 0.5 },
			{ t: 1, r: 255, g: 220, b: 150, a: 0 }
		])
	};
}

function createDustMote(width: number, height: number): DustMote {
	return {
		x: randomRange(0, width),
		y: randomRange(0, height),
		size: randomRange(1, 3),
		opacity: randomRange(0.2, 0.5),
		driftX: randomRange(-0.2, 0.2),
		driftY: randomRange(-0.3, 0.1),
		phase: randomRange(0, Math.PI * 2),
		phaseSpeed: randomRange(0.01, 0.03),
		shimmerPhase: randomRange(0, Math.PI * 2),
		shimmerSpeed: randomRange(0.05, 0.1)
	};
}

export function updateSunshine(
	state: SunshineState,
	width: number,
	height: number,
	params: AmbientParams,
	deltaTime: number
): void {
	const dt = deltaTime / 16.67;
	const pace = 0.5 * params.speed;
	state.time += dt * 0.01 * params.speed;
	state.warmthPulse = Math.sin(state.time * 0.5) * 0.5 + 0.5;

	for (const mote of state.motes) {
		mote.phase += mote.phaseSpeed * dt * params.speed;
		mote.shimmerPhase += mote.shimmerSpeed * dt * params.speed;

		// Gentle floating motion
		const floatX = Math.sin(mote.phase) * 0.5;
		const floatY = Math.cos(mote.phase * 0.7) * 0.3;

		mote.x += (mote.driftX + floatX) * dt * pace;
		mote.y += (mote.driftY + floatY) * dt * pace;

		// Wrap around
		if (mote.x < -10) mote.x = width + 10;
		if (mote.x > width + 10) mote.x = -10;
		if (mote.y < -10) mote.y = height + 10;
		if (mote.y > height + 10) mote.y = -10;
	}
}

/**
 * Bake the three static god rays into one dithered full-screen buffer. Each ray
 * is a rotated strip with a soft horizontal alpha profile - drawing those as
 * canvas gradients at 0.03-0.06 alpha is a textbook banding source.
 */
function getRayBuffer(
	state: SunshineState,
	width: number,
	height: number,
	alphaScale: number
): HTMLCanvasElement | null {
	if (typeof document === 'undefined') return null;

	const w = Math.max(1, Math.floor(width));
	const h = Math.max(1, Math.floor(height));
	const key = `rays${w}x${h}a${alphaScale.toFixed(4)}`;
	const cache = state.rayCache;
	if (cache.canvas && cache.key === key) return cache.canvas;

	const canvas = cache.canvas ?? document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;
	cache.canvas = canvas;
	cache.key = key;

	// Precompute per-ray transforms
	const rays = state.rays.map((ray) => ({
		px: ray.x,
		cos: Math.cos(ray.angle),
		sin: Math.sin(ray.angle),
		halfWidth: ray.width / 2,
		alpha: ray.opacity * alphaScale
	}));

	const img = ctx.createImageData(w, h);
	const d = img.data;

	let i = 0;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			// Accumulate ray contributions in straight alpha
			let outA = 0;
			let outR = 0;
			let outG = 0;
			let outB = 0;
			for (const ray of rays) {
				const dx = x - ray.px;
				// Local x across the ray strip (rotation inverse, y component only
				// matters for the strip axis, which spans the whole screen)
				const lx = ray.cos * dx + ray.sin * y;
				const t = lx / (ray.halfWidth * 2) + 0.5;
				if (t <= 0 || t >= 1) continue;

				// Profile: 0 -> o at 0.3 -> 1.2o at 0.5 -> o at 0.7 -> 0
				let profile: number;
				if (t < 0.3) profile = t / 0.3;
				else if (t < 0.5) profile = 1 + ((t - 0.3) / 0.2) * 0.2;
				else if (t < 0.7) profile = 1.2 - ((t - 0.5) / 0.2) * 0.2;
				else profile = (1 - t) / 0.3;

				const a = ray.alpha * profile;
				if (a <= 0) continue;

				// Center of the strip is slightly brighter/creamier
				const mid = 1 - Math.abs(t - 0.5) * 2;
				const r = 255;
				const g = 220 + 10 * mid;
				const b = 150 + 30 * mid;

				// over-composite onto accumulated color
				const na = a + outA * (1 - a);
				if (na > 0) {
					outR = (r * a + outR * outA * (1 - a)) / na;
					outG = (g * a + outG * outA * (1 - a)) / na;
					outB = (b * a + outB * outA * (1 - a)) / na;
					outA = na;
				}
			}

			const n = (Math.random() - Math.random()) * PULSE_DITHER_AMPLITUDE;
			d[i] = outR + n;
			d[i + 1] = outG + n;
			d[i + 2] = outB + n;
			d[i + 3] = outA * 255 + n;
			i += 4;
		}
	}

	ctx.putImageData(img, 0, 0);
	return canvas;
}

export function renderSunshine(
	ctx: CanvasRenderingContext2D,
	state: SunshineState,
	width: number,
	height: number,
	params: AmbientParams
): void {
	const vis = params.visibility;
	const pulse = 0.7 + state.warmthPulse * 0.3;

	// Warm overlay gradient from top-right - dithered, pulsed via globalAlpha
	const warm = getDitheredRadialGradient(
		state.warmCache,
		width,
		height,
		width * 0.9,
		height * -0.1,
		width * 0.8,
		[
			{ t: 0, r: 255, g: 200, b: 100, a: 0.08 * vis },
			{ t: 0.5, r: 255, g: 180, b: 80, a: 0.04 * vis },
			{ t: 1, r: 255, g: 180, b: 80, a: 0 }
		],
		PULSE_DITHER_AMPLITUDE
	);
	if (warm) {
		ctx.globalAlpha = pulse;
		ctx.drawImage(warm, 0, 0, width, height);
		ctx.globalAlpha = 1;
	}

	// God rays
	const raySetting = params.settings.rays;
	if (raySetting > 0.05) {
		const rayBuffer = getRayBuffer(state, width, height, vis * raySetting);
		if (rayBuffer) {
			ctx.globalAlpha = pulse;
			ctx.drawImage(rayBuffer, 0, 0, width, height);
			ctx.globalAlpha = 1;
		}
	}

	// Dust motes
	if (state.moteSprite) {
		for (const mote of state.motes) {
			const shimmer = Math.sin(mote.shimmerPhase) * 0.5 + 0.5;
			ctx.globalAlpha = mote.opacity * vis * (0.5 + shimmer * 0.5);
			ctx.drawImage(
				state.moteSprite,
				mote.x - mote.size * 2,
				mote.y - mote.size * 2,
				mote.size * 4,
				mote.size * 4
			);
		}
		ctx.globalAlpha = 1;
	}
}
