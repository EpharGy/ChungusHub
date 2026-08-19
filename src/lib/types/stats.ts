/**
 * The shape of `getUserStats`: one whole-library aggregate, computed server-side in one
 * pass so no message body ever crosses the bridge (architecture/server-core.md).
 *
 * Two rules run through every figure here, and the screen that renders them has to keep
 * saying them out loud or the numbers quietly mean nothing.
 *
 * **A chat is a tree, so "how many" has two answers.** Effort counts the WHOLE tree: a
 * reroll you threw away is still a reply you asked for and paid for. Story counts the
 * branch each chat is open at, which is what a reader would actually read. Both are here
 * because neither one is the honest answer to both questions.
 *
 * **Nothing is estimated.** A turn that carries no token count is absent from the token
 * totals rather than guessed at from its text, which is why every measured figure ships
 * beside the number of turns it was measured over. An average without its denominator
 * would read as covering the whole library while describing a corner of it, and imported
 * chats make that corner large (architecture/sillytavern-interchange.md).
 */

/** Counts over one set of messages. Words are whitespace-separated runs, the same rule
 *  everywhere, so the story and effort figures are comparable to each other. */
export interface StatsVolume {
	messages: number;
	userMessages: number;
	assistantMessages: number;
	words: number;
	userWords: number;
	assistantWords: number;
}

/** One character, with what the library holds about them folded in by the client. */
export interface StatsCastMember {
	characterId: string;
	chats: number;
	/** Whole-tree counts: how much of your writing went to this character. */
	messages: number;
	words: number;
	/** When you first and last wrote to them, across every chat they appear in. */
	firstAt: number;
	lastAt: number;
}

export interface UserStats {
	/** Library shelf counts, straight from the library tables. */
	library: {
		chats: number;
		characters: number;
		personas: number;
		lorebooks: number;
		lorebookEntries: number;
		/** Summaries chat memory has written across every chat. */
		memoryEpisodes: number;
	};

	/** The whole message forest: every swipe, fork and alternate greeting included. */
	effort: StatsVolume;
	/** The branch each chat is open at, which is the story as it reads. */
	story: StatsVolume;

	/**
	 * Every 15-minute window that saw a message, oldest first, as `[startMs, count]`.
	 *
	 * Fifteen minutes because every real-world UTC offset is a multiple of it, so a client
	 * folding these into ITS local days lands every message on the right day. Bucketing
	 * server-side by UTC day instead would put a reader in a half-hour zone on the wrong
	 * side of midnight, and shipping one timestamp per message to avoid that would ship
	 * the whole table. The client owns days, streaks and hours-of-day from this alone.
	 */
	activity: [number, number][];

	/** Top characters by whole-tree message count, longest-standing first among ties. */
	cast: StatsCastMember[];

	/** What the message forest looks like as a shape, which is this app's own subject. */
	shape: {
		/** Turns written and then left behind: everything off the branch its chat is open at. */
		abandoned: number;
		/** The longest single chat, in turns along one chat's open branch. */
		longestStory: number;
	};

	/** The single biggest of each thing, for the records row. Null on an empty library. */
	records: {
		/** The longest assistant turn, in words, and the chat holding it. */
		longestReply: { chatId: string; words: number } | null;
		/** The longest thing you wrote in one turn. */
		longestUserTurn: { chatId: string; words: number } | null;
		/** The chat with the most turns on its open branch. */
		longestChat: { chatId: string; messages: number } | null;
		firstMessageAt: number | null;
		lastMessageAt: number | null;
	};

	/**
	 * What generation actually cost, over the turns that recorded it and no others.
	 *
	 * Every `…Turns` field is the denominator of the figure above it. They differ from each
	 * other on purpose: a turn can carry a token count and no timing, or a timing and no
	 * reasoning. An imported chat typically carries timings and no prompt tokens at all,
	 * since the format never recorded them.
	 */
	measured: {
		promptTokens: number;
		promptTokenTurns: number;
		completionTokens: number;
		completionTokenTurns: number;
		generationMs: number;
		generationTurns: number;
		firstTokenMs: number;
		firstTokenTurns: number;
		reasoningMs: number;
		reasoningTurns: number;
		/** Every assistant turn, so the screen can say how much of the library is measured. */
		assistantTurns: number;
	};
}
