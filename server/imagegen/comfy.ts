/**
 * The ComfyUI side of image generation: submit a workflow, wait for the picture, store it.
 *
 * This lives on the server rather than in the page, and that is the one decision the rest
 * of the module follows from. A browser talking to ComfyUI directly needs it started with
 * `--enable-cors-header`, which is a setup step every reader has to be walked through and
 * the single most common reason the feature appears broken. The server has no such rule, so
 * ComfyUI runs as it comes out of the box.
 *
 * It also means the picture can be **kept**. A `/view` URL is only good while ComfyUI is
 * running, so a chat read the next morning with the GPU box asleep would show a column of
 * broken images. The bytes are fetched once and written into `images/chat/`, where they are
 * refcounted, backed up and swept exactly like a picture the reader attached themselves.
 *
 * The generated file deliberately does NOT go through `toStoredFormat` (the client-side
 * gate in imageService.ts): that gate is a browser canvas and there is no canvas here. What
 * it protects against is mostly absent anyway — ComfyUI emits png, and the dimensions come
 * from settings that are already clamped to 4096 — so the one thing left unenforced is the
 * ~3.5 MB budget a very large picture could exceed. See architecture/server-core.md.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import { DEFAULT_IMAGEGEN_WORKFLOWS_DIR, IMAGEGEN_WORKFLOWS_DIR } from '../config';
import { saveImage } from '../files';

/** How often to ask ComfyUI whether the job is done. Generation is tens of seconds; a
 *  tighter loop would only add requests to a machine that is busy with a diffusion model. */
const POLL_INTERVAL_MS = 1000;

/** A workflow file, and where it came from. The reader's own copies win over the bundled
 *  ones under the same name, so shipping a new default can never overwrite an edit. */
export interface WorkflowEntry {
	name: string;
	source: 'user' | 'bundled';
}

/** The request as it arrives from the page: every lock applied, the seed already a number. */
export interface ComfyGenerateRequest {
	host: string;
	workflow: string;
	checkpoint: string;
	positivePrompt: string;
	negativePrompt: string;
	width: number;
	height: number;
	seed: number;
	steps: number;
	cfg: number;
	sampler: string;
	scheduler: string;
	denoise: number;
	timeoutSeconds: number;
}

export interface ComfyGenerateResult {
	path: string;
	promptId: string;
	filename: string;
}

/**
 * A workflow name is a filename and nothing else.
 *
 * It arrives from the page, is joined onto a path, and read off disk, so `basename` and an
 * extension check are what keep `../../` out of it. Rejected rather than sanitized: a name
 * that needed cleaning was not the file anyone meant to run.
 */
function safeWorkflowName(name: string): string {
	const clean = basename(name.trim());
	if (!clean || clean !== name.trim() || !clean.toLowerCase().endsWith('.json')) {
		throw new Error(`Invalid workflow name: "${name}"`);
	}
	return clean;
}

/** The reader's workflow folder, made on demand so a fresh install has somewhere to drop one. */
function ensureUserWorkflowDir(): string {
	if (!existsSync(IMAGEGEN_WORKFLOWS_DIR)) mkdirSync(IMAGEGEN_WORKFLOWS_DIR, { recursive: true });
	return IMAGEGEN_WORKFLOWS_DIR;
}

/** Every workflow on offer, the reader's own first and bundled ones after, deduped by name. */
export function listWorkflows(): WorkflowEntry[] {
	const seen = new Set<string>();
	const out: WorkflowEntry[] = [];

	for (const [dir, source] of [
		[ensureUserWorkflowDir(), 'user'],
		[DEFAULT_IMAGEGEN_WORKFLOWS_DIR, 'bundled']
	] as const) {
		if (!existsSync(dir)) continue;
		for (const file of readdirSync(dir)) {
			if (!file.toLowerCase().endsWith('.json') || seen.has(file)) continue;
			seen.add(file);
			out.push({ name: file, source });
		}
	}

	return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Read one workflow, the reader's copy winning over the bundled one of the same name. */
export function readWorkflow(name: string): unknown {
	const clean = safeWorkflowName(name);
	for (const dir of [IMAGEGEN_WORKFLOWS_DIR, DEFAULT_IMAGEGEN_WORKFLOWS_DIR]) {
		const path = join(dir, clean);
		if (!existsSync(path)) continue;
		try {
			return JSON.parse(readFileSync(path, 'utf-8'));
		} catch (error) {
			// A workflow that does not parse is a workflow that would fail at ComfyUI with a
			// far less useful message, so it is named here instead.
			throw new Error(`Workflow "${clean}" is not valid JSON: ${(error as Error).message}`);
		}
	}
	throw new Error(`Workflow "${clean}" not found`);
}

/**
 * Substitute `"{{KEY}}"` placeholders in a workflow.
 *
 * The quotes are part of the pattern, which is what lets a number stay a number: a KSampler
 * refuses `"steps": "24"`, so the whole quoted token is replaced by the JSON encoding of the
 * value rather than being interpolated into the string. It works on the serialized form so
 * a placeholder is found wherever an author put it, at any depth, without walking the graph.
 */
export function fillWorkflow(workflow: unknown, values: Record<string, string | number>): unknown {
	let text = JSON.stringify(workflow);
	for (const [key, value] of Object.entries(values)) {
		text = text.split(`"{{${key}}}"`).join(JSON.stringify(value));
	}
	return JSON.parse(text);
}

/** The placeholder set a workflow may use. Also what the settings page documents. */
export function placeholderValues(req: ComfyGenerateRequest): Record<string, string | number> {
	return {
		CHECKPOINT: req.checkpoint,
		POSITIVE_PROMPT: req.positivePrompt,
		NEGATIVE_PROMPT: req.negativePrompt,
		WIDTH: req.width,
		HEIGHT: req.height,
		SEED: req.seed,
		STEPS: req.steps,
		CFG: req.cfg,
		SAMPLER: req.sampler,
		SCHEDULER: req.scheduler,
		DENOISE: req.denoise
	};
}

/**
 * The host as a URL, http(s) only.
 *
 * The reader points this at their own machine and the server is what dials it, so the check
 * is deliberately narrow: a scheme this does not understand (`file:`, `ftp:`) has no business
 * reaching `fetch` from here. It is the same trust the app already extends to a
 * user-configured Ollama or OpenAI-compatible endpoint.
 */
function normalizeHost(host: string): string {
	let url: URL;
	try {
		url = new URL(host);
	} catch {
		throw new Error(`ComfyUI host is not a valid URL: "${host}"`);
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`ComfyUI host must be http or https, got "${url.protocol}"`);
	}
	return url.origin;
}

/** Is ComfyUI answering? Used by the settings page before it promises anything. */
export async function pingHost(host: string): Promise<boolean> {
	try {
		const response = await fetch(`${normalizeHost(host)}/system_stats`, {
			signal: AbortSignal.timeout(5000)
		});
		return response.ok;
	} catch {
		return false;
	}
}

/**
 * The checkpoints ComfyUI can load, read off its own node metadata.
 *
 * Worth the round trip because the alternative is asking a reader to type a filename
 * exactly, extension included, with no feedback until a generation fails deep inside a
 * workflow.
 */
export async function listCheckpoints(host: string): Promise<string[]> {
	const response = await fetch(`${normalizeHost(host)}/object_info/CheckpointLoaderSimple`, {
		signal: AbortSignal.timeout(10000)
	});
	if (!response.ok) throw new Error(`ComfyUI answered ${response.status} for the checkpoint list`);

	const info = (await response.json()) as Record<string, unknown>;
	const node = info?.CheckpointLoaderSimple as
		| { input?: { required?: { ckpt_name?: unknown[] } } }
		| undefined;
	const names = node?.input?.required?.ckpt_name?.[0];
	return Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string') : [];
}

interface HistoryEntry {
	status?: { status_str?: string; messages?: unknown[] };
	outputs?: Record<string, { images?: { filename: string; subfolder?: string; type?: string }[] }>;
}

/** Ask ComfyUI to run the filled workflow; answer with the job id it files it under. */
async function submitPrompt(origin: string, workflow: unknown): Promise<string> {
	const response = await fetch(`${origin}/prompt`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ prompt: workflow }),
		signal: AbortSignal.timeout(30000)
	});

	if (!response.ok) {
		// ComfyUI puts the actual complaint (a bad checkpoint name, an unknown sampler) in the
		// body, and it is the only useful thing about the failure, so it travels with the error.
		const detail = await response.text().catch(() => '');
		throw new Error(`ComfyUI refused the workflow (${response.status})${detail ? `: ${detail.slice(0, 500)}` : ''}`);
	}

	const data = (await response.json()) as { prompt_id?: string };
	if (!data.prompt_id) throw new Error('ComfyUI accepted the workflow but named no job');
	return data.prompt_id;
}

/**
 * Wait for the job, then say where its picture is.
 *
 * A job that ERRORS is reported as one rather than waited out: ComfyUI keeps the failure in
 * the same history entry, and the alternative is a reader watching a spinner for three
 * minutes to be told it timed out, when the truth was known in two seconds.
 */
async function waitForImage(
	origin: string,
	promptId: string,
	timeoutSeconds: number
): Promise<{ filename: string; subfolder: string; type: string }> {
	const attempts = Math.max(1, Math.round((timeoutSeconds * 1000) / POLL_INTERVAL_MS));

	for (let attempt = 0; attempt < attempts; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

		let entry: HistoryEntry | undefined;
		try {
			const response = await fetch(`${origin}/history/${promptId}`, { signal: AbortSignal.timeout(10000) });
			if (!response.ok) continue;
			const history = (await response.json()) as Record<string, HistoryEntry>;
			entry = history[promptId];
		} catch {
			// A dropped poll is not a failed job: ComfyUI is single-threaded through a GPU and
			// can simply be too busy to answer. The timeout above is what ends this.
			continue;
		}
		if (!entry) continue;

		if (entry.status?.status_str === 'error') {
			throw new Error(`ComfyUI failed the job: ${describeFailure(entry)}`);
		}

		for (const output of Object.values(entry.outputs ?? {})) {
			const image = output.images?.[0];
			// The folder ComfyUI filed it under travels with the filename rather than being
			// assumed to be `output`. A workflow ending in PreviewImage writes to `temp`,
			// which ComfyUI clears on its own restart — the way to run this without ComfyUI
			// keeping a permanent second copy of every picture (we store our own).
			if (image?.filename) {
				return { filename: image.filename, subfolder: image.subfolder ?? '', type: image.type || 'output' };
			}
		}
	}

	throw new Error(`ComfyUI did not finish the picture within ${timeoutSeconds}s`);
}

/** Dig the human-readable half out of ComfyUI's failure messages, which are nested arrays. */
function describeFailure(entry: HistoryEntry): string {
	for (const message of entry.status?.messages ?? []) {
		if (!Array.isArray(message)) continue;
		const [kind, payload] = message as [string, Record<string, unknown> | undefined];
		if (kind === 'execution_error' && payload) {
			const type = typeof payload.exception_type === 'string' ? payload.exception_type : '';
			const text = typeof payload.exception_message === 'string' ? payload.exception_message : '';
			if (type || text) return [type, text].filter(Boolean).join(': ').slice(0, 500);
		}
	}
	return 'no reason given';
}

/**
 * Generate one picture and store it.
 *
 * Sequential by construction: one request, one picture. A message with three markers makes
 * three of these calls one after another, because ComfyUI runs them through one GPU anyway
 * and a queue three deep only makes the first picture arrive later.
 */
export async function generateImage(req: ComfyGenerateRequest): Promise<ComfyGenerateResult> {
	const origin = normalizeHost(req.host);
	const workflow = fillWorkflow(readWorkflow(req.workflow), placeholderValues(req));

	const promptId = await submitPrompt(origin, workflow);
	const { filename, subfolder, type } = await waitForImage(origin, promptId, req.timeoutSeconds);

	const params = new URLSearchParams({ filename, type });
	if (subfolder) params.set('subfolder', subfolder);

	const viewResponse = await fetch(`${origin}/view?${params.toString()}`, {
		signal: AbortSignal.timeout(60000)
	});
	if (!viewResponse.ok) {
		throw new Error(`ComfyUI made "${filename}" but would not hand it over (${viewResponse.status})`);
	}

	const blob = await viewResponse.blob();
	const ext = /\.([a-z0-9]{1,8})$/i.exec(filename)?.[1]?.toLowerCase() ?? 'png';
	// No thumbnail: encoding one needs a canvas, which is a browser. A picture with no
	// thumbnail on disk is answered with the original (`resolveImageFile`), which is exactly
	// the fallback that case exists for.
	const path = await saveImage(blob, null, ext, 'chat');

	return { path, promptId, filename };
}
