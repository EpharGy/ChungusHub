/**
 * A copy button on every rendered code block.
 *
 * Added to the parsed HTML by `actions/renderedHtml.ts`, AFTER the sanitizer has run, and
 * never by the markdown renderer. The sanitizer allows no `button`, and widening it would
 * let any reply draw controls of its own; this way the only `button.code-copy` that can
 * exist in rendered prose is one put there by this module, so the click handler below can
 * trust what it finds.
 *
 * It is added to the parsed fragment before that action reconciles it against the screen,
 * not to the live DOM afterwards. The reconciler then sees the button in every version of
 * the HTML, at the same position, and keeps it: a reply still streaming its code block
 * keeps the same button rather than having one removed and re-added on every chunk.
 */
import { copyText } from './clipboard';

const SVG_OPEN =
	'<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="';

// The same paths as Icon.svelte's `copy`, `check` and `warning`. This markup is built as a
// string, outside any component, so it cannot use Icon itself.
const ICONS =
	`<span class="code-copy-idle">${SVG_OPEN}M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg></span>` +
	`<span class="code-copy-done">${SVG_OPEN}M5 13l4 4L19 7"/></svg></span>` +
	`<span class="code-copy-failed">${SVG_OPEN}M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg></span>`;

const TITLE = 'Copy code';

/** Wrap every `pre` under `root` in a `.code-block` holding a copy button. */
export function decorateCodeBlocks(root: ParentNode): void {
	for (const pre of root.querySelectorAll('pre')) {
		const doc = pre.ownerDocument;
		const wrapper = doc.createElement('div');
		wrapper.className = 'code-block';

		const button = doc.createElement('button');
		button.type = 'button';
		button.className = 'code-copy';
		button.title = TITLE;
		button.setAttribute('aria-label', TITLE);
		button.innerHTML = ICONS;

		pre.replaceWith(wrapper);
		wrapper.append(button, pre);
	}
}

const timers = new WeakMap<HTMLButtonElement, ReturnType<typeof setTimeout>>();

/**
 * Click handler for a rendered prose container: copies the block whose button was pressed,
 * and ignores every other click.
 *
 * The state is shown only once the copy has actually landed, as everywhere else in the app
 * (see `utils/clipboard.ts`): a checkmark over an empty clipboard is worse than a button
 * that visibly failed.
 */
export async function handleCodeCopyClick(event: MouseEvent): Promise<void> {
	if (!(event.target instanceof Element)) return;
	const button = event.target.closest('button.code-copy');
	if (!(button instanceof HTMLButtonElement)) return;
	const pre = button.parentElement?.querySelector(':scope > pre');
	if (!pre) return;

	// A fenced block's text ends in the newline that closed the fence, which nobody
	// pasting the code wants.
	const text = (pre.textContent ?? '').replace(/\n$/, '');

	clearTimeout(timers.get(button));
	try {
		await copyText(text);
		button.dataset.state = 'copied';
		button.title = TITLE;
	} catch (e) {
		button.dataset.state = 'failed';
		button.title = `Copy failed: ${e instanceof Error ? e.message : String(e)}`;
	}
	timers.set(
		button,
		setTimeout(
			() => {
				delete button.dataset.state;
				button.title = TITLE;
			},
			button.dataset.state === 'failed' ? 3000 : 1200
		)
	);
}
