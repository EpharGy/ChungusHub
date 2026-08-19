// Aurora ambient effect - slow curtains of northern light across the sky

import type { AmbientParams } from '$lib/types/ambient';
import { randomRange, getRgbaStyle } from './particles';

interface CurtainPreset {
	/** Vertical anchor as a fraction of canvas height. */
	yBase: number;
	heightScale: number;
	scrollSpeed: number;
	driftSpeed: number;
	drift: number;
	alphaBase: number;
	pulseSpeed: number;
	r: number;
	g: number;
	b: number;
}

export interface AuroraCurtain {
	texture: HTMLCanvasElement | null;
	scrollX: number;
	phase: number;
	preset: CurtainPreset;
}

export interface AuroraState {
	curtains: AuroraCurtain[];
	time: number;
}

const TAU = Math.PI * 2;

// Three curtains, back to front: a wide green sheet, a taller teal one, and a
// thin magenta fringe. Colors are the effect's own, not the palette's: an aurora
// that repainted itself per theme would stop being an aurora.
const CURTAIN_PRESETS: CurtainPreset[] = [
	{
		yBase: -0.06,
		heightScale: 0.62,
		scrollSpeed: 0.16,
		driftSpeed: 0.09,
		drift: 26,
		alphaBase: 0.5,
		pulseSpeed: 0.05,
		r: 96,
		g: 226,
		b: 168
	},
	{
		yBase: -0.02,
		heightScale: 0.5,
		scrollSpeed: 0.11,
		driftSpeed: 0.13,
		drift: 34,
		alphaBase: 0.42,
		pulseSpeed: 0.078,
		r: 118,
		g: 214,
		b: 232
	},
	{
		yBase: 0.03,
		heightScale: 0.36,
		scrollSpeed: 0.23,
		driftSpeed: 0.17,
		drift: 20,
		alphaBase: 0.26,
		pulseSpeed: 0.11,
		r: 196,
		g: 150,
		b: 236
	}
];

export function createAuroraState(count: number, width: number, height: number): AuroraState {
	// Density buys streak count inside each curtain, never more curtains: a
	// fourth sheet reads as haze, not as light.
	const streakScale = Math.max(0.6, Math.min(1.8, count / 60));
	const curtains: AuroraCurtain[] = [];

	for (const preset of CURTAIN_PRESETS) {
		curtains.push({
			texture: createCurtainTexture(width, height * preset.heightScale, preset, streakScale),
			scrollX: randomRange(-width, 0),
			phase: randomRange(0, TAU),
			preset
		});
	}

	return { curtains, time: 0 };
}

export function updateAurora(
	state: AuroraState,
	width: number,
	_height: number,
	params: AmbientParams,
	deltaTime: number
): void {
	const dt = deltaTime / 16.67;
	state.time += dt;

	for (const curtain of state.curtains) {
		curtain.scrollX -= curtain.preset.scrollSpeed * dt * params.speed;
		if (curtain.scrollX <= -width) curtain.scrollX += width;
	}
}

export function renderAurora(
	ctx: CanvasRenderingContext2D,
	state: AuroraState,
	width: number,
	height: number,
	params: AmbientParams
): void {
	const vis = params.visibility;
	const shimmer = params.settings.shimmer;

	for (const curtain of state.curtains) {
		if (!curtain.texture) continue;
		const preset = curtain.preset;

		// Shimmer is depth of the breathing, not a second brightness knob: at 0
		// the curtain holds a steady glow rather than going dark.
		const pulse = Math.sin(state.time * preset.pulseSpeed * 0.1 + curtain.phase) * 0.5 + 0.5;
		const alpha = preset.alphaBase * vis * (1 - 0.55 * shimmer * (1 - pulse));
		if (alpha <= 0.01) continue;

		const y =
			height * preset.yBase +
			Math.sin(state.time * preset.driftSpeed * 0.1 + curtain.phase) * preset.drift;
		const drawHeight = height * preset.heightScale;

		ctx.globalAlpha = Math.min(1, alpha);
		ctx.drawImage(curtain.texture, curtain.scrollX, y, width, drawHeight);
		ctx.drawImage(curtain.texture, curtain.scrollX + width, y, width, drawHeight);
	}
	ctx.globalAlpha = 1;
}

/**
 * Bake one curtain: vertical light streaks of varying width, masked to fade at
 * both ends, then blurred once. The blur is baked here rather than applied per
 * frame because ctx.filter in a render loop forces a software raster path.
 */
function createCurtainTexture(
	width: number,
	height: number,
	preset: CurtainPreset,
	streakScale: number
): HTMLCanvasElement | null {
	if (typeof document === 'undefined') return null;

	const texture = document.createElement('canvas');
	const tw = Math.max(640, Math.round(width));
	const th = Math.max(160, Math.round(height));
	texture.width = tw;
	texture.height = th;

	const tctx = texture.getContext('2d');
	if (!tctx) return null;

	const streaks = Math.floor(58 * streakScale);
	for (let i = 0; i < streaks; i++) {
		const x = randomRange(-40, tw + 40);
		const streakWidth = randomRange(14, 74);
		const top = randomRange(0, th * 0.22);
		const bottom = randomRange(th * 0.55, th);
		const peak = randomRange(0.18, 0.62);

		const column = tctx.createLinearGradient(0, top, 0, bottom);
		column.addColorStop(0, getRgbaStyle(preset.r, preset.g, preset.b, 0));
		column.addColorStop(0.28, getRgbaStyle(preset.r, preset.g, preset.b, peak));
		column.addColorStop(0.7, getRgbaStyle(preset.r, preset.g, preset.b, peak * 0.45));
		column.addColorStop(1, getRgbaStyle(preset.r, preset.g, preset.b, 0));
		tctx.fillStyle = column;
		tctx.fillRect(x - streakWidth / 2, top, streakWidth, bottom - top);
	}

	// Fade both ends so the sheet has no cut edge against the sky.
	tctx.globalCompositeOperation = 'destination-in';
	const mask = tctx.createLinearGradient(0, 0, 0, th);
	mask.addColorStop(0, getRgbaStyle(255, 255, 255, 0.12));
	mask.addColorStop(0.3, getRgbaStyle(255, 255, 255, 1));
	mask.addColorStop(0.72, getRgbaStyle(255, 255, 255, 0.7));
	mask.addColorStop(1, getRgbaStyle(255, 255, 255, 0));
	tctx.fillStyle = mask;
	tctx.fillRect(0, 0, tw, th);
	tctx.globalCompositeOperation = 'source-over';

	const graded = document.createElement('canvas');
	graded.width = tw;
	graded.height = th;
	const gctx = graded.getContext('2d');
	if (!gctx) return texture;
	gctx.filter = 'blur(14px)';
	gctx.drawImage(texture, 0, 0);
	return graded;
}
