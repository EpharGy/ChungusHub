// Starlight ambient effect - twinkling stars with occasional meteors

import type { AmbientParams } from '$lib/types/ambient';
import { randomRange, getRgbaStyle } from './particles';
import {
	createDitherCache,
	createRadialSprite,
	getDitheredRadialGradient,
	type DitherCache
} from './dither';

export interface Star {
	x: number;
	y: number;
	size: number;
	opacity: number;
	twinklePhase: number;
	twinkleSpeed: number;
}

export interface ShootingStar {
	active: boolean;
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	maxLife: number;
	length: number;
	opacity: number;
}

export interface StarlightState {
	stars: Star[];
	shootingStars: ShootingStar[];
	time: number;
	meteorTimer: number;
	nextMeteor: number;
	// State-local cache: a module-level buffer here would thrash between the
	// workspace canvas and the settings preview (different sizes, same cache).
	moonCache: DitherCache;
	glowSprite: HTMLCanvasElement | null;
}

const SHOOTING_STAR_POOL = 3;

export function createStarlightState(
	count: number,
	width: number,
	height: number
): StarlightState {
	const stars: Star[] = [];
	for (let i = 0; i < count; i++) {
		stars.push(createStar(width, height));
	}

	const shootingStars: ShootingStar[] = [];
	for (let i = 0; i < SHOOTING_STAR_POOL; i++) {
		shootingStars.push(createInactiveShootingStar());
	}

	return {
		stars,
		shootingStars,
		time: 0,
		meteorTimer: 0,
		nextMeteor: randomRange(1600, 4200),
		moonCache: createDitherCache(),
		glowSprite: createRadialSprite(16, [
			{ t: 0, r: 235, g: 245, b: 255, a: 1 },
			{ t: 0.55, r: 215, g: 230, b: 255, a: 0.35 },
			{ t: 1, r: 215, g: 230, b: 255, a: 0 }
		])
	};
}

function createStar(width: number, height: number): Star {
	return {
		x: randomRange(0, width),
		y: randomRange(0, height * 0.88),
		size: randomRange(0.5, 2.1),
		opacity: randomRange(0.3, 0.95),
		twinklePhase: randomRange(0, Math.PI * 2),
		twinkleSpeed: randomRange(0.01, 0.05)
	};
}

function createInactiveShootingStar(): ShootingStar {
	return {
		active: false,
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
		life: 0,
		maxLife: 0,
		length: 0,
		opacity: 0
	};
}

function activateShootingStar(star: ShootingStar, width: number, height: number): void {
	const fromLeft = Math.random() > 0.5;
	star.active = true;
	star.x = fromLeft ? randomRange(width * 0.05, width * 0.4) : randomRange(width * 0.6, width * 0.95);
	star.y = randomRange(height * 0.05, height * 0.35);
	star.vx = fromLeft ? randomRange(5.5, 10) : randomRange(-10, -5.5);
	star.vy = randomRange(2.2, 4.2);
	star.life = 0;
	star.maxLife = randomRange(24, 48);
	star.length = randomRange(40, 95);
	star.opacity = randomRange(0.55, 1);
}

export function updateStarlight(
	state: StarlightState,
	width: number,
	height: number,
	params: AmbientParams,
	deltaTime: number
): void {
	const dt = deltaTime / 16.67;
	const meteors = params.settings.meteors;
	state.time += dt * 0.01;
	state.meteorTimer += deltaTime;

	for (const star of state.stars) {
		star.twinklePhase += star.twinkleSpeed * dt * params.speed;
	}

	if (state.meteorTimer >= state.nextMeteor && meteors > 0.05) {
		for (const shootingStar of state.shootingStars) {
			if (!shootingStar.active) {
				activateShootingStar(shootingStar, width, height);
				state.meteorTimer = 0;
				state.nextMeteor = randomRange(1500, 5000) / Math.max(0.25, 0.5 * meteors);
				break;
			}
		}
	}

	const meteorPace = 0.75 + 0.5 * params.speed * 0.8;
	for (const shootingStar of state.shootingStars) {
		if (!shootingStar.active) continue;

		shootingStar.life += dt;
		shootingStar.x += shootingStar.vx * dt * meteorPace;
		shootingStar.y += shootingStar.vy * dt * meteorPace;

		const progress = shootingStar.life / shootingStar.maxLife;
		shootingStar.opacity = Math.max(0, 1 - progress);

		if (
			progress >= 1 ||
			shootingStar.x < -120 ||
			shootingStar.x > width + 120 ||
			shootingStar.y > height + 120
		) {
			Object.assign(shootingStar, createInactiveShootingStar());
		}
	}
}

export function renderStarlight(
	ctx: CanvasRenderingContext2D,
	state: StarlightState,
	width: number,
	height: number,
	params: AmbientParams
): void {
	const vis = params.visibility;

	// Flat sky tint. A faint vertical gradient can't survive 8-bit compositing at
	// low alpha, so the sky is uniform; the moon glow gives it spatial depth.
	ctx.fillStyle = getRgbaStyle(11, 17, 39, 0.12 * vis);
	ctx.fillRect(0, 0, width, height);

	// Moon glow - dithered radial buffer, rebuilt only on size/visibility change.
	const moon = getDitheredRadialGradient(
		state.moonCache,
		width,
		height,
		width * 0.86,
		height * 0.14,
		width * 0.45,
		[
			{ t: 0, r: 190, g: 210, b: 255, a: 0.09 * vis },
			{ t: 0.45, r: 160, g: 185, b: 240, a: 0.04 * vis },
			{ t: 1, r: 140, g: 170, b: 230, a: 0 }
		]
	);
	if (moon) ctx.drawImage(moon, 0, 0, width, height);

	for (const star of state.stars) {
		const twinkle = 0.35 + (Math.sin(star.twinklePhase) * 0.5 + 0.5) * 0.65;
		const alpha = star.opacity * twinkle * vis;
		if (alpha <= 0.008) continue;

		if (star.size < 1.1) {
			ctx.fillStyle = getRgbaStyle(220, 235, 255, alpha);
			ctx.fillRect(star.x, star.y, star.size, star.size);
		} else if (state.glowSprite) {
			ctx.globalAlpha = alpha;
			ctx.drawImage(
				state.glowSprite,
				star.x - star.size * 3,
				star.y - star.size * 3,
				star.size * 6,
				star.size * 6
			);
			ctx.globalAlpha = 1;

			ctx.beginPath();
			ctx.arc(star.x, star.y, star.size * 0.7, 0, Math.PI * 2);
			ctx.fillStyle = getRgbaStyle(245, 250, 255, alpha);
			ctx.fill();
		}
	}

	for (const shootingStar of state.shootingStars) {
		if (!shootingStar.active || shootingStar.opacity <= 0.01) continue;

		const trailX = shootingStar.x - shootingStar.vx * (shootingStar.length / 10);
		const trailY = shootingStar.y - shootingStar.vy * (shootingStar.length / 10);
		const trail = ctx.createLinearGradient(
			shootingStar.x,
			shootingStar.y,
			trailX,
			trailY
		);
		trail.addColorStop(0, getRgbaStyle(255, 255, 255, shootingStar.opacity * vis));
		trail.addColorStop(0.35, getRgbaStyle(205, 225, 255, shootingStar.opacity * 0.6 * vis));
		trail.addColorStop(1, getRgbaStyle(165, 190, 240, 0));

		ctx.beginPath();
		ctx.moveTo(shootingStar.x, shootingStar.y);
		ctx.lineTo(trailX, trailY);
		ctx.strokeStyle = trail;
		ctx.lineWidth = 1.6;
		ctx.lineCap = 'round';
		ctx.stroke();

		ctx.beginPath();
		ctx.arc(shootingStar.x, shootingStar.y, 1.8, 0, Math.PI * 2);
		ctx.fillStyle = getRgbaStyle(
			255,
			255,
			255,
			Math.min(1, shootingStar.opacity * 1.2 * vis)
		);
		ctx.fill();
	}
}
