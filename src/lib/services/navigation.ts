/**
 * Deep-link navigation for the Chungus Assistant.
 *
 * Given a NavTarget (the `nav` field a `navigate` tool result carries), route the
 * app to that place and flash it, so the user sees exactly what the assistant meant.
 * Routing goes through the same uiStore/chatStore actions the rest of the UI uses,
 * so it respects the navigation guard (an unsaved library entry can veto the jump).
 */
import { tick } from 'svelte';
import { uiStore } from '$lib/stores/ui.svelte';
import { viewport } from '$lib/stores/viewport.svelte';
import { ANCHOR_PAGES, TAB_FALLBACK_PAGE } from '$lib/config/settings-pages';
import { chatStore } from '$lib/stores/chat.svelte';
import { lorebookStore } from '$lib/lorebook/store.svelte';
import { messageStore } from '$lib/stores/messages.svelte';
import { flashTarget } from '$lib/utils/flash-target';
import type { NavTarget } from '$lib/types/assistant';

export async function navigateTo(target: NavTarget): Promise<void> {
	// On phones the assistant widget is full-screen (inset:0, z200): EVERY deep-link
	// destination below renders behind it, so the tap would look dead. Minimize it
	// first; on desktop the widget floats beside the app and stays.
	if (uiStore.assistantOpen && viewport.isMobile) uiStore.closeAssistant();
	const flush = () => lorebookStore.flush();
	switch (target.kind) {
		case 'setting':
			// The assistant's tab+anchor contract routes onto drill-down pages:
			// the anchor picks the exact page, the tab is the fallback landing.
			// gotoSettingsPage also dismisses an open in-place routing sub-view,
			// which would otherwise sit over the anchor being pointed at.
			uiStore.gotoSettingsPage(ANCHOR_PAGES[target.anchor] ?? TAB_FALLBACK_PAGE[target.tab] ?? 'root');
			// The SettingsPanel router also watches this to re-route if it mounts later.
			uiStore.pendingSettingsAnchor = target.anchor;
			uiStore.openSettings(flush);
			await tick();
			flashSelector(`[data-setting="${cssEscape(target.anchor)}"]`);
			return;
		case 'entry':
			uiStore.openLibraryEntry(target.id, target.entryType, flush);
			return;
		case 'chat':
			revealChat();
			await chatStore.selectChat(target.id);
			return;
		case 'message':
			revealChat();
			await chatStore.selectChat(target.chatId);
			await messageStore.revealMessage(target.messageId);
			return;
	}
}

/** Uncover the chat column before pointing at something in it. The chat host is only
 *  hidden (visibility), not unmounted, so without this a flash plays behind an open
 *  overlay and the button looks dead. Mirrors the panel's own scrollToMessage. (The
 *  full-screen mobile widget is already minimized at the top of navigateTo.) */
function revealChat(): void {
	if (uiStore.activeOverlay) uiStore.closeOverlay(() => lorebookStore.flush());
}

/** Scroll a settings control into view and pulse it. No CSS dependency: uses the
 *  Web Animations API so it works regardless of which tab component rendered it.
 *  Retries across a few frames: a drill-down tab may still be switching to the
 *  sub-page that hosts the anchor (it reacts to uiStore.pendingSettingsAnchor). */
function flashSelector(selector: string, attempts = 12): void {
	const el = document.querySelector<HTMLElement>(selector);
	if (!el) {
		if (attempts > 0) requestAnimationFrame(() => flashSelector(selector, attempts - 1));
		return; // never mounted: opening the right tab is already enough
	}
	flashTarget(el);
}

/** Escape the few chars that would break an attribute selector. Anchors are slugs,
 *  but stay defensive in case a future anchor isn't. */
function cssEscape(v: string): string {
	return v.replace(/["\\]/g, '\\$&');
}
