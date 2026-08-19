/**
 * The app's own version, as shown in Settings → About. `package.json` is the only place one is
 * stated; it is not served to the browser, so `vite.config.ts` bakes the number in
 * at build time. Missing means the define is gone, which is a broken build and reads as one.
 */
declare const CHUNGUS_VERSION: string;

export const APP_VERSION: string = CHUNGUS_VERSION;
