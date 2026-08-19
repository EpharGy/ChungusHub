// Dithered gradient buffers - the shared fix for gradient banding.
//
// Full-screen gradients at low alpha quantize to a handful of 8-bit levels and
// band into visible rings/stripes. Canvas gradients can't avoid it: the banding
// lives in the alpha channel, so post-hoc grain on top can't touch it. The fix
// (proven on Starlight) is to compute the gradient in floating point and add
// sub-pixel triangular dither BEFORE the 8-bit write, then cache the buffer and
// blit it each frame. Buffers rebuild only when size or the stop list changes.

export interface GradientStop {
	t: number; // 0-1
	r: number;
	g: number;
	b: number;
	a: number;
}

export interface DitherCache {
	canvas: HTMLCanvasElement | null;
	key: string;
}

export function createDitherCache(): DitherCache {
	return { canvas: null, key: '' };
}

function stopsKey(stops: GradientStop[]): string {
	let key = '';
	for (const s of stops) {
		key += `${s.t},${s.r},${s.g},${s.b},${s.a.toFixed(4)};`;
	}
	return key;
}

/** Straight-alpha color at t, linearly interpolated between stops. */
function colorAt(stops: GradientStop[], t: number, out: number[]): void {
	const first = stops[0];
	if (t <= first.t) {
		out[0] = first.r;
		out[1] = first.g;
		out[2] = first.b;
		out[3] = first.a;
		return;
	}
	for (let i = 0; i < stops.length - 1; i++) {
		const a = stops[i];
		const b = stops[i + 1];
		if (t <= b.t) {
			const range = b.t - a.t;
			const local = range <= 0 ? 1 : (t - a.t) / range;
			out[0] = a.r + (b.r - a.r) * local;
			out[1] = a.g + (b.g - a.g) * local;
			out[2] = a.b + (b.b - a.b) * local;
			out[3] = a.a + (b.a - a.a) * local;
			return;
		}
	}
	const last = stops[stops.length - 1];
	out[0] = last.r;
	out[1] = last.g;
	out[2] = last.b;
	out[3] = last.a;
}

function prepareBuffer(
	cache: DitherCache,
	width: number,
	height: number,
	key: string
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
	if (typeof document === 'undefined') return null;

	const canvas = cache.canvas ?? document.createElement('canvas');
	canvas.width = Math.max(1, Math.floor(width));
	canvas.height = Math.max(1, Math.floor(height));
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;

	cache.canvas = canvas;
	cache.key = key;
	return { canvas, ctx };
}

/**
 * Vertical linear gradient (top to bottom), dithered, cached.
 * `amplitude` is the triangular dither strength in 8-bit levels; the default
 * ~±1 level is right when the buffer is drawn at full alpha. If the caller
 * modulates globalAlpha at draw time, raise it (~1/minAlpha) so the noise
 * survives the scale-down.
 */
export function getDitheredLinearGradient(
	cache: DitherCache,
	width: number,
	height: number,
	stops: GradientStop[],
	amplitude = 1.2
): HTMLCanvasElement | null {
	const w = Math.max(1, Math.floor(width));
	const h = Math.max(1, Math.floor(height));
	const key = `L${w}x${h}A${amplitude}:${stopsKey(stops)}`;
	if (cache.canvas && cache.key === key) return cache.canvas;

	const prepared = prepareBuffer(cache, w, h, key);
	if (!prepared) return null;
	const { canvas, ctx } = prepared;

	const img = ctx.createImageData(w, h);
	const d = img.data;
	const color: number[] = [0, 0, 0, 0];

	for (let y = 0; y < h; y++) {
		colorAt(stops, h <= 1 ? 0 : y / (h - 1), color);
		const r = color[0];
		const g = color[1];
		const b = color[2];
		const a = color[3] * 255;
		let i = y * w * 4;
		for (let x = 0; x < w; x++) {
			const n = (Math.random() - Math.random()) * amplitude;
			d[i] = r + n;
			d[i + 1] = g + n;
			d[i + 2] = b + n;
			d[i + 3] = a + n;
			i += 4;
		}
	}

	ctx.putImageData(img, 0, 0);
	return canvas;
}

/**
 * Radial gradient centered at (cx, cy) with the given radius (all in buffer
 * pixels), dithered, cached. Same amplitude semantics as the linear variant.
 */
export function getDitheredRadialGradient(
	cache: DitherCache,
	width: number,
	height: number,
	cx: number,
	cy: number,
	radius: number,
	stops: GradientStop[],
	amplitude = 1.2
): HTMLCanvasElement | null {
	const w = Math.max(1, Math.floor(width));
	const h = Math.max(1, Math.floor(height));
	const key = `R${w}x${h}c${cx.toFixed(1)},${cy.toFixed(1)}r${radius.toFixed(1)}A${amplitude}:${stopsKey(stops)}`;
	if (cache.canvas && cache.key === key) return cache.canvas;

	const prepared = prepareBuffer(cache, w, h, key);
	if (!prepared) return null;
	const { canvas, ctx } = prepared;

	const img = ctx.createImageData(w, h);
	const d = img.data;
	const invRadius = radius > 0 ? 1 / radius : 0;
	const color: number[] = [0, 0, 0, 0];

	let i = 0;
	for (let y = 0; y < h; y++) {
		const dy = y - cy;
		const dy2 = dy * dy;
		for (let x = 0; x < w; x++) {
			const dx = x - cx;
			const t = Math.min(1, Math.sqrt(dx * dx + dy2) * invRadius);
			colorAt(stops, t, color);
			const n = (Math.random() - Math.random()) * amplitude;
			d[i] = color[0] + n;
			d[i + 1] = color[1] + n;
			d[i + 2] = color[2] + n;
			d[i + 3] = color[3] * 255 + n;
			i += 4;
		}
	}

	ctx.putImageData(img, 0, 0);
	return canvas;
}

/**
 * Small pre-rendered radial glow sprite. Replaces per-particle
 * createRadialGradient calls in render loops - draw with drawImage + a
 * per-particle globalAlpha instead. Banding is invisible at sprite scale, so a
 * plain canvas gradient is fine here.
 */
export function createRadialSprite(radius: number, stops: GradientStop[]): HTMLCanvasElement | null {
	if (typeof document === 'undefined') return null;

	const size = Math.max(2, Math.ceil(radius * 2));
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;

	const c = size / 2;
	const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
	for (const s of stops) {
		gradient.addColorStop(s.t, `rgba(${Math.round(s.r)},${Math.round(s.g)},${Math.round(s.b)},${s.a})`);
	}
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, size, size);
	return canvas;
}
