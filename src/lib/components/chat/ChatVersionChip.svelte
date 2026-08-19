<script lang="ts">
	/**
	 * The chat's character-version pin, surfaced as a quiet chip in the composer's
	 * meta row. Invisible until the bound character actually has versions. Versions are
	 * peer variants, so the chip deliberately carries no "newer version exists" nudge
	 * and no "current" badge: which variant a story plays is a choice, not an update to
	 * apply. Clicking opens the switcher; repinning is instant and fully reversible.
	 *
	 * What this chip shows IS what the chat plays against, for every request it makes.
	 * The library's own active version is irrelevant here. It only seeds the pin when
	 * a chat is born.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { characterLibraryStore } from '$lib/stores/characterLibrary.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';

	let chat = $derived(chatStore.activeChat);
	let entry = $derived.by(() => {
		const cid = chat?.characterId;
		if (!cid) return null;
		return characterLibraryStore.entries.find((e) => e.id === cid && e.type === 'character') ?? null;
	});
	let versions = $derived(entry ? characterLibraryStore.versionsFor(entry.id) : []);

	// The variant this chat plays against. A null pin on a versioned character
	// (possible only for chats created in a sync race) reads as the active variant,
	// which is exactly what generation does with it.
	let pinnedId = $derived(chat?.characterVersionId ?? entry?.activeVersionId ?? null);
	let pinned = $derived(versions.find((v) => v.id === pinnedId) ?? null);

	let open = $state(false);
	let menuRef = $state<HTMLDivElement | null>(null);
	let busy = $state(false);

	$effect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			if (menuRef && !menuRef.contains(e.target as Node)) open = false;
		};
		document.addEventListener('mousedown', onDown);
		return () => document.removeEventListener('mousedown', onDown);
	});

	async function handlePick(versionId: string) {
		if (!chat || busy) return;
		open = false;
		if (versionId === chat.characterVersionId) return;
		busy = true;
		try {
			// The chip itself is the readout: it wears the name of the version this chat plays.
			await chatStore.setChatCharacterVersion(chat.id, versionId);
		} catch (error) {
			toastStore.failed('switch this chat to that version', error);
		} finally {
			busy = false;
		}
	}
</script>

{#if chat && entry && versions.length > 0 && pinned}
	<div class="relative" bind:this={menuRef}>
		<button
			type="button"
			class="chat-version-chip"
			class:is-open={open}
			onclick={() => (open = !open)}
			aria-haspopup="menu"
			aria-expanded={open}
			title={`Character version: ${pinned.name}`}
		>
			<Icon name="branch" class="w-3 h-3" />
			<span class="chat-version-name">{pinned.name}</span>
		</button>

		{#if open}
			<div
				role="menu"
				class="absolute bottom-full left-0 mb-2 z-20 w-[240px] py-1.5 surface-float rounded-lg shadow-md"
			>
				<p class="px-3 pb-1 text-[10px] font-ui uppercase tracking-wide text-text-muted">
					Character version
				</p>
				<div class="max-h-56 overflow-y-auto">
					{#each versions as version (version.id)}
						{@const isPinned = version.id === pinnedId}
						<button
							type="button"
							role="menuitem"
							class="chat-version-row"
							class:is-pinned={isPinned}
							disabled={busy}
							onclick={() => handlePick(version.id)}
						>
							<span class="chat-version-check" class:is-visible={isPinned}>
								<Icon name="check" class="w-3.5 h-3.5" />
							</span>
							<span class="chat-version-row-name">{version.name}</span>
						</button>
					{/each}
				</div>
				<p class="px-3 pt-1 text-[10px] leading-snug font-ui text-text-muted">
					Every request from this chat uses this version.
				</p>
			</div>
		{/if}
	</div>
{/if}

<style>
	.chat-version-chip {
		height: 1.75rem;
		max-width: 10rem;
		padding: 0 0.5rem;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-bg-tertiary) 70%, transparent);
		color: var(--color-text-muted);
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-family: var(--font-ui);
		font-size: 0.67rem;
		font-weight: 600;
		cursor: pointer;
		transition: color 140ms ease, border-color 140ms ease;
	}

	.chat-version-chip:hover,
	.chat-version-chip.is-open {
		color: var(--color-text-primary);
		border-color: color-mix(in srgb, var(--color-accent) 34%, transparent);
	}

	.chat-version-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chat-version-row {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.42rem 0.65rem 0.42rem 0.5rem;
		border: 0;
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.76rem;
		text-align: left;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.chat-version-row:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-bg-tertiary) 85%, transparent);
		color: var(--color-text-primary);
	}

	.chat-version-row.is-pinned {
		color: var(--color-text-primary);
		font-weight: 600;
	}

	.chat-version-check {
		width: 0.9rem;
		flex-shrink: 0;
		display: inline-flex;
		color: var(--color-accent);
		visibility: hidden;
	}

	.chat-version-check.is-visible {
		visibility: visible;
	}

	.chat-version-row-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
