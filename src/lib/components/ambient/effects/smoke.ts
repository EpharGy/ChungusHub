// Smoke ambient effect - WebGL2 shader-based volumetric smoke
// Renders to an offscreen WebGL canvas, composited onto the main 2D canvas

import type { AmbientParams } from '$lib/types/ambient';

const BUFFER_SCALE = 0.5;

const VERTEX_SHADER = `#version 300 es
precision mediump float;
const vec2 positions[6] = vec2[6](vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0), vec2(-1.0, 1.0), vec2(1.0, -1.0), vec2(1.0, 1.0));
out vec2 uv;
void main() {
	uv = positions[gl_VertexID];
	gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform float time;
uniform vec2 vp;

in vec2 uv;
out vec4 fragColor;

float rand(vec2 p) {
	return fract(sin(dot(p.xy, vec2(1., 300.))) * 43758.5453123);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	float a = rand(i);
	float b = rand(i + vec2(1.0, 0.0));
	float c = rand(i + vec2(0.0, 1.0));
	float d = rand(i + vec2(1.0, 1.0));
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(a, b, u.x) +
		(c - a) * u.y * (1.0 - u.x) +
		(d - b) * u.x * u.y;
}

#define OCTAVES 5
float fbm(vec2 p) {
	float value = 0.;
	float amplitude = .4;
	for (int i = 0; i < OCTAVES; i++) {
		value += amplitude * noise(p);
		p *= 2.;
		amplitude *= .4;
	}
	return value;
}

void main() {
	vec2 p = uv.xy;
	p.x *= vp.x / vp.y;

	float speed = 0.2;
	float details = 7.0;
	float force = 0.9;
	float shift = 0.5;

	vec2 fast = vec2(p.x, p.y - time * speed) * details;
	float ns_a = fbm(fast);
	float ns_b = force * fbm(fast + ns_a + time) - shift;
	float ins = fbm(vec2(ns_b, ns_a));

	// Vertical fade - smoke thins toward the top
	float vertFade = 1.0 - smoothstep(-0.05, 1.05, p.y);

	// Smoke density from turbulence, shaped into wispy clumps
	float density = ins * vertFade;
	density = smoothstep(0.04, 0.48, density);

	// Realistic smoke: light warm gray
	vec3 smokeColor = mix(vec3(0.68, 0.66, 0.64), vec3(0.92, 0.90, 0.87), ins);

	fragColor = vec4(smokeColor, density);
}`;

export interface SmokeState {
	glCanvas: HTMLCanvasElement | null;
	gl: WebGL2RenderingContext | null;
	program: WebGLProgram | null;
	timeLocation: WebGLUniformLocation | null;
	resolutionLocation: WebGLUniformLocation | null;
	time: number;
	bufferWidth: number;
	bufferHeight: number;
}

function compileShader(gl: WebGL2RenderingContext, source: string, type: number): WebGLShader | null {
	const shader = gl.createShader(type);
	if (!shader) return null;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		console.error('Smoke shader compile error:', gl.getShaderInfoLog(shader));
		gl.deleteShader(shader);
		return null;
	}
	return shader;
}

function resizeBuffer(state: SmokeState, width: number, height: number): void {
	if (!state.glCanvas || !state.gl) return;
	const bw = Math.max(64, Math.round(width * BUFFER_SCALE));
	const bh = Math.max(64, Math.round(height * BUFFER_SCALE));
	if (state.bufferWidth === bw && state.bufferHeight === bh) return;
	state.glCanvas.width = bw;
	state.glCanvas.height = bh;
	state.gl.viewport(0, 0, bw, bh);
	state.bufferWidth = bw;
	state.bufferHeight = bh;
}

export function createSmokeState(_count: number, width: number, height: number): SmokeState {
	const state: SmokeState = {
		glCanvas: null,
		gl: null,
		program: null,
		timeLocation: null,
		resolutionLocation: null,
		time: 0,
		bufferWidth: 0,
		bufferHeight: 0
	};

	if (typeof document === 'undefined') return state;

	const glCanvas = document.createElement('canvas');
	const gl = glCanvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false });
	if (!gl) {
		console.error('Smoke effect: WebGL2 not available');
		return state;
	}

	state.glCanvas = glCanvas;
	state.gl = gl;

	const program = gl.createProgram();
	if (!program) return state;

	const vs = compileShader(gl, VERTEX_SHADER, gl.VERTEX_SHADER);
	const fs = compileShader(gl, FRAGMENT_SHADER, gl.FRAGMENT_SHADER);
	if (!vs || !fs) return state;

	gl.attachShader(program, vs);
	gl.attachShader(program, fs);
	gl.linkProgram(program);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		console.error('Smoke shader link error:', gl.getProgramInfoLog(program));
		return state;
	}

	gl.useProgram(program);
	state.program = program;
	state.timeLocation = gl.getUniformLocation(program, 'time');
	state.resolutionLocation = gl.getUniformLocation(program, 'vp');

	// Detach & delete shader objects after linking (they're baked into the program)
	gl.detachShader(program, vs);
	gl.detachShader(program, fs);
	gl.deleteShader(vs);
	gl.deleteShader(fs);

	resizeBuffer(state, width, height);

	return state;
}

export function updateSmoke(
	state: SmokeState,
	width: number,
	height: number,
	params: AmbientParams,
	deltaTime: number
): void {
	state.time += (deltaTime / 1000) * params.speed;
	resizeBuffer(state, width, height);
}

export function renderSmoke(
	ctx: CanvasRenderingContext2D,
	state: SmokeState,
	width: number,
	height: number,
	params: AmbientParams
): void {
	if (!state.gl || !state.glCanvas || !state.program) return;

	const gl = state.gl;
	gl.useProgram(state.program);
	gl.uniform1f(state.timeLocation, state.time);
	gl.uniform2fv(state.resolutionLocation, [state.bufferWidth, state.bufferHeight]);
	gl.drawArrays(gl.TRIANGLES, 0, 6);

	ctx.save();
	ctx.globalAlpha = params.visibility;
	ctx.drawImage(state.glCanvas, 0, 0, width, height);
	ctx.restore();
}
