/**
 * The page's side of the ComfyUI routes.
 *
 * Thin on purpose: every decision about what to ask for was already made (locks applied,
 * seed resolved), and everything about how to ask ComfyUI lives on the server. What is left
 * is four calls and one rule about failure — a generation that fails answers with the
 * message the machine gave, because "image generation failed" is not something a reader can
 * act on and "checkpoint not found: sdxl.safetensors" is.
 */

import type { GenerateRequest, GenerateResult } from '$lib/imagegen/types';

export interface WorkflowEntry {
	name: string;
	source: 'user' | 'bundled';
}

/** Read the server's own error text out of a failed response, whatever shape it came in. */
async function failureText(response: Response, fallback: string): Promise<string> {
	try {
		const body = (await response.json()) as { error?: string };
		if (typeof body?.error === 'string' && body.error.trim()) return body.error;
	} catch {
		// A response that is not JSON tells us nothing the status has not already.
	}
	return `${fallback} (${response.status})`;
}

/** Every workflow the server can run: the reader's own first, then the bundled ones. */
export async function fetchWorkflows(): Promise<WorkflowEntry[]> {
	const response = await fetch('/api/imagegen/workflows');
	if (!response.ok) throw new Error(await failureText(response, 'Could not list workflows'));
	const body = (await response.json()) as { workflows?: WorkflowEntry[] };
	return body.workflows ?? [];
}

/** Is ComfyUI answering at this host? Never throws: not running is an answer. */
export async function pingComfy(host: string): Promise<boolean> {
	try {
		const response = await fetch('/api/imagegen/ping', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ host })
		});
		if (!response.ok) return false;
		const body = (await response.json()) as { online?: boolean };
		return body.online === true;
	} catch {
		return false;
	}
}

/** The checkpoints ComfyUI can load, so the reader picks one instead of typing a filename. */
export async function fetchCheckpoints(host: string): Promise<string[]> {
	const response = await fetch('/api/imagegen/checkpoints', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ host })
	});
	if (!response.ok) throw new Error(await failureText(response, 'Could not read the checkpoint list'));
	const body = (await response.json()) as { checkpoints?: string[] };
	return body.checkpoints ?? [];
}

/**
 * Make one picture. Resolves once it is stored under `images/chat/`, which can be a minute
 * or more: a diffusion model on a busy GPU is slow, and the caller shows that as a state
 * rather than blocking anything.
 */
export async function generateImage(request: GenerateRequest): Promise<GenerateResult> {
	const response = await fetch('/api/imagegen/generate', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(request)
	});
	if (!response.ok) throw new Error(await failureText(response, 'Image generation failed'));
	return (await response.json()) as GenerateResult;
}
