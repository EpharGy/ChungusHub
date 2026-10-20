/**
 * Chorus: the open chat's list of characters, and their reading of the newest reply.
 *
 * Shaped like the Sprites store, because it is the same engine shape: read the newest reply
 * once, keep the answer by that reply's id, and never call again for a reply already read, so
 * swiping between siblings and walking branches shows each reply's own reading for nothing.
 *
 * **One difference, and it is the important one: Sprites is pulled, Chorus is pushed.** The
 * sprite layer asks when it draws, so a chat nobody is looking at spends nothing. Chorus feeds
 * the next prompt whether or not its panel is open, so `ensureRead` is driven by the panel
 * component, which is mounted for the app's whole life and draws nothing while closed
 * (components/ui/ChorusWindow.svelte), not by whether anyone is looking.
 *
 * Every write is serialized per kind (`queue`) and computed from the chat's state as it stands
 * once the write before it has landed. Two presses inside one round trip would otherwise each
 * start from the same copy, and the second would quietly undo the first.
 *
 * See architecture/chorus.md.
 */

import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { chatStore } from '$lib/stores/chat.svelte';
import { featurePromptsStore } from '$lib/stores/featurePrompts.svelte';
import { registerFloatingPanel } from '$lib/stores/floating-panels.svelte';
import { toastStore } from '$lib/stores/toast.svelte';
import { askChorusMember, chorusContext } from '$lib/services/chorusService';
import { effectiveGoals } from '$lib/chorus/resolve';
import {
	CHORUS_MAX_MEMBERS,
	clearReading,
	defaultChorusChatState,
	makeChorusMember,
	putReading,
	type ChorusChatState,
	type ChorusGoalKey,
	type ChorusGoals,
	type ChorusMember,
	type ChorusMemberReading,
	type ChorusReading,
	type ChorusReadings
} from '$lib/chorus/state';
import type { Message } from '$lib/types/chat';

/** What the engine is doing about the newest reply, in one word. Sprites' vocabulary. */
export type ChorusStatus = 'read' | 'reading' | 'failed' | 'idle';

/** Per device: whether the panel was left standing. A plain flag, since the panel follows
 *  whichever chat is open rather than belonging to one. */
const OPEN_KEY = 'chorus-open';

function readOpen(): boolean {
	try {
		return localStorage.getItem(OPEN_KEY) === '1';
	} catch {
		return false;
	}
}

function writeOpen(open: boolean): void {
	try {
		if (open) localStorage.setItem(OPEN_KEY, '1');
		else localStorage.removeItem(OPEN_KEY);
	} catch {
		// Storage refused (private window, blocked site data). The panel still opens; it just
		// will not remember it was open after a reload.
	}
}

function newMemberId(): string {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID()
		: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

class ChorusStore {
	open = $state(readOpen());

	/** Replies being read right now. Reactive because the panel's status reads it. */
	private inFlight = new SvelteSet<string>();
	/**
	 * Replies whose reading failed outright, against the exact text that failed: message id →
	 * content. Keyed on the content for Sprites' reason: it stops a broken engine retrying on
	 * every render without outliving what it guards, since an edited reply is a new question.
	 */
	private failed = new SvelteMap<string, string>();

	/** One promise chain per kind of write, so roster edits and reading saves each land in
	 *  order without either having to wait on the other. */
	private rosterQueue: Promise<void> = Promise.resolve();
	private readingQueue: Promise<void> = Promise.resolve();

	private chatId = $derived(chatStore.currentChatState?.chat.id ?? null);

	/** Whether a chat is open to have a list at all. */
	canScope = $derived(this.chatId !== null);

	/** The open chat's roster. */
	state = $derived.by((): ChorusChatState =>
		this.chatId ? chatStore.featureState(this.chatId).chorus : defaultChorusChatState()
	);

	/** The open chat's stored readings. */
	readings = $derived.by((): ChorusReadings =>
		this.chatId ? chatStore.featureState(this.chatId).chorusReadings : {}
	);

	private path = $derived(chatStore.currentChatState?.activePath ?? []);

	/** The newest reply on the branch being read, or null. A user turn waiting for its reply
	 *  leaves this on the reply before it, which is the one the next send will use. */
	newestReply = $derived.by((): Message | null => {
		for (let i = this.path.length - 1; i >= 0; i--) {
			if (this.path[i].role === 'assistant') return this.path[i];
		}
		return null;
	});

	/** The newest reply's own reading, if it has one yet. */
	newestReading = $derived.by((): ChorusReading | null => {
		const reply = this.newestReply;
		return reply ? (this.readings[reply.id] ?? null) : null;
	});

	/** Whether this chat would run at all: both switches on and somebody to run. */
	active = $derived(
		featurePromptsStore.chorusEnabled &&
			this.state.enabled &&
			this.state.members.some((m) => m.enabled)
	);

	status = $derived.by((): ChorusStatus => {
		const reply = this.newestReply;
		if (!reply) return 'idle';
		if (this.inFlight.has(reply.id)) return 'reading';
		if (this.failed.get(reply.id) === reply.content) return 'failed';
		const reading = this.readings[reply.id];
		if (reading?.members.some((m) => m.error)) return 'failed';
		return reading ? 'read' : 'idle';
	});

	/** A member's goals as of the branch on screen (chorus/resolve.ts `effectiveGoals`). */
	goalsFor(member: ChorusMember): ChorusGoals {
		return effectiveGoals(member, this.path, this.readings);
	}

	/** What a member said about the newest reply, if anything. */
	answerFor(memberId: string): ChorusMemberReading | null {
		return this.newestReading?.members.find((m) => m.memberId === memberId) ?? null;
	}

	// ===== The window =====

	toggle(): void {
		this.set(!this.open);
	}

	set(open: boolean): void {
		this.open = open;
		writeOpen(open);
	}

	// ===== The roster =====

	/**
	 * Change the open chat's roster. `change` is handed the roster as it stands once every
	 * earlier write has landed, never the copy the caller happened to be holding.
	 */
	private editRoster(change: (state: ChorusChatState) => ChorusChatState): Promise<void> {
		const chatId = this.chatId;
		if (!chatId) return Promise.reject(new Error('No chat is open, so there is no Chorus list to edit'));
		const run = this.rosterQueue.then(async () => {
			const current = chatStore.featureState(chatId).chorus;
			await chatStore.updateChatFeatureState(chatId, { chorus: change(current) });
		});
		this.rosterQueue = run.catch(() => undefined);
		return run.catch((e) => toastStore.failed('update the Chorus list', e));
	}

	private editMember(memberId: string, change: (member: ChorusMember) => ChorusMember): Promise<void> {
		return this.editRoster((state) => ({
			...state,
			members: state.members.map((m) => (m.id === memberId ? change(m) : m))
		}));
	}

	setChatEnabled(enabled: boolean): Promise<void> {
		return this.editRoster((state) => ({ ...state, enabled }));
	}

	/** Add a character by name. The name is what their lorebook entry fires on, so it is kept
	 *  as typed; a name already on the list is refused rather than added twice. */
	addMember(name: string): Promise<void> {
		const clean = name.trim();
		if (!clean) return Promise.resolve();
		return this.editRoster((state) => {
			if (state.members.length >= CHORUS_MAX_MEMBERS) {
				toastStore.info(`A Chorus list holds at most ${CHORUS_MAX_MEMBERS} characters.`);
				return state;
			}
			if (state.members.some((m) => m.name.toLowerCase() === clean.toLowerCase())) {
				toastStore.info(`${clean} is already on the list.`);
				return state;
			}
			return { ...state, members: [...state.members, makeChorusMember(newMemberId(), clean)] };
		});
	}

	removeMember(memberId: string): Promise<void> {
		return this.editRoster((state) => ({
			...state,
			members: state.members.filter((m) => m.id !== memberId)
		}));
	}

	renameMember(memberId: string, name: string): Promise<void> {
		const clean = name.trim();
		if (!clean) return Promise.resolve();
		return this.editMember(memberId, (m) => ({ ...m, name: clean }));
	}

	setMemberEnabled(memberId: string, enabled: boolean): Promise<void> {
		return this.editMember(memberId, (m) => ({ ...m, enabled }));
	}

	/** Move a member one place up (-1) or down (+1). Order is what the block lists them in. */
	moveMember(memberId: string, by: -1 | 1): Promise<void> {
		return this.editRoster((state) => {
			const from = state.members.findIndex((m) => m.id === memberId);
			const to = from + by;
			if (from < 0 || to < 0 || to >= state.members.length) return state;
			const members = [...state.members];
			[members[from], members[to]] = [members[to], members[from]];
			return { ...state, members };
		});
	}

	/**
	 * Write one of a member's goals. **Writing a goal pins it**: the reader typed it, and an
	 * unpinned goal would be replaced by the agent's own on the very next reading, which reads
	 * as the edit not having worked. Unpinning is how a goal is handed back to the agent.
	 */
	setGoal(memberId: string, key: ChorusGoalKey, text: string): Promise<void> {
		return this.editMember(memberId, (m) => ({
			...m,
			goals: { ...m.goals, [key]: text.trim() },
			pinned: { ...m.pinned, [key]: text.trim().length > 0 }
		}));
	}

	/**
	 * Pin or unpin a goal. Pinning keeps whatever the member currently has, so the goal on
	 * screen is the one that sticks, rather than whatever older text the roster held.
	 */
	setPinned(member: ChorusMember, key: ChorusGoalKey, pinned: boolean): Promise<void> {
		const current = this.goalsFor(member)[key];
		return this.editMember(member.id, (m) => ({
			...m,
			goals: pinned ? { ...m.goals, [key]: current } : m.goals,
			pinned: { ...m.pinned, [key]: pinned }
		}));
	}

	// ===== Reading =====

	/**
	 * Read the newest reply if it has never been read. Called by the panel on every change, so
	 * it must be cheap and idempotent: every reason not to call the model is checked here.
	 *
	 * Never while a reply is streaming. The newest reply on the path is then the one BEFORE the
	 * stream, already read, so nothing would start anyway; the check makes that a rule rather
	 * than a coincidence of what the path holds mid-stream.
	 */
	ensureRead(): void {
		if (!this.active || chatStore.stream !== null) return;
		const reply = this.newestReply;
		const chatId = this.chatId;
		if (!reply || !chatId) return;
		if (this.readings[reply.id]) return;
		if (this.inFlight.has(reply.id)) return;
		if (this.failed.get(reply.id) === reply.content) return;

		// Everything up to and INCLUDING the reply being read. A user turn after it would
		// otherwise be the newest thing every history macro shows, and the lore scan must see
		// the reply itself.
		const index = this.path.findIndex((m) => m.id === reply.id);
		this.inFlight.add(reply.id);
		void this.read(chatId, reply, this.path.slice(0, index + 1));
	}

	/** Read the newest reply again, replacing what it said. What the panel's run button does,
	 *  and what a red status asks for. */
	async runAgain(): Promise<void> {
		const reply = this.newestReply;
		const chatId = this.chatId;
		if (!reply || !chatId) return;
		this.failed.delete(reply.id);
		if (this.readings[reply.id]) await this.writeReadings(chatId, (r) => clearReading(r, reply.id));
		this.ensureRead();
	}

	/**
	 * Throw away a reply's reading so it is read again: the Chorus half of
	 * `spriteStore.invalidateMessage`, called from the same two places in `messageStore` and
	 * gated by the caller on the matching Re-read setting. A no-op when there is nothing to
	 * throw away.
	 */
	async invalidateMessage(messageId: string): Promise<void> {
		const chatId = this.chatId;
		if (!chatId) return;
		this.failed.delete(messageId);
		if (!chatStore.featureState(chatId).chorusReadings[messageId]) return;
		await this.writeReadings(chatId, (r) => clearReading(r, messageId));
	}

	private writeReadings(chatId: string, change: (r: ChorusReadings) => ChorusReadings): Promise<void> {
		const run = this.readingQueue.then(async () => {
			const current = chatStore.featureState(chatId).chorusReadings;
			await chatStore.updateChatFeatureState(chatId, { chorusReadings: change(current) });
		});
		this.readingQueue = run.catch(() => undefined);
		return run;
	}

	private async read(chatId: string, reply: Message, messages: Message[]): Promise<void> {
		try {
			const state = this.state;
			const readings = this.readings;
			const members = state.members.filter((m) => m.enabled);
			const ctx = chorusContext(messages);

			const askOne = async (member: ChorusMember): Promise<ChorusMemberReading> => {
				const goals = effectiveGoals(member, messages, readings);
				try {
					const answer = await askChorusMember({
						ctx,
						name: member.name,
						goals,
						pinned: member.pinned,
						cast: members.filter((m) => m.id !== member.id).map((m) => m.name)
					});
					return { memberId: member.id, name: member.name, ...answer };
				} catch (e) {
					console.error(`[chorus] ${member.name} did not answer:`, e);
					const error = e instanceof Error ? e.message : String(e);
					return { memberId: member.id, name: member.name, want: '', intends: '', goals, error };
				}
			};

			let answers: ChorusMemberReading[];
			if (featurePromptsStore.chorusSequential) {
				answers = [];
				for (const member of members) answers.push(await askOne(member));
			} else {
				answers = await Promise.all(members.map(askOne));
			}

			const failures = answers.filter((a) => a.error);
			if (failures.length === answers.length) {
				// Nothing to store: a reading of nothing but errors would inject nothing and
				// still count as read, so the reply would never be tried again on its own.
				this.failed.set(reply.id, reply.content);
				toastStore.failed('hear from the Chorus characters', new Error(failures[0]?.error));
				return;
			}
			if (failures.length) {
				toastStore.warning(
					`Chorus: ${failures.map((f) => f.name).join(', ')} did not answer. The others go into the next reply.`
				);
			}

			const live = (chatStore.currentChatState?.allMessages ?? []).map((m) => m.id);
			const reading: ChorusReading = { at: Date.now(), members: answers };
			await this.writeReadings(chatId, (r) => putReading(r, reply.id, reading, live));
		} catch (e) {
			this.failed.set(reply.id, reply.content);
			console.error('[chorus] reading the newest reply failed:', e);
			toastStore.failed('hear from the Chorus characters', e);
		} finally {
			this.inFlight.delete(reply.id);
		}
	}
}

export const chorusStore = new ChorusStore();

registerFloatingPanel({
	id: 'chorus',
	order: 50,
	label: 'Chorus',
	icon: 'users',
	isOpen: () => chorusStore.open,
	toggle: () => chorusStore.toggle(),
	disabled: () => !chorusStore.canScope,
	// The one thing a closed panel must still say: the characters did not answer, so the next
	// reply is going out without them.
	badge: () => chorusStore.active && chorusStore.status === 'failed',
	tooltip: () => {
		if (!chorusStore.canScope) return 'Chorus · open a chat to give its characters a voice';
		if (chorusStore.active && chorusStore.status === 'failed') return 'Chorus · some characters did not answer';
		if (chorusStore.open) return 'Hide the Chorus panel';
		return chorusStore.active ? 'Chorus · on in this chat' : 'Chorus';
	}
});
