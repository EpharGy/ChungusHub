/**
 * The app's own version. `package.json` is the only place one is stated, and it
 * is not shipped beside the executable, so `scripts/package.ts` bakes it into the binary at
 * compile time. From source there is no build step to bake anything, and "dev" is the honest
 * answer rather than a number that would be stale the moment it was written.
 */
declare const CHUNGUS_VERSION: string | undefined;

export const APP_VERSION: string = typeof CHUNGUS_VERSION === 'string' ? CHUNGUS_VERSION : 'dev';
