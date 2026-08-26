/**
 * Image-generation types both halves need.
 *
 * Only what crosses the RPC bridge lives here. The engine's own domain types - markers,
 * settings, the request shape - stay in `src/lib/imagegen/types.ts`, because the server
 * never reads a marker or a setting: the page resolves every lock before it calls, and
 * hands the server a request with the answers already in it.
 *
 * The cache is the one thing that goes the other way. Only the server can see the files on
 * disk, so the page has to ask, and the shape of the answer belongs to neither side alone.
 */

/**
 * What a sweep of the generated-image cache did, or would do if asked.
 *
 * One shape for both, because the preview IS the run with the deletes left out. The totals
 * are always the whole cache, so the page draws "312 pictures, 448 MB" from the same call
 * that tells it what a sweep would take.
 *
 * Counted in FILES rather than in attachments. A branch or a fork copies the attachment
 * list, so several turns can name one picture and it is freed only when the last of them
 * lets go; counting references would promise bytes no delete can return.
 */
export interface ImagegenCacheReport {
	/** Every picture the engine has generated that a row still names and disk still holds. */
	totalFiles: number;
	totalBytes: number;
	/** What the sweep took, or would take. */
	files: number;
	bytes: number;
	/** `createdAt` range of what was taken, null when nothing was. Free from the same walk,
	 *  and the one thing that says whether a sweep is reaching into recent work. */
	oldest: number | null;
	newest: number | null;
}
