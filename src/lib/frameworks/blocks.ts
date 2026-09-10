/**
 * Editable injected blocks: the shape every framework's settings turned out to be.
 *
 * A framework that writes into the prompt wants the same three things every time: a piece of
 * text the reader can edit, a switch, and somewhere for it to land. The date framework wanted
 * exactly that; so does a cycle tracker's note about how visible its signs should be; so does
 * anything that follows. Building each one its own settings component meant a public file
 * growing a branch per framework, naming each of them, which is both tedious and, for a
 * framework that must not be named in a public file at all, impossible.
 *
 * So a framework DECLARES its blocks and the base does the rest: stores them, renders their
 * editors, and injects them. `FrameworkDetail` renders any framework's settings without
 * knowing whose they are, and a framework can add a tunable without a single line changing
 * anywhere else.
 *
 * **Order is fixed by the declaration and is not the reader's to set.** Everything else about
 * placement can be, but order is the only coordination frameworks have with each other, and a
 * control for it is a control for putting a line outside the section it belongs in.
 *
 * See architecture/frameworks.md.
 */
import type { FrameworkEntry } from './types';

/** What a framework declares about one of its editable blocks. */
export interface FrameworkBlockDef {
	/** Stable within the framework. It keys the stored settings and names the block in the
	 *  prompt trace, so renaming one loses whatever the reader had written. */
	slot: string;
	/** The heading above the editor. */
	label: string;
	/** One or two lines under the heading: what this text does and when it is sent. */
	hint: string;
	/** What the reader gets before they touch anything. */
	defaultText: string;
	/**
	 * Placeholders the framework substitutes, named for the editor's hint.
	 *
	 * A short fixed list per framework, because an injected block is the one text in a prompt
	 * that macro expansion never reaches: entry content is expanded and THEN decorated. The
	 * framework fills its own through {@link FrameworkDef.fill}, and anything else survives as
	 * written rather than silently becoming an empty string.
	 */
	placeholders?: readonly string[];
	/**
	 * Placeholders whose absence makes the block pointless, for the editor's warning.
	 *
	 * The gentle half of a rule worth having twice: text that stopped doing its job while
	 * still looking like sensible instructions is the failure nobody notices.
	 */
	required?: readonly string[];
	/** Wrap in an XML gate named for the framework. */
	gate: boolean;
	/** Whether a chat that has never touched this gets the block. */
	defaultOn: boolean;
	/**
	 * A REMINDER line rather than a block of its own.
	 *
	 * It is not injected where it stands. It is handed to the reminders framework, which
	 * gathers every running framework's line into one section near the generation point. A
	 * reminder with nothing to gather it is not injected at all, because a bare line outside
	 * its section is noise rather than a reminder.
	 *
	 * This is the one thing the base knows about a specific framework, and it is deliberate:
	 * a reminders section is a place several frameworks write into at once, which nothing
	 * else here can express. Everything else about it is an ordinary block.
	 */
	reminder?: boolean;
	/**
	 * This block IS the reminders section: every other framework's reminder line is gathered
	 * into it.
	 *
	 * The framework that declares it receives them in `FrameworkInjectInput.reminders` and
	 * writes them into its own text. It is not injected at all when nothing was gathered:
	 * empty tags tell the model there is a system here and then say nothing about it.
	 */
	gathersReminders?: boolean;
	/** Where it lands by default, and whether the reader may move it. A reminder's placement
	 *  belongs to the section that gathers it, so it has none of its own. */
	placement?: {
		atDepth: boolean;
		depth: number;
		role: FrameworkEntry['role'];
		/** Fixed by declaration. Lower is injected first. */
		order: number;
	};
}

/** What a reader has changed about one block. Every field is optional: absent means the
 *  declaration's default, so a chat that has touched nothing stores nothing. */
export interface StoredBlock {
	on?: boolean;
	text?: string;
	atDepth?: boolean;
	depth?: number;
	role?: FrameworkEntry['role'];
}

/** One framework's app-wide config: its blocks, and whatever else it wants to keep. */
export interface FrameworkConfig {
	blocks?: Record<string, StoredBlock>;
}

const ROLES: readonly FrameworkEntry['role'][] = ['system', 'user', 'assistant'];

/** Read one framework's stored config back, degrading rather than throwing. Values nothing
 *  here wrote are dropped rather than guessed at. */
export function normalizeFrameworkConfig(raw: unknown): FrameworkConfig {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const stored = (raw as Record<string, unknown>).blocks;
	if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
	const blocks: Record<string, StoredBlock> = {};
	for (const [slot, value] of Object.entries(stored as Record<string, unknown>)) {
		if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
		const v = value as Record<string, unknown>;
		const out: StoredBlock = {};
		if (typeof v.on === 'boolean') out.on = v.on;
		// An empty box reads as "I have not set this" rather than "send nothing": a reader who
		// wants nothing sent turns the block off, which is the control that says so.
		if (typeof v.text === 'string' && v.text.trim()) out.text = v.text;
		if (typeof v.atDepth === 'boolean') out.atDepth = v.atDepth;
		if (typeof v.depth === 'number' && Number.isFinite(v.depth)) {
			out.depth = Math.max(0, Math.min(100, Math.trunc(v.depth)));
		}
		const role = ROLES.find((r) => r === v.role);
		if (role) out.role = role;
		blocks[slot] = out;
	}
	return { blocks };
}

/** One block as it stands after the reader's changes, ready to render or to inject. */
export interface ResolvedBlock {
	def: FrameworkBlockDef;
	on: boolean;
	text: string;
	atDepth: boolean;
	depth: number;
	role: FrameworkEntry['role'];
	/** Required placeholders the text no longer contains. Empty when it is fine. */
	missing: readonly string[];
	/** True when the text is still exactly what shipped, so an editor can offer a reset only
	 *  when there is something to reset to. */
	isDefault: boolean;
}

const NO_PLACEMENT = { atDepth: false, depth: 0, role: 'system' as const, order: 0 };

export function resolveBlock(def: FrameworkBlockDef, stored: StoredBlock | undefined): ResolvedBlock {
	const place = def.placement ?? NO_PLACEMENT;
	const text = stored?.text ?? def.defaultText;
	return {
		def,
		on: stored?.on ?? def.defaultOn,
		text,
		atDepth: stored?.atDepth ?? place.atDepth,
		depth: stored?.depth ?? place.depth,
		role: stored?.role ?? place.role,
		missing: (def.required ?? []).filter((p) => !text.includes(p)),
		isDefault: text === def.defaultText
	};
}

/** Every declared block of one framework, resolved against what the reader stored. */
export function resolveBlocks(
	defs: readonly FrameworkBlockDef[] | undefined,
	config: unknown
): ResolvedBlock[] {
	const stored = normalizeFrameworkConfig(config).blocks ?? {};
	return (defs ?? []).map((def) => resolveBlock(def, stored[def.slot]));
}
