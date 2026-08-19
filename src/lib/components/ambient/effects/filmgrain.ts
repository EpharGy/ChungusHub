// Film grain ambient effect - emulsion noise, scratches and a breathing vignette

import type { AmbientParams } from '$lib/types/ambient';
import { randomRange, getRgbaStyle } from './particles';
import { createDitherCache, getDitheredRadialGradient, type DitherCache } from './dither';

/** Baked noise tiles, cycled per frame. Four is enough to defeat the eye. */
const TILE_COUNT = 4;
const TILE_SIZE = 128;

export interface Scratch {
	x: number;
	/** Horizontal wobble, so the line is not a ruler-straight artifact. */
	drift: number;
	width: number;
	alpha: number;
	top: number;
	bottom: number;
	life: number;
	maxLife: number;
}

export interface FilmGrainState {
	tiles: HTMLCanvasElement[];
	/** Built on first render from the live context, then reused. */
	patterns: (CanvasPattern | null)[] | null;
	tileIndex: number;
	scratches: Scratch[];
	maxScratches: number;
	spawnTimer: number;
	flickerPhase: number;
	flash: number;
	vignetteCache: DitherCache;
}

export function createFilmGrainState(
	count: number,
	_width: number,
	_height: number
): FilmGrainState {
	const tiles: HTMLCanvasElement[] = [];
	for (let i = 0; i < TILE_COUNT; i++) {
		const tile = createNoiseTile();
		if (tile) tiles.push(tile);
	}

	return {
		tiles,
		patterns: null,
		tileIndex: 0,
		scratches: [],
		maxScratches: Math.max(1, Math.min(7, Math.round(count / 12))),
		spawnTimer: 0,
		flickerPhase: randomRange(0, Math.PI * 2),
		flash: 0,
		vignetteCache: createDitherCache()
	};
}

function createScratch(width: number, height: number): Scratch {
	return {
		x: randomRange(0, width),
		drift: randomRange(-0.5, 0.5),
		width: randomRange(0.6, 2.1),
		alpha: randomRange(0.05, 0.22),
		// Most scratches only touch part of the frame.
		top: randomRange(0, height * 0.4),
		bottom: randomRange(height * 0.6, height),
		life: 0,
		maxLife: randomRange(6, 55)
	};
}

export function updateFilmGrain(
	state: FilmGrainState,
	width: number,
	height: number,
	params: AmbientParams,
	deltaTime: number
): void {
	const dt = deltaTime / 16.67;

	// A fresh tile every frame is the whole trick: grain that holds still for two
	// frames stops reading as film and starts reading as dirt on the screen.
	state.tileIndex = (state.tileIndex + 1) % Math.max(1, state.tiles.length);

	state.flickerPhase += dt * 0.09 * params.speed;
	state.flash = Math.max(0, state.flash - dt * 0.12);
	if (Math.random() < 0.004 * dt * params.speed) state.flash = randomRange(0.3, 1);

	if (params.settings.scratches >= 0.5) {
		state.spawnTimer -= dt * params.speed;
		if (state.spawnTimer <= 0) {
			state.spawnTimer = randomRange(8, 70);
			if (state.scratches.length < state.maxScratches) {
				state.scratches.push(createScratch(width, height));
			}
		}

		for (const scratch of state.scratches) {
			scratch.life += dt * params.speed;
			scratch.x += scratch.drift * dt;
		}
		state.scratches = state.scratches.filter((s) => s.life < s.maxLife);
	} else if (state.scratches.length > 0) {
		state.scratches = [];
	}
}

export function renderFilmGrain(
	ctx: CanvasRenderingContext2D,
	state: FilmGrainState,
	width: number,
	height: number,
	params: AmbientParams
): void {
	const vis = params.visibility;

	if (!state.patterns && state.tiles.length > 0) {
		state.patterns = state.tiles.map((tile) => ctx.createPattern(tile, 'repeat'));
	}

	const pattern = state.patterns?.[state.tileIndex];
	if (pattern) {
		// Exposure breathes, which is what an old projector actually does.
		const breath = 0.85 + Math.sin(state.flickerPhase) * 0.15;
		ctx.save();
		ctx.globalAlpha = Math.min(1, 0.5 * vis * breath);
		// Offset by a whole tile at a time so the pattern's own seams never land
		// in the same place twice.
		ctx.translate(-Math.random() * TILE_SIZE, -Math.random() * TILE_SIZE);
		ctx.fillStyle = pattern;
		ctx.fillRect(0, 0, width + TILE_SIZE, height + TILE_SIZE);
		ctx.restore();
	}

	if (params.settings.vignette >= 0.5) {
		const vignette = getDitheredRadialGradient(
			state.vignetteCache,
			width,
			height,
			width / 2,
			height / 2,
			Math.max(width, height) * 0.72,
			[
				{ t: 0, r: 0, g: 0, b: 0, a: 0 },
				{ t: 0.55, r: 0, g: 0, b: 0, a: 0.06 * vis },
				{ t: 1, r: 0, g: 0, b: 0, a: 0.42 * vis }
			]
		);
		if (vignette) ctx.drawImage(vignette, 0, 0, width, height);
	}

	// Saved because the stack renders effects back to back on one context: a line
	// width left behind here would repaint the next one.
	ctx.save();
	for (const scratch of state.scratches) {
		// In and out within its own short life, so no scratch ever pops.
		const t = scratch.life / scratch.maxLife;
		const fade = t < 0.2 ? t / 0.2 : t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
		const alpha = scratch.alpha * fade * vis;
		if (alpha <= 0.005) continue;

		ctx.beginPath();
		ctx.moveTo(scratch.x, scratch.top);
		ctx.lineTo(scratch.x + scratch.drift * 6, scratch.bottom);
		ctx.strokeStyle = getRgbaStyle(255, 252, 240, alpha);
		ctx.lineWidth = scratch.width;
		ctx.stroke();
	}
	ctx.restore();

	if (state.flash > 0.01) {
		ctx.fillStyle = getRgbaStyle(255, 250, 235, state.flash * 0.06 * vis);
		ctx.fillRect(0, 0, width, height);
	}
}

/** One tile of neutral emulsion noise. Neutral on purpose: tinted grain would
 *  fight whatever palette and background the scene already has. */
function createNoiseTile(): HTMLCanvasElement | null {
	if (typeof document === 'undefined') return null;

	const canvas = document.createElement('canvas');
	canvas.width = TILE_SIZE;
	canvas.height = TILE_SIZE;
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;

	const img = ctx.createImageData(TILE_SIZE, TILE_SIZE);
	const d = img.data;
	for (let i = 0; i < d.length; i += 4) {
		const value = 110 + Math.random() * 145;
		d[i] = value;
		d[i + 1] = value;
		d[i + 2] = value;
		// Sparse and uneven: a solid sheet of noise is a grey veil, not grain.
		d[i + 3] = Math.random() < 0.5 ? 0 : Math.random() * 130;
	}
	ctx.putImageData(img, 0, 0);
	return canvas;
}
