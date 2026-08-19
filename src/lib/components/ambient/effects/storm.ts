// Storm ambient effect - heavy rain with lightning (enhanced visuals)

import type { AmbientParams } from '$lib/types/ambient';
import { randomRange, getRgbaStyle } from './particles';
import { createDitherCache, getDitheredRadialGradient, type DitherCache } from './dither';

export interface StormDrop {
	x: number;
	y: number;
	vy: number;
	length: number;
	opacity: number;
	width: number;
	layer: number; // 0=background, 1=mid, 2=foreground
}

export interface StormSplash {
	x: number;
	y: number;
	frame: number;
	maxFrames: number;
	size: number;
	active: boolean;
}

export interface Lightning {
	active: boolean;
	opacity: number;
	x: number;
	branches: LightningBranch[];
	fadeSpeed: number;
	timer: number;
	nextStrike: number;
}

export interface SheetLightning {
	active: boolean;
	opacity: number;
	timer: number;
	nextFlash: number;
}

export interface ThunderRumble {
	active: boolean;
	delay: number;
	elapsed: number;
	duration: number;
	intensity: number;
}

interface LightningBranch {
	points: { x: number; y: number }[];
	width: number;
	opacity: number;
}

export interface StormState {
	drops: StormDrop[];
	splashPool: StormSplash[];
	activeSplashCount: number;
	lightning: Lightning;
	sheetLightning: SheetLightning;
	thunderRumble: ThunderRumble;
	windOffset: number;
	windGust: number;
	gustTarget: number;
	gustSpeed: number;
	time: number;
	atmospherePhase: number;
	shake: { x: number; y: number };
	flashCache: DitherCache;
}

const MAX_SPLASHES = 50;

// The flash overlay bakes at quarter resolution - the upscale blur suits a soft
// flash, and rebuilding ~130k px per strike is a non-issue.
const FLASH_BUFFER_SCALE = 0.25;
// Drawn with a fading globalAlpha, so the baked dither needs extra amplitude to
// survive the scale-down (see dither.ts).
const FLASH_DITHER_AMPLITUDE = 2.5;

// Layer configs: [speedMult, sizeMult, opacityMult, parallaxMult]
const LAYER_CONFIG = [
	[0.5, 0.6, 0.3, 0.3],   // background - slow, small, dim
	[1.0, 1.0, 0.5, 0.6],   // midground - normal
	[1.4, 1.3, 0.7, 1.0]    // foreground - fast, big, bright
];

export function createStormState(count: number, width: number, height: number): StormState {
	const drops: StormDrop[] = [];
	const totalDrops = count * 2;

	// Distribute drops across layers: 40% back, 35% mid, 25% front
	const layerDistribution = [0.4, 0.35, 0.25];

	for (let i = 0; i < totalDrops; i++) {
		// Assign layer based on distribution
		const rand = Math.random();
		const layer = rand < layerDistribution[0] ? 0 : rand < layerDistribution[0] + layerDistribution[1] ? 1 : 2;
		const [speedMult, sizeMult, opacityMult] = LAYER_CONFIG[layer];

		drops.push({
			x: randomRange(-50, width + 50),
			y: randomRange(-height, height),
			vy: randomRange(25, 40) * speedMult,
			length: randomRange(20, 40) * sizeMult,
			opacity: randomRange(0.3, 0.6) * opacityMult,
			width: randomRange(1, 2.5) * sizeMult,
			layer
		});
	}

	// Pre-allocate splash pool (bigger than rain's pool for storm intensity)
	const splashPool: StormSplash[] = [];
	for (let i = 0; i < MAX_SPLASHES; i++) {
		splashPool.push({
			x: 0,
			y: 0,
			frame: 0,
			maxFrames: 10,
			size: 4,
			active: false
		});
	}

	return {
		drops,
		splashPool,
		activeSplashCount: 0,
		lightning: {
			active: false,
			opacity: 0,
			x: width * 0.5,
			branches: [],
			fadeSpeed: 0.12,
			timer: 0,
			nextStrike: randomRange(2000, 5000)
		},
		sheetLightning: {
			active: false,
			opacity: 0,
			timer: 0,
			nextFlash: randomRange(500, 2000)
		},
		thunderRumble: {
			active: false,
			delay: 0,
			elapsed: 0,
			duration: 800,
			intensity: 0
		},
		windOffset: 0,
		windGust: 0,
		gustTarget: 0,
		gustSpeed: 0,
		time: 0,
		atmospherePhase: 0,
		shake: { x: 0, y: 0 },
		flashCache: createDitherCache()
	};
}

function resetStormDrop(drop: StormDrop, width: number): void {
	const [speedMult, sizeMult, opacityMult] = LAYER_CONFIG[drop.layer];
	drop.x = randomRange(-50, width + 50);
	drop.y = randomRange(-100, -10);
	drop.vy = randomRange(25, 40) * speedMult;
	drop.length = randomRange(20, 40) * sizeMult;
	drop.opacity = randomRange(0.3, 0.6) * opacityMult;
	drop.width = randomRange(1, 2.5) * sizeMult;
}

function activateSplash(state: StormState, x: number, y: number, size: number): void {
	for (let i = 0; i < MAX_SPLASHES; i++) {
		const splash = state.splashPool[i];
		if (!splash.active) {
			splash.x = x;
			splash.y = y;
			splash.frame = 0;
			splash.size = size;
			splash.active = true;
			state.activeSplashCount++;
			return;
		}
	}
}

function generateLightningBranch(
	startX: number,
	startY: number,
	endY: number,
	isMain: boolean
): LightningBranch {
	const points: { x: number; y: number }[] = [];
	let x = startX;
	let y = startY;

	const segments = Math.floor(randomRange(8, 15));
	const segmentHeight = (endY - startY) / segments;

	points.push({ x, y });

	for (let i = 0; i < segments; i++) {
		x += randomRange(-30, 30) * (isMain ? 1 : 0.5);
		y += segmentHeight;
		points.push({ x, y });
	}

	// Add tip flare - small split at the end
	if (isMain && Math.random() > 0.3) {
		const lastPoint = points[points.length - 1];
		points.push({
			x: lastPoint.x + randomRange(-15, 15),
			y: lastPoint.y + randomRange(10, 25)
		});
	}

	return {
		points,
		width: isMain ? randomRange(2, 4) : randomRange(1, 2),
		opacity: isMain ? 1 : randomRange(0.4, 0.7)
	};
}

export function updateStorm(
	state: StormState,
	width: number,
	height: number,
	params: AmbientParams,
	deltaTime: number
): void {
	const dt = deltaTime / 16.67;
	const pace = 0.5 * params.speed;
	const windSetting = params.settings.wind;
	const lightningSetting = params.settings.lightning;
	const shakeOn = params.settings.shake >= 0.5;

	state.time += dt * params.speed;

	// Atmospheric breathing - slow irregular modulation
	state.atmospherePhase += dt * 0.008 * params.speed;

	// Wind effect - base oscillation + violent gusts
	const baseWind = Math.sin(state.time * 0.02) * 3;

	// Gust system - occasional violent wind spikes
	state.gustSpeed += dt * 0.02;
	if (Math.random() < 0.005 * 0.5 * windSetting) {
		// Trigger new gust
		state.gustTarget = randomRange(-25, 25) * 0.5 * windSetting;
		state.gustSpeed = 0;
	}

	// Smooth interpolation toward gust target, then decay
	const gustDecay = Math.min(1, state.gustSpeed * 0.1);
	state.windGust = state.windGust + (state.gustTarget - state.windGust) * 0.05 * dt;
	state.gustTarget *= (1 - gustDecay * 0.02 * dt);

	state.windOffset = baseWind + state.windGust;

	const dropSpeed = dt * pace;

	// Update rain with wind - parallax per layer
	for (let i = 0; i < state.drops.length; i++) {
		const drop = state.drops[i];
		const [, , , parallaxMult] = LAYER_CONFIG[drop.layer];

		drop.x += state.windOffset * parallaxMult * dt * pace;
		drop.y += drop.vy * dropSpeed;

		if (drop.y > height || drop.x < -100 || drop.x > width + 100) {
			// Activate splash for foreground/mid drops only
			if (drop.layer >= 1 && drop.y > height && state.activeSplashCount < MAX_SPLASHES) {
				const splashSize = drop.width * (drop.layer === 2 ? 4 : 2.5);
				activateSplash(state, drop.x, height - 5, splashSize);
			}
			resetStormDrop(drop, width);
		}
	}

	// Update splashes
	const splashSpeed = dt * 1.2 * pace;
	for (let i = 0; i < MAX_SPLASHES; i++) {
		const splash = state.splashPool[i];
		if (splash.active) {
			splash.frame += splashSpeed;
			if (splash.frame >= splash.maxFrames) {
				splash.active = false;
				state.activeSplashCount--;
			}
		}
	}

	// Sheet lightning (ambient cloud flashes)
	state.sheetLightning.timer += deltaTime;
	if (state.sheetLightning.active) {
		state.sheetLightning.opacity -= 0.08 * dt;
		if (state.sheetLightning.opacity <= 0) {
			state.sheetLightning.active = false;
			state.sheetLightning.opacity = 0;
		}
	} else if (
		!state.lightning.active &&
		state.sheetLightning.timer >= state.sheetLightning.nextFlash &&
		lightningSetting > 0.05
	) {
		state.sheetLightning.active = true;
		state.sheetLightning.opacity = randomRange(0.15, 0.35);
		state.sheetLightning.timer = 0;
		state.sheetLightning.nextFlash = randomRange(800, 3000) / (0.5 * lightningSetting);
	}

	// Thunder rumble (delayed shake after lightning)
	if (state.thunderRumble.active) {
		state.thunderRumble.elapsed += deltaTime;
		if (state.thunderRumble.elapsed >= state.thunderRumble.delay) {
			const rumbleProgress = (state.thunderRumble.elapsed - state.thunderRumble.delay) / state.thunderRumble.duration;
			if (rumbleProgress < 1) {
				if (shakeOn) {
					const rumbleIntensity = state.thunderRumble.intensity * (1 - rumbleProgress) * Math.sin(rumbleProgress * Math.PI);
					state.shake.x += (Math.random() - 0.5) * 3 * rumbleIntensity;
					state.shake.y += (Math.random() - 0.5) * 1.5 * rumbleIntensity;
				}
			} else {
				state.thunderRumble.active = false;
			}
		}
	}

	// Main lightning logic
	state.lightning.timer += deltaTime;

	if (state.lightning.active) {
		state.lightning.opacity -= state.lightning.fadeSpeed * dt;
		if (shakeOn) {
			state.shake.x = (Math.random() - 0.5) * 6 * state.lightning.opacity;
			state.shake.y = (Math.random() - 0.5) * 3 * state.lightning.opacity;
		}

		if (state.lightning.opacity <= 0) {
			state.lightning.active = false;
			state.lightning.opacity = 0;

			// Queue thunder rumble
			state.thunderRumble.active = true;
			state.thunderRumble.delay = randomRange(400, 1500);
			state.thunderRumble.elapsed = 0;
			state.thunderRumble.duration = randomRange(600, 1200);
			state.thunderRumble.intensity = randomRange(0.4, 0.8);
		}
	} else if (!state.thunderRumble.active) {
		// Only reset shake when both lightning and rumble are done
		state.shake.x *= 0.9;
		state.shake.y *= 0.9;
		if (Math.abs(state.shake.x) < 0.1) state.shake.x = 0;
		if (Math.abs(state.shake.y) < 0.1) state.shake.y = 0;
	}

	if (!shakeOn) {
		state.shake.x = 0;
		state.shake.y = 0;
	}

	if (
		!state.lightning.active &&
		state.lightning.timer >= state.lightning.nextStrike &&
		lightningSetting > 0.05
	) {
		// Trigger lightning
		state.lightning.active = true;
		state.lightning.opacity = 1;
		state.lightning.x = randomRange(width * 0.15, width * 0.85);
		state.lightning.timer = 0;
		state.lightning.nextStrike = randomRange(3000, 8000) / (0.5 * lightningSetting);

		// Generate branches
		state.lightning.branches = [
			generateLightningBranch(state.lightning.x, -10, height * 0.7, true)
		];

		// Add side branches
		const branchCount = Math.floor(randomRange(1, 5));
		for (let i = 0; i < branchCount; i++) {
			const mainBranch = state.lightning.branches[0];
			const startIdx = Math.floor(randomRange(2, mainBranch.points.length - 2));
			const startPoint = mainBranch.points[startIdx];
			state.lightning.branches.push(
				generateLightningBranch(
					startPoint.x,
					startPoint.y,
					startPoint.y + randomRange(50, 150),
					false
				)
			);
		}
	}
}

export function renderStorm(
	ctx: CanvasRenderingContext2D,
	state: StormState,
	width: number,
	height: number,
	params: AmbientParams
): void {
	const vis = params.visibility;

	// Only apply shake transform if actually shaking
	const hasShake = state.shake.x !== 0 || state.shake.y !== 0;
	if (hasShake) {
		ctx.save();
		ctx.translate(state.shake.x, state.shake.y);
	}

	// Atmospheric breathing overlay - modulated darkness (uniform fill, no banding)
	const breathe = Math.sin(state.atmospherePhase) * 0.03 + Math.sin(state.atmospherePhase * 2.3) * 0.02;
	const baseOverlay = 0.15 + breathe;
	ctx.fillStyle = getRgbaStyle(0, 0, 0, baseOverlay * vis);
	ctx.fillRect(-10, -10, width + 20, height + 20);

	// Sheet lightning flash (ambient cloud glow) - uniform fill, no banding
	if (state.sheetLightning.active) {
		ctx.fillStyle = getRgbaStyle(180, 190, 220, state.sheetLightning.opacity * vis);
		ctx.fillRect(-10, -10, width + 20, height + 20);
	}

	// Main lightning flash overlay - dithered radial buffer centered on the bolt,
	// faded via globalAlpha as the strike decays
	if (state.lightning.active) {
		const bw = Math.max(1, Math.round(width * FLASH_BUFFER_SCALE));
		const bh = Math.max(1, Math.round(height * FLASH_BUFFER_SCALE));
		// Quantize the center so nearby strikes reuse the cached buffer
		const cx = Math.round((state.lightning.x * FLASH_BUFFER_SCALE) / 24) * 24;
		const flashAlpha = 0.4 * vis;
		const flash = getDitheredRadialGradient(
			state.flashCache,
			bw,
			bh,
			cx,
			bh * 0.3,
			bw * 0.8,
			[
				{ t: 0, r: 220, g: 225, b: 255, a: flashAlpha },
				{ t: 0.4, r: 200, g: 210, b: 255, a: flashAlpha * 0.6 },
				{ t: 1, r: 180, g: 190, b: 230, a: flashAlpha * 0.1 }
			],
			FLASH_DITHER_AMPLITUDE
		);
		if (flash) {
			ctx.globalAlpha = state.lightning.opacity;
			ctx.drawImage(flash, -10, -10, width + 20, height + 20);
			ctx.globalAlpha = 1;
		}

		// Ground reflection during lightning (small transient strip)
		const reflectAlpha = state.lightning.opacity * flashAlpha;
		const groundGradient = ctx.createLinearGradient(0, height - 30, 0, height + 10);
		groundGradient.addColorStop(0, getRgbaStyle(200, 210, 255, 0));
		groundGradient.addColorStop(1, getRgbaStyle(200, 210, 255, reflectAlpha * 0.3));
		ctx.fillStyle = groundGradient;
		ctx.fillRect(-10, height - 30, width + 20, 40);

		// Lightning wears a faked glow: `shadowBlur` costs far too much per frame here.
		// First pass: draw wider "glow" layer
		ctx.globalAlpha = 0.5 * state.lightning.opacity;
		for (const branch of state.lightning.branches) {
			ctx.beginPath();
			ctx.moveTo(branch.points[0].x, branch.points[0].y);
			for (let j = 1; j < branch.points.length; j++) {
				ctx.lineTo(branch.points[j].x, branch.points[j].y);
			}
			ctx.strokeStyle = getRgbaStyle(150, 180, 255, 0.6 * vis);
			ctx.lineWidth = branch.width * 5;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			ctx.stroke();
		}

		// Second pass: draw core lightning bolt
		ctx.globalAlpha = 1;
		for (const branch of state.lightning.branches) {
			ctx.beginPath();
			ctx.moveTo(branch.points[0].x, branch.points[0].y);
			for (let j = 1; j < branch.points.length; j++) {
				ctx.lineTo(branch.points[j].x, branch.points[j].y);
			}
			ctx.strokeStyle = getRgbaStyle(230, 240, 255, branch.opacity * state.lightning.opacity * vis);
			ctx.lineWidth = branch.width;
			ctx.stroke();

			// Tip flare - bright point at end
			const lastPoint = branch.points[branch.points.length - 1];
			ctx.beginPath();
			ctx.arc(lastPoint.x, lastPoint.y, branch.width * 1.5, 0, Math.PI * 2);
			ctx.fillStyle = getRgbaStyle(255, 255, 255, state.lightning.opacity * 0.8 * vis);
			ctx.fill();
		}
	}

	// Render rain by layers (back to front for proper depth)
	const angle = state.windOffset * 0.04; // More pronounced angle from wind
	const sinAngle = Math.sin(angle);
	const cosAngle = Math.cos(angle);

	const drops = state.drops;
	const len = drops.length;

	// Layer colors - background is dimmer/bluer, foreground is brighter
	const layerColors = [
		[130, 150, 180], // background - more blue/dim
		[150, 170, 200], // midground - original
		[170, 190, 220]  // foreground - brighter
	];

	// Render each layer
	for (let layer = 0; layer < 3; layer++) {
		const [r, g, b] = layerColors[layer];
		const [, sizeMult, opacityBase] = LAYER_CONFIG[layer];

		ctx.lineWidth = 1.5 * sizeMult;

		// Bucket by opacity within this layer
		const bucketAlphas = [
			0.35 * vis * opacityBase,
			0.45 * vis * opacityBase,
			0.55 * vis * opacityBase
		];

		// Bucket 0: opacity < 0.4
		ctx.strokeStyle = getRgbaStyle(r, g, b, bucketAlphas[0]);
		ctx.beginPath();
		for (let i = 0; i < len; i++) {
			const drop = drops[i];
			if (drop.layer !== layer || drop.opacity >= 0.4 * opacityBase) continue;
			ctx.moveTo(drop.x, drop.y);
			ctx.lineTo(drop.x + sinAngle * drop.length, drop.y + cosAngle * drop.length);
		}
		ctx.stroke();

		// Bucket 1: 0.4 <= opacity < 0.5
		ctx.strokeStyle = getRgbaStyle(r, g, b, bucketAlphas[1]);
		ctx.beginPath();
		for (let i = 0; i < len; i++) {
			const drop = drops[i];
			if (drop.layer !== layer) continue;
			const normOpacity = drop.opacity / opacityBase;
			if (normOpacity < 0.4 || normOpacity >= 0.5) continue;
			ctx.moveTo(drop.x, drop.y);
			ctx.lineTo(drop.x + sinAngle * drop.length, drop.y + cosAngle * drop.length);
		}
		ctx.stroke();

		// Bucket 2: opacity >= 0.5
		ctx.strokeStyle = getRgbaStyle(r, g, b, bucketAlphas[2]);
		ctx.beginPath();
		for (let i = 0; i < len; i++) {
			const drop = drops[i];
			if (drop.layer !== layer) continue;
			const normOpacity = drop.opacity / opacityBase;
			if (normOpacity < 0.5) continue;
			ctx.moveTo(drop.x, drop.y);
			ctx.lineTo(drop.x + sinAngle * drop.length, drop.y + cosAngle * drop.length);
		}
		ctx.stroke();
	}

	// Render splashes - batched by progress
	if (state.activeSplashCount > 0) {
		ctx.lineWidth = 1.5;
		const splashPool = state.splashPool;

		const progressMids = [0.17, 0.5, 0.83];

		for (let b = 0; b < 3; b++) {
			const bucketAlpha = (1 - progressMids[b]) * 0.5 * vis;
			ctx.strokeStyle = getRgbaStyle(180, 200, 220, bucketAlpha);
			ctx.beginPath();

			let hasContent = false;
			for (let i = 0; i < MAX_SPLASHES; i++) {
				const splash = splashPool[i];
				if (!splash.active) continue;

				const progress = splash.frame / splash.maxFrames;
				const bucket = progress < 0.33 ? 0 : progress < 0.66 ? 1 : 2;
				if (bucket !== b) continue;

				const radius = splash.size * (1 + progress * 2.5);
				ctx.moveTo(splash.x + radius, splash.y);
				ctx.arc(splash.x, splash.y, radius, 0, Math.PI, true);
				hasContent = true;
			}

			if (hasContent) ctx.stroke();
		}
	}

	if (hasShake) {
		ctx.restore();
	}
}
