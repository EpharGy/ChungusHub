/**
 * Assistant Skills service: the Chungus Assistant's on-demand procedural guides,
 * managed from the Skills section of Assistant Settings.
 *
 * Every skill is the user's: editable, toggleable and deletable, with no privileged
 * class among them. `getDefaultSkills` reads the catalog the app ships
 * (`defaults/skills/`), which is where a deleted or rewritten skill is fetched back
 * from. Saving always sends the FULL list, in order.
 */
import { apiGet, apiSend, getClientId } from '$lib/services/transport';
import { serializeSkillsFile, type SkillFileEntry } from '$shared/skills-file';

/** Skills live in files, not the settings table, so they need their own reload hook,
 *  same shape as `registerSettingsReload`. The section registers while it is open; with it
 *  closed there is nothing to refresh and the set is read fresh on its next open. */
const reloaders = new Set<() => Promise<void>>();

export function registerSkillsReload(fn: () => Promise<void>): () => void {
	reloaders.add(fn);
	return () => {
		reloaders.delete(fn);
	};
}

/** Called from sync.ts on the `assistant` scope. */
export async function reloadAllSkills(): Promise<void> {
	await Promise.all([...reloaders].map((fn) => fn()));
}

export interface AssistantSkill {
	id: string;
	name: string;
	/** The one-line prompt-index entry: how the assistant decides to read the skill. */
	description: string;
	body: string;
	enabled: boolean;
}

export async function getAllSkills(): Promise<AssistantSkill[]> {
	const data = (await apiGet('/api/assistant-skills')) as { skills: AssistantSkill[] };
	return data.skills ?? [];
}

/** The skills the app ships, read straight from `defaults/skills/`. Never written to,
 *  so this stays a pristine copy however the user's own list has been reworked. */
export async function getDefaultSkills(): Promise<AssistantSkill[]> {
	const data = (await apiGet('/api/assistant-skills/defaults')) as { skills: AssistantSkill[] };
	return data.skills ?? [];
}

/** Persists the full list and returns it as stored. */
export async function saveSkills(skills: AssistantSkill[]): Promise<AssistantSkill[]> {
	const payload = skills.map((s) => ({
		id: s.id,
		name: s.name,
		description: s.description,
		body: s.body,
		enabled: s.enabled
	}));
	const data = (await apiSend('/api/assistant-skills', 'PUT', {
		skills: payload,
		clientId: getClientId()
	})) as { skills: AssistantSkill[] };
	return data.skills ?? [];
}

// ===== Sharing: the JSON file a skill set travels in (shape + parser in $shared) =====

function sanitizeFilename(name: string): string {
	// Strip only what filesystems reject, so unicode names (ğ, ü, 龍, …) stay intact.
	// eslint-disable-next-line no-control-regex
	const cleaned = name.replace(/[\\/:*?"<>|]|[\x00-\x1f]/g, '').trim();
	return cleaned || 'assistant-skills';
}

/** Download the chosen skills as one JSON file. A single skill is named after itself. */
export function downloadSkills(entries: SkillFileEntry[]): void {
	const blob = new Blob([serializeSkillsFile(entries)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `${entries.length === 1 ? sanitizeFilename(entries[0].name) : 'assistant-skills'}.json`;
	a.click();
	URL.revokeObjectURL(url);
}
