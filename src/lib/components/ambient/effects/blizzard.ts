// Blizzard ambient effect - heavy wind-driven snow with whiteout pulses

import type { AmbientParams } from '$lib/types/ambient';
import { randomRange, getRgbaStyle } from './particles';

export interface BlizzardFlake {
	x: number;
	y: number;
	vx: number;
	vy: number;
	size: number;
	opacity: number;
	layer: 0 | 1 | 2;
	spin: number;
	spinSpeed: number;
}

export interface BlizzardState {
	flakes: BlizzardFlake[];
	time: number;
	wind: number;
	whiteout: number;
}

const LAYER_SPEED = [0.5, 1, 1.6];

export function createBlizzardState(
	count: number,
	width: number,
	height: number
): BlizzardState {
	const flakes: BlizzardFlake[] = [];
	const total = Math.floor(count * 2);
	for (let i = 0; i < total; i++) {
		flakes.push(createFlake(width, height, true));
	}

	return {
		flakes,
		time: 0,
		wind: 0,
		whiteout: 0
	};
}

function createFlake(width: number, height: number, randomY = false): BlizzardFlake {
	const layer = (Math.random() < 0.35 ? 0 : Math.random() < 0.7 ? 1 : 2) as 0 | 1 | 2;

	// Initial placement: scatter everywhere
	// Respawn: 55% enter from left edge at any height, 45% from top
	let x: number, y: number;
	if (randomY) {
		x = randomRange(-80, width + 80);
		y = randomRange(-height * 0.5, height + 20);
	} else if (Math.random() < 0.55) {
		x = randomRange(-80, -10);
		y = randomRange(-40, height);
	} else {
		x = randomRange(-80, width * 0.6);
		y = randomRange(-80, -10);
	}

	return {
		x,
		y,
		vx: randomRange(1.6, 5.2),
		vy: randomRange(1.8, 4.5),
		size: randomRange(1, 4.3) * (0.7 + layer * 0.22),
		opacity: randomRange(0.24, 0.8),
		layer,
		spin: randomRange(0, Math.PI * 2),
		spinSpeed: randomRange(-0.06, 0.06)
	};
}

export function updateBlizzard(
	state: BlizzardState,
	width: number,
	height: number,
	params: AmbientParams,
	deltaTime: number
): void {
	const dt = deltaTime / 16.67;
	const windSetting = params.settings.wind;
	state.time += dt * 0.015 * params.speed;
	// Slow cycle (~3 min), moderate gusts (~70s), tiny texture (~12s)
	state.wind = (Math.sin(state.time * 0.035) * 2.8
		+ Math.sin(state.time * 0.1) * 1.2
		+ Math.sin(state.time * 0.6) * 0.3) * windSetting;
	state.whiteout = Math.sin(state.time * 0.25) * 0.5 + 0.5;

	const speedScale = 0.75 + 0.5 * params.speed * 1.7;

	for (const flake of state.flakes) {
		flake.spin += flake.spinSpeed * dt * params.speed;
		const layerSpeed = LAYER_SPEED[flake.layer];
		const gust = state.wind * (0.6 + flake.layer * 0.35);

		flake.x += (flake.vx + gust) * dt * speedScale * layerSpeed;
		flake.y += flake.vy * dt * speedScale * layerSpeed;

		if (
			flake.x > width + 150 ||
			flake.x < -150 ||
			flake.y > height + 80
		) {
			Object.assign(flake, createFlake(width, height));
		}
	}
}

export function renderBlizzard(
	ctx: CanvasRenderingContext2D,
	state: BlizzardState,
	width: number,
	height: number,
	params: AmbientParams
): void {
	const vis = params.visibility;

	for (const flake of state.flakes) {
		const alpha = flake.opacity * vis * (0.6 + flake.layer * 0.18);
		if (alpha <= 0.01) continue;

		ctx.save();
		ctx.translate(flake.x, flake.y);
		ctx.rotate(flake.spin);

		if (flake.layer === 2) {
			// Near layer gets elongated streaks from speed blur feel.
			ctx.fillStyle = getRgbaStyle(245, 250, 255, alpha);
			ctx.fillRect(-flake.size * 1.8, -flake.size * 0.4, flake.size * 3.6, flake.size * 0.8);
		} else {
			ctx.beginPath();
			ctx.arc(0, 0, flake.size, 0, Math.PI * 2);
			ctx.fillStyle = getRgbaStyle(245, 250, 255, alpha);
			ctx.fill();
		}

		ctx.restore();
	}
}
