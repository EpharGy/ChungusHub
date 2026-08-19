/**
 * The JSON a skill set travels in, shared by both sides, because both write it and
 * both read it: the Skills section exports and imports it, and every file in
 * `defaults/skills/` is one of these carrying a single skill.
 *
 * Ids are deliberately absent. A skill arriving from a file is a NEW skill in the
 * install that reads it, so an import can never overwrite a skill the user already
 * has, and the same file can be added twice on purpose.
 */
export const SKILLS_FILE_TYPE = 'chungushub.assistantSkills';

export interface SkillFileEntry {
	name: string;
	description: string;
	body: string;
	enabled: boolean;
}

export function serializeSkillsFile(entries: SkillFileEntry[]): string {
	return JSON.stringify({ type: SKILLS_FILE_TYPE, version: 1, skills: entries }, null, 2);
}

function readEntry(raw: unknown): SkillFileEntry | null {
	if (!raw || typeof raw !== 'object') return null;
	const o = raw as Record<string, unknown>;
	const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
	const name = text(o.name);
	const description = text(o.description);
	const body = text(o.body);
	if (!name || !description || !body) return null;
	return { name, description, body, enabled: o.enabled !== false };
}

/**
 * Parse a skills file. Accepts our envelope, a bare array of skills, or a single
 * skill object. Throws with a readable message when nothing usable is in there: a
 * file that yields no skill is a failure the reader has to see, while an unusable
 * entry inside a recognized list is simply left out.
 */
export function parseSkillsFile(json: string): SkillFileEntry[] {
	let data: unknown;
	try {
		data = JSON.parse(json);
	} catch {
		throw new Error('Not valid JSON.');
	}

	let items: unknown[];
	if (Array.isArray(data)) {
		items = data;
	} else if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).skills)) {
		items = (data as { skills: unknown[] }).skills;
	} else {
		items = [data];
	}

	const skills = items.map(readEntry).filter((s): s is SkillFileEntry => s !== null);
	if (skills.length === 0) {
		throw new Error('No skills found. A skill file carries a name, a description, and a body for each skill.');
	}
	return skills;
}
