/**
 * Every framework this build carries.
 *
 * Pure data, the shape `engines/registry.ts` uses and for the same reason: a settings page
 * can be rendered from the list alone and no per-framework wiring lives anywhere else.
 *
 * Deliberately pure, unlike the engines registry, which imports the feature-prompts store
 * for its `enabled` accessors. This list is read by prompt assembly, which may not touch a
 * store, so an app-wide switch belongs beside the callers that already read settings rather
 * than in here. See `FrameworkContext.disabled`.
 *
 * **The list is empty on the frameworks base branch, and that is the whole point of the
 * branch.** The base has to be provable without a framework existing: with none registered,
 * a marker is recognised, claimed by nobody, and stripped before the prompt goes out, which
 * is exactly the behaviour dispatch.ts promises. A framework adds itself here, on its own
 * branch, and needs no edit anywhere else.
 */
import type { FrameworkDef } from './types';

export const FRAMEWORKS: readonly FrameworkDef[] = [];

export function frameworkById(id: string): FrameworkDef | undefined {
	return FRAMEWORKS.find((framework) => framework.id === id);
}
