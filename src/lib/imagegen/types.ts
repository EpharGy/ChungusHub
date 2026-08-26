/**
 * Image-generation domain types.
 *
 * The model writes a marker into its reply; this engine turns each marker into a picture
 * and hangs it on the turn as an attachment. Everything here is deliberately free of
 * Svelte and of `$lib`, so the parser and the request builder stay unit-testable under
 * `bun test` with no DOM and no network.
 */

/** Aspect-ratio tokens a marker may name. Case-sensitive, matched exactly. */
export const AR_TOKENS = ['PORTRAIT', 'SQUARE', 'LANDSCAPE', 'CINEMA'] as const;
export type ArToken = (typeof AR_TOKENS)[number];

/** Camera-framing tokens a marker may name. Each maps to tags prepended to the prompt. */
export const SHOT_TOKENS = [
	'CLOSE',
	'MEDIUM',
	'WIDE',
	'DUTCH',
	'OVERHEAD',
	'LOWANGLE',
	'HIGHANGLE',
	'PROFILE',
	'BACKVIEW',
	'POV'
] as const;
export type ShotToken = (typeof SHOT_TOKENS)[number];

/** A seed as the marker states it, before the story tree resolves LOCK into a number. */
export type SeedToken = 'RANDOM' | 'LOCK' | number;

/**
 * What the parser salvaged while reading one marker.
 *
 * Kept rather than discarded because a marker the model wrote badly and the parser fixed
 * silently is the case a reader most wants explained: the picture came out, but not from
 * the marker they thought they were reading.
 */
export interface RepairMeta {
	/** Fields the marker never named, filled from the parser's own defaults. */
	defaulted: ('AR' | 'SHOT' | 'SEED')[];
	/** Second and later values for a field that may only be stated once. First one wins. */
	duplicateTokens: { AR: string[]; SHOT: string[]; SEED: string[] };
	/** A long bare number survived into the prompt: possibly a seed the model misplaced. */
	possibleSeedInPrompt: boolean;
}

/** A marker that parsed into something generatable. */
export interface ParsedMarker {
	status: 'ok';
	prompt: string;
	ar: ArToken;
	shot: ShotToken;
	seed: SeedToken;
	repairMeta: RepairMeta;
}

/**
 * A marker that could not be salvaged. Only two things are unrecoverable: a marker with
 * nothing in it, and one whose every segment was consumed as a control token, leaving no
 * prompt. Everything else the parser repairs.
 */
export interface MarkerParseError {
	status: 'parse_error';
	reason: 'empty_marker' | 'empty_prompt';
	repairMeta: RepairMeta;
}

export type MarkerResult = ParsedMarker | MarkerParseError;

/** One marker found in a message, with where it sits in the text. */
export interface MarkerMatch {
	/** 0-based position among the markers in this message. The stable key an image is filed under. */
	index: number;
	/** The whole `[[IMG: … ]]` string, kept for error copy that quotes what the model wrote. */
	raw: string;
	/** Character offsets of `raw` within the message content, for splitting the body. */
	start: number;
	end: number;
	result: MarkerResult;
}

/** Width/height in pixels. */
export interface Resolution {
	width: number;
	height: number;
}

/**
 * Everything the reader configures, synced across devices on the `settings` spine under
 * one key. Nothing here is per-chat: a checkpoint and a sampler describe the machine, not
 * the story.
 */
export interface ImagegenSettings {
	/** Master switch. Off means markers are left as text and nothing is ever generated. */
	enabled: boolean;
	/** Generate as soon as a reply lands. Off leaves every marker to its own Generate button. */
	autoGenerate: boolean;
	/** Base URL of the ComfyUI server. Reached from OUR server, so no CORS flag is needed. */
	host: string;
	/** Checkpoint filename exactly as ComfyUI lists it. */
	checkpoint: string;
	/** Workflow JSON filename, resolved against the bundled and user workflow folders. */
	workflow: string;
	negativePrompt: string;
	/** Tags forced onto the front of every positive prompt, before the shot tags. */
	prependPrompt: string;
	/** Tags forced onto the end of every positive prompt, after the model's own. */
	appendPrompt: string;
	steps: number;
	cfg: number;
	sampler: string;
	scheduler: string;
	denoise: number;
	/** Seconds to wait for one image before giving up. */
	timeoutSeconds: number;
	/**
	 * Target size in MB for the pictures this engine has generated, across every chat.
	 *
	 * **0 means no budget and nothing is ever deleted.** That is the shipped value, because
	 * a size limit arriving in a settings sync and quietly reaping a reader's pictures is a
	 * surprise; naming a number is the consent.
	 */
	cacheLimitMb: number;
	/** Sweep down to the budget on its own once a picture lands. Off leaves the button in
	 *  Settings as the only thing that ever runs it. Moot while `cacheLimitMb` is 0. */
	cacheAutoSweep: boolean;
	/** Pixel size per AR token. */
	resolutions: Record<ArToken, Resolution>;
	/** Ignore the marker's AR and use `resolutionLock` for everything. */
	resolutionLockEnabled: boolean;
	resolutionLock: Resolution;
	/** Ignore the marker's SHOT and use `shotLock` for everything. */
	shotLockEnabled: boolean;
	shotLock: ShotToken;
	/** Ignore the marker's SEED and use `seedLockMode` for everything. */
	seedLockEnabled: boolean;
	seedLockMode: 'RANDOM' | 'LOCK' | 'CUSTOM';
	seedLockValue: number;
	/** Tags prepended for each shot token. */
	shotTags: Record<ShotToken, string>;
}

/**
 * The generation request as it reaches the server: every lock already applied, every seed
 * already a number. The client owns that resolution because only it can see the story tree
 * a LOCK seed is resolved against.
 */
export interface GenerateRequest {
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

/** What the server hands back once the picture is on disk. */
export interface GenerateResult {
	/** Server-relative path (`images/chat/<file>`), the same shape every stored picture wears. */
	path: string;
	/** ComfyUI's job id, kept so a reader can look the run up in ComfyUI's own history. */
	promptId: string;
	/** The filename ComfyUI wrote in its output folder. */
	filename: string;
}

/**
 * The record that travels with a generated picture on the message it belongs to.
 *
 * `marker` is the index of the marker in the message text, and it is what binds picture to
 * position: the body is split on markers at render time and this is how each gap finds its
 * image. Everything else is provenance - what was actually sent to ComfyUI, which is not
 * always what the marker asked for once locks have had their say.
 */
export interface GeneratedImageMeta {
	marker: number;
	prompt: string;
	seed: number;
	ar: ArToken;
	shot: ShotToken;
	width: number;
	height: number;
	promptId: string;
	filename: string;
	createdAt: number;
	repairMeta?: RepairMeta;
}
