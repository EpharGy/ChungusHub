<script lang="ts">
	/**
	 * The story text of one turn, with any image markers drawn as pictures where they stand.
	 *
	 * The turn's stored text is untouched. What happens here is purely a reading of it: the
	 * content is split on its markers, the runs between them go through the ordinary
	 * display pipeline (display-scope regex → live {{char}}/{{user}} → markdown), and each
	 * marker's place is handed to {@link GeneratedImage}. The model's own marker therefore
	 * survives in the row, which is what lets it see its previous prompts next turn and keep
	 * a character looking like themselves across pictures.
	 *
	 * **A turn with no marker renders exactly as it did before this existed**: one prose
	 * element, one `use:renderedHtml`, no wrapper. That is deliberate rather than tidy — the
	 * split path adds an element per run, and every ordinary turn in the app would otherwise
	 * pay for a feature it does not use.
	 *
	 * Why not put an `<img>` in the HTML instead: the app's sanitizer (utils/markdown.ts)
	 * allows neither `img` nor a relative URL, and widening it would let any model-authored
	 * tag fetch from anywhere — a beacon in a reply. Rendering pictures as components keeps
	 * the sanitizer exactly as narrow as it is.
	 */
	import { renderMarkdown } from '$lib/utils/markdown';
	import { renderedHtml } from '$lib/actions/renderedHtml';
	import { expandSelfRefs } from '$lib/macros';
	import { regexRulesStore } from '$lib/stores/regex-rules.svelte';
	import { splitOnMarkers } from '$lib/imagegen/parse';
	import type { PromptPreset } from '$lib/types/database';
	import GeneratedImage from './GeneratedImage.svelte';
	import type { Message } from '$lib/types/chat';

	interface Props {
		message: Message;
		/** The text as it should read: the row's content, or it glued to a live continuation. */
		content: string;
		/** Turns back from the newest, for depth-bounded display rules. */
		depth: number;
		selfRefChar: string;
		selfRefUser: string;
		/** The preset whose display-scope regex rules this turn is read through. Resolved once
		 *  for the whole transcript by the caller, since the claim belongs to the chat. */
		displayPreset: PromptPreset | null;
	}

	let { message, content, depth, selfRefChar, selfRefUser, displayPreset }: Props = $props();

	/** One run of text, rendered the way every turn has always been rendered. */
	function toHtml(text: string): string {
		return renderMarkdown(
			expandSelfRefs(
				regexRulesStore.forDisplay(text, message.role, depth, displayPreset),
				selfRefChar,
				selfRefUser
			)
		);
	}

	// Pictures are for assistant turns: a marker in something the reader typed is text they
	// wrote, and generating from it would be the app answering its own user.
	const segments = $derived(
		message.role === 'assistant' ? splitOnMarkers(content) : [{ kind: 'text' as const, text: content }]
	);
	const hasMarkers = $derived(segments.some((segment) => segment.kind === 'marker'));
</script>

<!--
	Rendered INSIDE the caller's `.prose .message-prose` element, which keeps the transcript's
	typography (and the find-in-chat `data-search-text` hook) where it has always lived, in
	Message.svelte. Those rules are all descendant selectors, so the runs below inherit them
	whether there is one or a dozen.

	`use:renderedHtml` rather than `{@html}`: it patches its subtree instead of rebuilding it,
	which is what lets a folding panel take a click while the reply is still streaming.
-->
{#if !hasMarkers}
	<div use:renderedHtml={toHtml(content)}></div>
{:else}
	{#each segments as segment, i (i)}
		{#if segment.kind === 'text'}
			<!-- Whitespace between two markers is not a paragraph; rendering it would put an
			     empty line between the pictures the model wrote back to back. -->
			{#if segment.text.trim()}
				<div use:renderedHtml={toHtml(segment.text)}></div>
			{/if}
		{:else}
			<GeneratedImage {message} marker={segment.marker} />
		{/if}
	{/each}
{/if}
