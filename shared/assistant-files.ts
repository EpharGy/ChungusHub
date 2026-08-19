/**
 * Files attached to a Chungus Assistant tab as read-only reference material.
 *
 * The row shape, what a file may turn out to be, and how big one may get all live here
 * because both sides speak them and neither may import the other: the server stores and
 * recognizes, the panel draws chips and a viewer from the same row. A second copy on either
 * side would let a chip name a kind the server never produces, or a picker accept a size the
 * door refuses.
 *
 * Recognition itself is server-side and STRUCTURAL (server/assistant/files-core.ts), so a card
 * renamed `notes.txt` still reads as a card.
 */

/**
 * What a file turned out to be. Deliberately short: every kind here is a shape that can be
 * checked, so there is no `markdown` or `csv`: any text "is" markdown and a comma is not a
 * format, and a guess dressed as a detection would put a claim in the assistant's first look
 * that nothing can stand behind.
 */
export type FileKind =
	| 'sillytavern-card'
	| 'world-info'
	| 'chungus-preset'
	| 'chungus-library-entry'
	| 'chungus-skills'
	| 'sillytavern-chat'
	| 'regex-script'
	| 'json'
	| 'jsonl'
	| 'text';

/** How a kind reads in the assistant's first look, on a chip, and on the viewer's header. */
export const FILE_KIND_LABELS: Record<FileKind, string> = {
	'sillytavern-card': 'SillyTavern character card',
	'world-info': 'SillyTavern world info',
	'chungus-preset': 'ChungusHub preset',
	'chungus-library-entry': 'ChungusHub library entry',
	'chungus-skills': 'ChungusHub assistant skills',
	'sillytavern-chat': 'SillyTavern chat log',
	'regex-script': 'SillyTavern regex script',
	json: 'JSON',
	jsonl: 'JSON Lines',
	text: 'Plain text'
};

/** A stored kind read back as a label. Takes a plain string: a row written by an older
 *  build must not throw its way out of the database because a kind was renamed since. */
export function fileKindLabel(kind: string): string {
	return FILE_KIND_LABELS[kind as FileKind] ?? kind;
}

/**
 * The most an attached file may be, as raw bytes. Checked before the upload starts and
 * again at the door: one number, one wording, and a surface that forgets still cannot get
 * an oversize file through.
 */
export const MAX_ASSISTANT_FILE_BYTES = 10 * 1024 * 1024;

/** One attached file, as every surface speaks it. */
export interface AssistantFile {
	id: string;
	sessionId: string;
	/** The turn it rode. Null while it is still staged in the composer. */
	messageId: string | null;
	/** The name it was uploaded under: what every surface calls it. */
	name: string;
	/** A `FileKind`, held as a string for the older-build reason above. */
	kind: string;
	/** Size of the STORED text, which is what a read spends and the viewer shows. */
	bytes: number;
	lines: number;
	tokenEstimate: number;
	createdAt: number;
}
