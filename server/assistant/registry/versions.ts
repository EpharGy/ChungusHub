/**
 * Character-version capabilities: named variants of one character.
 *
 * A character can carry named variants ("pirate", "calmer take", …). The entry's live
 * `data` is ALWAYS the active variant, and every other tool (read_entity, edit_entity,
 * read_chat_context, …) reads and writes that one. A character read names the roster
 * (`versionSummary`) so the active variant is never mistaken for the only card there is,
 * but every variant OPERATION stays here: these two tools are the only version-aware
 * surface: one reads the roster or one parked variant, the other switches / forks /
 * renames / deletes.
 *
 * The server mirrors each save of `data` into the active version's row, so switching is
 * just "point the entry at another variant's data"; the outgoing row is already current.
 */
import { serverDb } from '../../db';
import type { Capability } from './types';
import type { RawChat, RawCharacterVersion, RawLibraryEntry } from '../rows';
import { characterVersionFields } from './entities';
import { stampState } from '../freshness';
import { ToolError, str, ok } from './util';

/** Load a character (versions are characters-only), or a loud error. */
function loadCharacterForVersions(id: string): RawLibraryEntry {
	const raw = serverDb.getLibraryEntry(str(id).trim()) as RawLibraryEntry | null;
	if (!raw || raw.type !== 'character') {
		throw new ToolError(`No character with id "${str(id)}". Only characters have versions; use find_entities kind:character to find the right id.`);
	}
	return raw;
}

/** All versions of an entry, in creation order. Matches the library store and its menu. */
function versionsOf(entryId: string): RawCharacterVersion[] {
	return serverDb.getCharacterVersionsByEntry(entryId) as RawCharacterVersion[];
}

/**
 * The variant roster folded into a character read, so the read cannot present one variant
 * as the whole character: the fields it returned ARE the active variant, and this names
 * which one that is and what else exists. Absent for an unversioned character: a single
 * card has no roster, and saying so on every read would be noise.
 */
export function versionSummary(entryId: string): Record<string, unknown> {
	const entry = serverDb.getLibraryEntry(entryId) as RawLibraryEntry | null;
	if (!entry || entry.type !== 'character') return {};
	const rows = versionsOf(entry.id);
	if (!rows.length) return {};
	return {
		versions: {
			activeId: entry.activeVersionId ?? null,
			list: rows.map((v) => ({ id: v.id, name: v.name, active: v.id === entry.activeVersionId })),
			note: 'The fields above are the ACTIVE variant; the others are parked copies. Read one with read_character_versions, switch or fork with manage_character_versions, and only when the user asks about versions.'
		}
	};
}

/** Chats pinned to a version: deleting one that chats depend on is refused. */
function pinnedChatCount(entryId: string, versionId: string): number {
	return (serverDb.getAllChats() as RawChat[]).filter(
		(c) => c.characterId === entryId && c.characterVersionId === versionId
	).length;
}

export const readCharacterVersions: Capability = {
	name: 'read_character_versions',
	summary:
		"See a character's named variants. Omit `versionId` for the roster (id, name, which is active); pass one to read that parked variant's fields in full. A character with no variants reports `versioned: false`. Its single card is what read_entity already gives you, and every other tool works on the active variant anyway.",
	risk: 'read',
	params: [
		{ name: 'characterId', type: 'string', describe: 'The character whose versions to read.', required: true },
		{ name: 'versionId', type: 'string', describe: "Omit to list all variants; pass one to read that variant's full fields." }
	],
	run(args) {
		const entry = loadCharacterForVersions(str(args.characterId));
		const versions = versionsOf(entry.id);
		const versionId = str(args.versionId).trim();

		// Version rows fold into the character's own freshness revision, so every shape
		// of this read claims the character: one key covers the card and its roster.
		if (versionId) {
			const v = versions.find((x) => x.id === versionId);
			if (!v) throw new ToolError(`No version "${versionId}" on ${entry.identity.name}. List them with read_character_versions (no versionId).`);
			return ok(
				{ type: 'read_character_versions', id: entry.id, name: entry.identity.name, label: `Read version "${v.name}" of ${entry.identity.name}` },
				{ characterId: entry.id, characterName: entry.identity.name, version: { id: v.id, name: v.name, active: v.id === entry.activeVersionId, fields: characterVersionFields(v.data) }, ...stampState(['character', entry.id]) }
			);
		}
		if (!versions.length) {
			return ok(
				{ type: 'read_character_versions', id: entry.id, name: entry.identity.name, label: `${entry.identity.name} has no versions` },
				{
					characterId: entry.id,
					characterName: entry.identity.name,
					versioned: false,
					versions: [],
					note: 'This character is unversioned: a single card, which read_entity/edit_entity already operate on. Forking one (manage_character_versions action:create) is a deliberate opt-in that also pins existing chats to the current state.',
					...stampState(['character', entry.id])
				}
			);
		}
		return ok(
			{ type: 'read_character_versions', id: entry.id, name: entry.identity.name, label: `Listed ${versions.length} version${versions.length === 1 ? '' : 's'} of ${entry.identity.name}` },
			{
				characterId: entry.id,
				characterName: entry.identity.name,
				versioned: true,
				activeVersionId: entry.activeVersionId ?? null,
				versions: versions.map((v) => ({ id: v.id, name: v.name, active: v.id === entry.activeVersionId, updatedAt: v.updatedAt })),
				note: "The active variant IS the character's live data: read or edit it with the normal entity tools. Read a parked variant's fields with read_character_versions(versionId); switch / fork / rename / delete with manage_character_versions.",
				...stampState(['character', entry.id])
			}
		);
	}
};

const VERSION_ACTIONS = ['switch', 'create', 'rename', 'delete'] as const;

export const manageCharacterVersions: Capability = {
	name: 'manage_character_versions',
	summary:
		'Change a character\'s named variants, with ids from read_character_versions. `switch` makes a variant the live card (existing chats keep the variant they were pinned to). `create` forks the current live data into a new named variant and makes it active. The FIRST fork also snapshots the current card as an "Original" and pins every existing chat of the character to it. `delete` removes a variant permanently, and is refused while any chat is pinned to it or if it is the only one.',
	risk: 'write',
	// `delete` here is as permanent as any other delete, and the other three actions are not:
	// only the arguments say which one this call is, so the preview decides rather than the
	// name. Declaring the tool `delete` outright would put a plain `switch` behind Auto's gate.
	escalates: true,
	params: [
		{ name: 'characterId', type: 'string', describe: 'The character to act on.', required: true },
		{ name: 'action', type: 'string', describe: 'What to do.', required: true, enum: VERSION_ACTIONS },
		{ name: 'versionId', type: 'string', describe: 'The target variant (switch / rename / delete). Not used by create.' },
		{ name: 'name', type: 'string', describe: 'The new name (create / rename).' }
	],
	run(args, ctx) {
		const action = str(args.action).trim();
		if (!(VERSION_ACTIONS as readonly string[]).includes(action)) {
			throw new ToolError(`\`action\` must be one of: ${VERSION_ACTIONS.join(', ')}; got "${action}".`);
		}
		const entry = loadCharacterForVersions(str(args.characterId));
		const versions = versionsOf(entry.id);

		if (action === 'create') {
			const name = str(args.name).trim();
			if (!name) throw new ToolError('create needs a `name` for the new version.');
			const now = Date.now();
			let pinnedChats = false;
			// First fork of an unversioned character materializes the current state as an
			// "Original" baseline and anchors every existing chat to it, replicating the
			// library store's opt-in behavior so parked/active rows stay uniformly readable.
			// Atomic: a crash between the four writes must not leave a half-versioned
			// character (parked "Original" + pinned chats but no active pointer).
			const version: RawCharacterVersion = { id: crypto.randomUUID(), entryId: entry.id, name, data: structuredClone(entry.data), createdAt: now + 1, updatedAt: now + 1 };
			serverDb.inTransaction(() => {
				if (!entry.activeVersionId) {
					const baseline: RawCharacterVersion = { id: crypto.randomUUID(), entryId: entry.id, name: 'Original', data: structuredClone(entry.data), createdAt: now, updatedAt: now };
					serverDb.insertCharacterVersion(baseline);
					serverDb.pinUnpinnedChatsToVersion(entry.id, baseline.id);
					entry.activeVersionId = baseline.id;
					pinnedChats = true;
				}
				serverDb.insertCharacterVersion(version);
				entry.activeVersionId = version.id;
				serverDb.updateLibraryEntry(entry);
			});
			ctx.broadcast('library');
			if (pinnedChats) ctx.broadcast('chats');
			return ok(
				{ type: 'manage_character_versions', id: entry.id, name: entry.identity.name, label: `Forked "${name}" from ${entry.identity.name}${pinnedChats ? ' (versioning started)' : ''}` },
				{
					characterId: entry.id,
					action,
					versionId: version.id,
					name,
					active: true,
					...(pinnedChats ? { note: 'This character had no versions: the previous state was saved as "Original" and every existing chat pinned to it.' } : {}),
					...stampState(['character', entry.id])
				}
			);
		}

		// switch / rename / delete all target an existing version of THIS entry.
		const versionId = str(args.versionId).trim();
		if (!versionId) throw new ToolError(`${action} needs a \`versionId\`: list them with read_character_versions.`);
		const version = versions.find((v) => v.id === versionId);
		if (!version) throw new ToolError(`No version "${versionId}" on ${entry.identity.name}. List them with read_character_versions.`);

		if (action === 'rename') {
			const name = str(args.name).trim();
			if (!name) throw new ToolError('rename needs a new `name`.');
			if (name === version.name) throw new ToolError(`That version is already named "${name}".`);
			serverDb.renameCharacterVersion(version.id, name);
			ctx.broadcast('library');
			return ok(
				{ type: 'manage_character_versions', id: entry.id, name: entry.identity.name, label: `Renamed version "${version.name}" → "${name}"` },
				{ characterId: entry.id, action, versionId: version.id, name, ...stampState(['character', entry.id]) }
			);
		}

		if (action === 'switch') {
			if (entry.activeVersionId === version.id) throw new ToolError(`"${version.name}" is already the active version of ${entry.identity.name}.`);
			entry.data = structuredClone(version.data) as RawLibraryEntry['data'];
			entry.activeVersionId = version.id;
			serverDb.updateLibraryEntry(entry);
			ctx.broadcast('library');
			return ok(
				{ type: 'manage_character_versions', id: entry.id, name: entry.identity.name, label: `Switched ${entry.identity.name} to version "${version.name}"` },
				{ characterId: entry.id, action, versionId: version.id, name: version.name, note: "The character's live card is now this variant. Existing chats keep the variant they were pinned to.", ...stampState(['character', entry.id]) }
			);
		}

		// delete
		const pinned = pinnedChatCount(entry.id, version.id);
		if (pinned > 0) {
			throw new ToolError(`${pinned} chat${pinned === 1 ? ' is' : 's are'} pinned to "${version.name}". Repin ${pinned === 1 ? 'it' : 'them'} before deleting this version.`);
		}
		const wasActive = entry.activeVersionId === version.id;
		serverDb.inTransaction(() => {
			if (wasActive) {
				const fallback = versions.find((v) => v.id !== version.id);
				if (!fallback) throw new ToolError(`"${version.name}" is the only version of ${entry.identity.name}. Delete the character itself if that's what you mean.`);
				entry.data = structuredClone(fallback.data) as RawLibraryEntry['data'];
				entry.activeVersionId = fallback.id;
				serverDb.updateLibraryEntry(entry);
			}
			serverDb.deleteCharacterVersion(version.id);
		});
		ctx.broadcast('library');
		// The CHARACTER is re-claimed, not gone-stamped: a variant died, the card lives on.
		return ok(
			{ type: 'manage_character_versions', id: entry.id, name: entry.identity.name, label: `Deleted version "${version.name}" of ${entry.identity.name}` },
			{ characterId: entry.id, action, versionId: version.id, ...stampState(['character', entry.id]) }
		);
	},
	/**
	 * Which of the four actions this is, and (for the one that takes a variant away for good)
	 * the rung that says so. `delete_entity` is not the only permanent delete in the toolset,
	 * so this is what puts a variant delete on the right side of Auto's line.
	 */
	preview(args) {
		const action = str(args.action).trim();
		const entry = loadCharacterForVersions(str(args.characterId));
		const version = versionsOf(entry.id).find((v) => v.id === str(args.versionId).trim());
		const named = version?.name ?? '(no such version)';
		const base = { within: entry.identity.name, target: { kind: 'character', id: entry.id } as const };
		if (action === 'delete') return { ...base, act: 'Delete character version', label: named, risk: 'delete' };
		if (action === 'create') return { ...base, act: 'Fork a new version', label: str(args.name).trim() || '(unnamed)' };
		if (action === 'rename') return { ...base, act: 'Rename version', label: `${named} → ${str(args.name).trim()}` };
		return { ...base, act: 'Switch active version', label: named, notes: [{ text: 'Chats already pinned to another variant keep theirs.' }] };
	}
};
