// Fog ambient effect - layered drifting sheets inspired by CSS fog overlays

import type { AmbientParams } from '$lib/types/ambient';
import { randomRange, getRgbaStyle } from './particles';
import { createDitherCache, getDitheredLinearGradient, type DitherCache } from './dither';

interface FogOpacityKeyframe {
	t: number; // 0-1
	alpha: number;
}

interface FogLayerPreset {
	moveDurationMs: number;
	opacityDurationMs: number;
	alphaScale: number;
	heightScale: number;
	yBase: number;
	yDrift: number;
	ySpeed: number;
	textureDensity: number;
	keyframes: FogOpacityKeyframe[];
}

export interface FogLayer {
	texture: HTMLCanvasElement | null;
	scrollX: number;
	opacityTime: number;
	phase: number;
	preset: FogLayerPreset;
}

export interface FogState {
	layers: FogLayer[];
	time: number;
	hazeCache: DitherCache;
}

const TAU = Math.PI * 2;

const LAYER_PRESETS: FogLayerPreset[] = [
	{
		// Matches sample: opacity cycle ~10s, movement ~15s
		moveDurationMs: 15000,
		opacityDurationMs: 10000,
		alphaScale: 0.52,
		heightScale: 1.04,
		yBase: -0.02,
		yDrift: 12,
		ySpeed: 0.16,
		textureDensity: 1,
		keyframes: [
			{ t: 0, alpha: 0.1 },
			{ t: 0.22, alpha: 0.5 },
			{ t: 0.4, alpha: 0.28 },
			{ t: 0.58, alpha: 0.4 },
			{ t: 0.8, alpha: 0.16 },
			{ t: 1, alpha: 0.1 }
		]
	},
	{
		// Matches sample: opacity cycle ~21s, movement ~13s
		moveDurationMs: 13000,
		opacityDurationMs: 21000,
		alphaScale: 0.45,
		heightScale: 1.07,
		yBase: -0.01,
		yDrift: 16,
		ySpeed: 0.11,
		textureDensity: 1.15,
		keyframes: [
			{ t: 0, alpha: 0.5 },
			{ t: 0.25, alpha: 0.2 },
			{ t: 0.5, alpha: 0.1 },
			{ t: 0.8, alpha: 0.3 },
			{ t: 1, alpha: 0.5 }
		]
	},
	{
		moveDurationMs: 13000,
		opacityDurationMs: 17000,
		alphaScale: 0.4,
		heightScale: 1.1,
		yBase: 0,
		yDrift: 20,
		ySpeed: 0.09,
		textureDensity: 1.25,
		keyframes: [
			{ t: 0, alpha: 0.8 },
			{ t: 0.27, alpha: 0.2 },
			{ t: 0.52, alpha: 0.6 },
			{ t: 0.68, alpha: 0.3 },
			{ t: 1, alpha: 0.8 }
		]
	}
];

export function createFogState(count: number, width: number, height: number): FogState {
	const densityScale = Math.max(0.7, Math.min(1.7, count / 95));
	const layers: FogLayer[] = [];

	for (let i = 0; i < LAYER_PRESETS.length; i++) {
		const preset = LAYER_PRESETS[i];
		layers.push({
			texture: createFogTexture(width, height, preset.textureDensity * densityScale),
			scrollX: randomRange(-width, 0),
			opacityTime: randomRange(0, preset.opacityDurationMs),
			phase: randomRange(0, TAU),
			preset
		});
	}

	return {
		layers,
		time: 0,
		hazeCache: createDitherCache()
	};
}

export function updateFog(
	state: FogState,
	width: number,
	_height: number,
	params: AmbientParams,
	deltaTime: number
): void {
	state.time += deltaTime * 0.0001 * params.speed;
	const speedScale = 0.105 * params.speed;

	for (const layer of state.layers) {
		const move = (deltaTime / layer.preset.moveDurationMs) * width * speedScale;
		layer.scrollX -= move;
		if (layer.scrollX <= -width) {
			layer.scrollX += width;
		}

		layer.opacityTime += deltaTime;
		if (layer.opacityTime > layer.preset.opacityDurationMs) {
			layer.opacityTime %= layer.preset.opacityDurationMs;
		}
	}
}

export function renderFog(
	ctx: CanvasRenderingContext2D,
	state: FogState,
	width: number,
	height: number,
	params: AmbientParams
): void {
	const vis = params.visibility;

	// Global atmospheric tint - dithered to avoid banding.
	const haze = getDitheredLinearGradient(state.hazeCache, width, height, [
		{ t: 0, r: 205, g: 213, b: 224, a: 0.05 * vis },
		{ t: 0.55, r: 182, g: 191, b: 204, a: 0.08 * vis },
		{ t: 1, r: 163, g: 171, b: 183, a: 0.13 * vis }
	]);
	if (haze) ctx.drawImage(haze, 0, 0, width, height);

	const layerIntensity = 0.35 + vis * 0.95;

	for (const layer of state.layers) {
		if (!layer.texture) continue;

		const opacityProgress = layer.opacityTime / layer.preset.opacityDurationMs;
		const keyOpacity = sampleOpacity(layer.preset.keyframes, opacityProgress);
		const alpha = keyOpacity * layer.preset.alphaScale * layerIntensity;
		if (alpha <= 0.01) continue;

		const y =
			height * layer.preset.yBase +
			Math.sin(state.time * layer.preset.ySpeed + layer.phase) * layer.preset.yDrift;
		const drawHeight = height * layer.preset.heightScale;

		ctx.globalAlpha = Math.min(1, alpha);

		// Two copies side-by-side, same behavior as 200% width fog strips.
		// The blur/color-grade is baked into the texture at creation - running
		// ctx.filter here every frame forced a software raster path and was the
		// reason fog burned CPU.
		ctx.drawImage(layer.texture, layer.scrollX, y, width, drawHeight);
		ctx.drawImage(layer.texture, layer.scrollX + width, y, width, drawHeight);
	}
	ctx.globalAlpha = 1;
}

function sampleOpacity(keyframes: FogOpacityKeyframe[], t: number): number {
	const last = keyframes[keyframes.length - 1];
	if (t >= last.t) return last.alpha;

	for (let i = 0; i < keyframes.length - 1; i++) {
		const a = keyframes[i];
		const b = keyframes[i + 1];
		if (t >= a.t && t <= b.t) {
			const range = b.t - a.t;
			if (range <= 0) return b.alpha;
			const local = (t - a.t) / range;
			return a.alpha + (b.alpha - a.alpha) * local;
		}
	}

	return keyframes[0].alpha;
}

function createFogTexture(
	width: number,
	height: number,
	density: number
): HTMLCanvasElement | null {
	if (typeof document === 'undefined') return null;

	const texture = document.createElement('canvas');
	const tw = Math.max(640, Math.round(width));
	const th = Math.max(220, Math.round(height * 0.7));
	texture.width = tw;
	texture.height = th;

	const tctx = texture.getContext('2d');
	if (!tctx) return null;

	tctx.clearRect(0, 0, tw, th);

	// Base coverage.
	const base = tctx.createLinearGradient(0, 0, 0, th);
	base.addColorStop(0, getRgbaStyle(230, 236, 245, 0));
	base.addColorStop(0.35, getRgbaStyle(228, 234, 243, 0.15));
	base.addColorStop(0.75, getRgbaStyle(220, 228, 238, 0.22));
	base.addColorStop(1, getRgbaStyle(214, 222, 234, 0.08));
	tctx.fillStyle = base;
	tctx.fillRect(0, 0, tw, th);

	const bigBlobs = Math.floor(34 * density);
	const medBlobs = Math.floor(50 * density);
	const smallBlobs = Math.floor(42 * density);

	for (let i = 0; i < bigBlobs; i++) {
		const x = randomRange(0, tw);
		const y = randomRange(th * 0.12, th * 0.9);
		drawWrappedBlob(
			tctx,
			tw,
			x,
			y,
			randomRange(85, 180),
			randomRange(46, 98),
			230,
			236,
			245,
			randomRange(0.06, 0.18)
		);
	}

	for (let i = 0; i < medBlobs; i++) {
		const x = randomRange(0, tw);
		const y = randomRange(th * 0.06, th * 0.95);
		drawWrappedBlob(
			tctx,
			tw,
			x,
			y,
			randomRange(48, 112),
			randomRange(28, 66),
			223,
			230,
			241,
			randomRange(0.04, 0.14)
		);
	}

	for (let i = 0; i < smallBlobs; i++) {
		const x = randomRange(0, tw);
		const y = randomRange(th * 0.03, th);
		drawWrappedBlob(
			tctx,
			tw,
			x,
			y,
			randomRange(20, 52),
			randomRange(12, 32),
			214,
			224,
			236,
			randomRange(0.03, 0.1)
		);
	}

	// Vertical falloff so top/bottom are softer like PNG fog assets.
	tctx.globalCompositeOperation = 'destination-in';
	const mask = tctx.createLinearGradient(0, 0, 0, th);
	mask.addColorStop(0, getRgbaStyle(255, 255, 255, 0.2));
	mask.addColorStop(0.15, getRgbaStyle(255, 255, 255, 0.95));
	mask.addColorStop(0.85, getRgbaStyle(255, 255, 255, 0.92));
	mask.addColorStop(1, getRgbaStyle(255, 255, 255, 0.25));
	tctx.fillStyle = mask;
	tctx.fillRect(0, 0, tw, th);
	tctx.globalCompositeOperation = 'source-over';

	// Bake the blur/color-grade once. Doing this per frame with ctx.filter is
	// what made fog melt CPUs; a one-time pass looks the same and is free at
	// render time. If the browser lacks ctx.filter, the raw texture is already
	// gradient-soft, so it degrades fine.
	const graded = document.createElement('canvas');
	graded.width = tw;
	graded.height = th;
	const gctx = graded.getContext('2d');
	if (!gctx) return texture;
	gctx.filter = 'blur(2px) grayscale(0.2) saturate(1.2) sepia(0.2)';
	gctx.drawImage(texture, 0, 0);
	return graded;
}

function drawWrappedBlob(
	ctx: CanvasRenderingContext2D,
	wrapWidth: number,
	x: number,
	y: number,
	radiusX: number,
	radiusY: number,
	r: number,
	g: number,
	b: number,
	alpha: number
): void {
	drawBlob(ctx, x, y, radiusX, radiusY, r, g, b, alpha);
	drawBlob(ctx, x - wrapWidth, y, radiusX, radiusY, r, g, b, alpha);
	drawBlob(ctx, x + wrapWidth, y, radiusX, radiusY, r, g, b, alpha);
}

function drawBlob(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	radiusX: number,
	radiusY: number,
	r: number,
	g: number,
	b: number,
	alpha: number
): void {
	ctx.save();
	ctx.translate(x, y);
	ctx.scale(radiusX, radiusY);

	const gradient = ctx.createRadialGradient(0, 0, 0.08, 0, 0, 1);
	gradient.addColorStop(0, getRgbaStyle(r, g, b, alpha));
	gradient.addColorStop(0.58, getRgbaStyle(r - 8, g - 8, b - 8, alpha * 0.48));
	gradient.addColorStop(1, getRgbaStyle(r - 8, g - 8, b - 8, 0));

	ctx.beginPath();
	ctx.arc(0, 0, 1, 0, TAU);
	ctx.fillStyle = gradient;
	ctx.fill();
	ctx.restore();
}
