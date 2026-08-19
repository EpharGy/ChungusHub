/**
 * Assistant session settings: the instructions / skills / permissions a session runs
 * under are FROZEN at its first turn (server/assistant/sessionSettings.ts), because they
 * live in the system prompt and tool list, the cached prefix of every request. Editing a
 * setting therefore does nothing to a conversation already under way until the user
 * applies it here, which re-sends that conversation once at full price.
 */
import { apiGet, apiSend } from '$lib/services/transport';

/** Whether the live Assistant settings differ from what this session froze. A session
 *  that has not taken a turn yet froze nothing and is never stale. */
export async function isSessionSettingsStale(sessionId: string): Promise<boolean> {
	const data = (await apiGet(`/api/assistant-session-settings?sessionId=${encodeURIComponent(sessionId)}`)) as { stale?: boolean };
	return data.stale === true;
}

/** Re-freeze the session on the current settings, the "Apply settings" action. */
export async function applySessionSettings(sessionId: string): Promise<void> {
	await apiSend('/api/assistant-session-settings', 'PUT', { sessionId });
}
