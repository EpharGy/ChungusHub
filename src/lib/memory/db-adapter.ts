/**
 * Adapts the app's RPC database to the engine's MemoryDb port.
 *
 * This is the only file in the memory module that touches `$lib`, which keeps the rest of
 * the engine pure and unit-testable. The server owns the SQL and the atomic transactions;
 * this just forwards calls.
 */

import { db } from '$lib/services/database';
import type { MemoryDb } from './types';

export function createMemoryDb(): MemoryDb {
	return {
		getState: (chatId) => db.memGetState(chatId),
		setState: (chatId, patch) => db.memSetState(chatId, patch),
		listEpisodes: (chatId) => db.memListEpisodes(chatId),
		applyBatch: (chatId, result) => db.memApplyBatch(chatId, result),
		applyPromotion: (chatId, result) => db.memApplyPromotion(chatId, result),
		reapEpisodes: (chatId, episodeIds) => db.memReapEpisodes(chatId, episodeIds),
		updateEpisodeContent: (chatId, episodeId, content) => db.memUpdateEpisodeContent(chatId, episodeId, content),
		reset: (chatId) => db.memReset(chatId)
	};
}
