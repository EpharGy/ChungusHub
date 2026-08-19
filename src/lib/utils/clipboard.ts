/**
 * The app's only way to put text on the clipboard.
 *
 * `navigator.clipboard` exists in a secure context and nowhere else, and a phone
 * reaching this server over the LAN is on plain http. The modern API is therefore
 * missing exactly where copying is hardest to work around. The selection path below
 * is the one that still works there.
 *
 * This throws when the text did not reach the clipboard. Every caller that shows a
 * "copied" state must await it and only flip that state on success: a checkmark over
 * an empty clipboard is worse than a button that visibly failed.
 */
export async function copyText(text: string): Promise<void> {
	if (navigator.clipboard) {
		await navigator.clipboard.writeText(text);
		return;
	}
	if (!selectionCopy(text)) throw new Error('This browser refused the copy.');
}

/** `execCommand('copy')` over a throwaway textarea, the pre-secure-context path. */
function selectionCopy(text: string): boolean {
	const field = document.createElement('textarea');
	field.value = text;
	// Off-screen rather than hidden: a display:none or visibility:hidden node holds no
	// selection, and a node with real size would scroll the page on focus.
	field.style.cssText =
		'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0';
	// Read-only keeps the on-screen keyboard down. iOS is the exception: it selects
	// nothing in a read-only field and needs an editable one with an explicit range.
	field.readOnly = true;
	document.body.appendChild(field);
	try {
		if (/iP(ad|hone|od)/.test(navigator.userAgent)) {
			field.readOnly = false;
			field.contentEditable = 'true';
			const range = document.createRange();
			range.selectNodeContents(field);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
			field.setSelectionRange(0, text.length);
		} else {
			field.select();
		}
		return document.execCommand('copy');
	} finally {
		field.remove();
	}
}
