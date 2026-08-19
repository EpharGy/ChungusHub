/**
 * The two approval modes as the user meets them: one table, both surfaces.
 *
 * Assistant Settings sets the DEFAULT a new tab is born with and the composer's pill moves one
 * tab on its own, so the same two choices are drawn twice. Naming and describing them here
 * keeps the two surfaces from drifting into two different accounts of the same switch.
 *
 * A mode is one line on the assistant's read < write < delete ladder (server/assistant/
 * types.ts) and nothing else, which is the whole reason a single sentence can describe one:
 * Manual reviews everything that changes anything, Auto reviews nothing.
 *
 * Auto says so in a standing badge and confirms every time it is picked. The text states what
 * is and is not reviewed and where the record of the work is: the reader is picking a working
 * style for a tool whose writes are permanent, and needs the facts to pick well, not a warning
 * about their judgement.
 */
import type { ApprovalMode } from '$lib/types/assistant';

export interface ApprovalModeInfo {
	mode: ApprovalMode;
	label: string;
	/** What this mode reviews and what it applies directly, for the settings page. */
	describe: string;
	/** The same, in a menu-width line, for the composer's pill. */
	hint: string;
	/** Standing mark naming the review this mode does NOT carry out. It states the scope rather
	 *  than a verdict: the reader is choosing a working style, not being told off for it. */
	badge?: string;
	/** Shown when switching INTO this mode, every time: what it stops reviewing, and where the
	 *  record of the work lives instead. Manual needs none: it reviews everything. */
	warning?: { title: string; message: string; confirmLabel: string };
}

export const APPROVAL_MODES: ApprovalModeInfo[] = [
	{
		mode: 'manual',
		label: 'Manual',
		describe: 'Every call that changes something is shown first, with the change it will make. Reads and searches run on their own.',
		hint: 'Changes are shown before they run.'
	},
	{
		mode: 'auto',
		label: 'Auto',
		describe: 'Every call is applied as the assistant works, deletes included.',
		hint: 'Every call is applied directly, deletes included.',
		badge: 'No review',
		warning: {
			title: 'Switch to Auto?',
			message:
				'Auto applies every call as the assistant works, deletes included: characters, personas, lorebooks and messages can be removed without a prompt. The turn lists what was done, and deleted content is not recoverable from the app. Worth choosing when you are giving the assistant work you have already scoped.',
			confirmLabel: 'Use Auto'
		}
	}
];

export function approvalModeInfo(mode: ApprovalMode): ApprovalModeInfo {
	const found = APPROVAL_MODES.find((m) => m.mode === mode);
	if (!found) throw new Error(`Unknown approval mode: ${mode}`);
	return found;
}

/** What a workspace with no stored choice runs. Manual: the assistant's writes are permanent,
 *  so seeing the first one is how a person learns what this thing does to their workspace. */
export const DEFAULT_APPROVAL_MODE: ApprovalMode = 'manual';

/** The stored setting, made safe to run on: anything outside the pair reads as Manual, the
 *  safe direction. */
export function readApprovalMode(stored: string | null | undefined): ApprovalMode {
	return stored === 'manual' || stored === 'auto' ? stored : DEFAULT_APPROVAL_MODE;
}
