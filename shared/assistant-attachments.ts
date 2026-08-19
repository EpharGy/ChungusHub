/**
 * The persisted record of what rode along with one assistant user turn.
 *
 * The MODES are decided in exactly one place, the server's workspace-note builder
 * (server/assistant/loop.ts), which owns the size limit and the already-in-context
 * check, and written onto the user row (`assistant_messages.attachments_json`) as the
 * turn starts. The client renders them as chips on that bubble. The shape lives in
 * shared/ because both sides speak it and neither may import the other; a second copy
 * on either side would let a chip state a mode the server never produced.
 */

/** How one attachment actually went to the model: the truth the chip states. */
export type SentAttachmentMode =
	/** Content injected inline. From here on it counts as read (it carries a freshness claim). */
	| 'full'
	/** A highlight longer than the selection cap, so it went inline but clipped. Its own mode
	 *  rather than `full`, because a chip claiming "in full" over a clipped quote is the one
	 *  thing the record exists to prevent. */
	| 'clipped'
	/** A one-line pointer (id + metadata); the assistant reads the content with a tool at need. */
	| 'pointer'
	/** Asked in full but over the size limit, so an honest pointer went instead, nothing partial. */
	| 'oversize'
	/** Asked in full but the conversation already holds it at its current revision, so nothing was re-sent. */
	| 'known';

export interface SentAttachment {
	kind: 'chat' | 'entry' | 'selection' | 'lorebook';
	/** Chat id / library entry id / lorebook id; the chat id for a selection. */
	refId: string;
	/** Which kind of library entry (entry attachments only). */
	entryType?: 'character' | 'persona';
	/** Anchor message of a selection: what its chip navigates to (selection only). */
	anchorMessageId?: string;
	/** Display label resolved server-side at send time, so it names what was actually sent. */
	label: string;
	mode: SentAttachmentMode;
}
