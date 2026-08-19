// Base particle system utilities

export interface BaseParticle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	size: number;
	opacity: number;
	life: number;
	maxLife: number;
}

export function createParticlePool<T extends BaseParticle>(
	maxParticles: number,
	factory: () => T
): T[] {
	return Array.from({ length: maxParticles }, factory);
}

export function resetParticle<T extends BaseParticle>(
	particle: T,
	width: number,
	height: number,
	resetFn: (p: T, w: number, h: number) => void
): void {
	resetFn(particle, width, height);
}

export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

export function randomRange(min: number, max: number): number {
	return Math.random() * (max - min) + min;
}

export function easeOutQuad(t: number): number {
	return t * (2 - t);
}

export function easeInOutSine(t: number): number {
	return -(Math.cos(Math.PI * t) - 1) / 2;
}

// Get theme-aware colors
export function getThemeColor(cssVar: string, fallback: string): string {
	if (typeof document === 'undefined') return fallback;
	const style = getComputedStyle(document.documentElement);
	return style.getPropertyValue(cssVar).trim() || fallback;
}

// Style cache to avoid string allocations in render loops
const styleCache = new Map<number, string>();
const MAX_CACHE_SIZE = 200;

export function getRgbaStyle(r: number, g: number, b: number, alpha: number): string {
	// Round alpha to 2 decimal places and create a unique key
	const roundedAlpha = Math.round(alpha * 100);
	const key = (r << 24) | (g << 16) | (b << 8) | roundedAlpha;

	let style = styleCache.get(key);
	if (!style) {
		style = `rgba(${r},${g},${b},${(roundedAlpha / 100).toFixed(2)})`;
		styleCache.set(key, style);

		// Prevent unbounded growth
		if (styleCache.size > MAX_CACHE_SIZE) {
			const firstKey = styleCache.keys().next().value;
			if (firstKey !== undefined) styleCache.delete(firstKey);
		}
	}
	return style;
}
