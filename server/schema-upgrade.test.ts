/**
 * What a migration is allowed to do to a database that already holds someone's stories.
 *
 * Restoring an old snapshot is not a special path, it is the upgrade path a user who did not
 * open the app all year would take anyway: the app finds an older `_migrations` and runs
 * whatever is missing. That only stays safe while migrations are structure, so the one that
 * rewrites rows has to be a decision made here rather than something discovered later.
 */
import { describe, test, expect } from 'bun:test';

import { MIGRATIONS_FOR_TESTS } from './db';

/**
 * The migrations that deliberately rewrite rows. Every entry must be idempotent, must narrow
 * itself with a WHERE to the rows that actually need it, and must be able to state what it
 * would cost if it ran twice.
 */
const DATA_MIGRATIONS: string[] = [];

describe('migrations', () => {
	test('a migration only moves data when it was decided here', () => {
		const movers = MIGRATIONS_FOR_TESTS.filter((m) =>
			/\b(UPDATE\s+\w+\s+SET|INSERT\s+INTO|DELETE\s+FROM)\b/i.test(m.sql)
		).map((m) => `${m.version}: ${m.name}`);
		expect(movers).toEqual(DATA_MIGRATIONS);
	});
});
