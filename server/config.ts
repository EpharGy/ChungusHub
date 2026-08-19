/**
 * Server configuration and filesystem paths.
 * Everything lives under a single data directory so the whole install is portable.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ensurePrivacyMarkers } from './privacy-notice';

// True inside a `bun build --compile` binary: bundled modules live on the
// virtual bunfs mount (/$bunfs, B:\~BUN on Windows), not on disk. Uses the
// standard import.meta.url (not Bun's .path) because Vite also loads this
// module when bundling the config, and DECODES it first: a file URL escapes
// the `~` of the Windows mount to `%7E`, so an undecoded check answers false
// in every Windows portable build. That is not a cosmetic miss: BASE_DIR
// falls back to the working directory, which puts user-data wherever the app
// happened to be launched from and looks for `build/` there too.
const META_URL = decodeURIComponent(import.meta.url);
export const IS_COMPILED = META_URL.includes('$bunfs') || META_URL.includes('~BUN');

// Where the app's files live. From source that's the repo (cwd); as a compiled
// portable binary it's the folder the executable sits in, so double-clicking
// works from anywhere and user-data lands next to the exe.
const BASE_DIR = IS_COMPILED ? dirname(process.execPath) : process.cwd();

// Data directory: env override, else ./user-data under the base dir. Central, valuable, backup-able.
// Exposed as a function because the database binds its path lazily: the test suite points
// CHUNGUS_DATA_DIR at a throwaway dir after modules are already loaded, and an import-frozen
// path would silently send those writes into the real user-data (see ServerDatabase in db.ts).
export function resolveDataDir(): string {
	return resolve(process.env.CHUNGUS_DATA_DIR ?? join(BASE_DIR, 'user-data'));
}
export const DATA_DIR = resolveDataDir();

export function resolveDbPath(): string {
	return join(resolveDataDir(), 'chungushub.db');
}

// Where snapshots of the data dir are kept: a SIBLING of it, never inside it. A snapshot
// written into the folder it is snapshotting would carry every snapshot before it, and the
// next one would carry that. `CHUNGUS_BACKUP_DIR` moves it (onto another drive, say) and is
// read per call for the same reason `resolveDataDir` is: the test suite points both env
// vars at throwaway dirs after these modules are already loaded. The directory is created
// by the first snapshot, not here: an install that never backs up grows no empty folder.
export function resolveBackupDir(): string {
	const override = process.env.CHUNGUS_BACKUP_DIR;
	return resolve(override ?? join(dirname(resolveDataDir()), 'backups'));
}

// Per-entity image storage: images/<category>/ with a thumbnails/ subfolder each. The
// relative path stored in the DB (images/<category>/<file>) encodes the category, so
// serving, copying, and deleting all derive it from the path.
export const IMAGES_ROOT = join(DATA_DIR, 'images');
export const IMAGE_CATEGORIES = ['characters', 'personas', 'backgrounds', 'chat', 'presets'] as const;
export type ImageCategory = (typeof IMAGE_CATEGORIES)[number];

// Files the user attaches to a Chungus Assistant tab as reference material. Read-only for
// their whole life and owned by their `assistant_files` row, so nothing else writes here.
export const ASSISTANT_FILES_ROOT = join(DATA_DIR, 'assistant-files');

export const PRESETS_DIR = join(DATA_DIR, 'presets');
// Per-preset unsaved working copies; live until the user saves or discards.
export const TEMP_PRESETS_DIR = join(PRESETS_DIR, 'temp');
export const ASSISTANT_SKILLS_PATH = join(DATA_DIR, 'assistantSkills.json');
export const ALLOWLIST_PATH = join(DATA_DIR, 'allowlist.json');
// Security switches (allowlist toggle + password hash + sessions). Deleting the
// file restores the defaults. That is the documented lockout recovery.
export const SECURITY_PATH = join(DATA_DIR, 'security.json');

// The built SvelteKit PWA (vite build output).
export const CLIENT_DIR = resolve(join(BASE_DIR, 'build'));

// Bundled default presets shipped with the repo (seeds data/presets on first run).
export const DEFAULT_PRESETS_DIR = resolve(join(BASE_DIR, 'defaults', 'presets'));

// Bundled assistant skills shipped with the repo, one `<id>.json` each in the same
// format an export writes (seeds assistantSkills.json on first read, and backs the
// Defaults browser in Assistant Settings).
export const DEFAULT_SKILLS_DIR = resolve(join(BASE_DIR, 'defaults', 'skills'));

// Bundled example characters shipped with the repo: `<id>.json` plus the pictures under the
// same name (`<id>.<image>` portrait, `<id>/` sprite folder). Seeded into the library ONCE,
// tracked by id, so a character the user deletes is gone for good.
export const DEFAULT_CHARACTERS_DIR = resolve(join(BASE_DIR, 'defaults', 'characters'));

// Bundled workspace background images, served directly from the repo (never copied
// into the data dir; dropping a file in this folder is all it takes to ship one).
export const DEFAULT_BACKGROUNDS_DIR = resolve(join(BASE_DIR, 'defaults', 'backgrounds'));

// Plain HTTP, and only that: a device on the network connects with no certificate
// to install and no warning to click through. Browsers count localhost as a secure
// context, so the host machine still gets the full PWA (installable, clipboard);
// other devices trade those two for having nothing to set up.
// 4242 keeps clear of what this audience already runs: SillyTavern 8000, koboldcpp 5001,
// ComfyUI 8188, Stable Diffusion 7860, Ollama 11434. A collision costs a first launch.
export const PORT = Number(process.env.CHUNGUS_PORT ?? 4242);
export const HOST = process.env.CHUNGUS_HOST ?? '0.0.0.0';

// IPs seeded as always-allowed via env (comma-separated). Never written to the
// allowlist file, handy for dev or scripted setups.
export const ALLOWLIST_ENV = (process.env.CHUNGUS_ALLOWLIST ?? '')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);

export function ensureDirs(): void {
	const dirs = [DATA_DIR, PRESETS_DIR, TEMP_PRESETS_DIR, ASSISTANT_FILES_ROOT];
	for (const category of IMAGE_CATEGORIES) {
		dirs.push(join(IMAGES_ROOT, category), join(IMAGES_ROOT, category, 'thumbnails'));
	}
	for (const dir of dirs) {
		mkdirSync(dir, { recursive: true });
	}
	ensurePrivacyMarkers(DATA_DIR, 'data');
}

// Create the data directories at import time so anything that opens a file under
// DATA_DIR (e.g. the SQLite database) finds its parent directory already present.
// Skipped under `bun test`, where this names the real dir no test writes to (each pins
// its own first), so running it would only leave an empty user-data behind in the repo.
if (process.env.NODE_ENV !== 'test') ensureDirs();
