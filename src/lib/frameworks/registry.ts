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
 * **The date framework is here on the base branch, and every other framework is not.** The
 * list was empty for a while and the emptiness was described as the point: the base has to
 * work with nothing registered, and a marker no framework claims must be recognised, claimed
 * by nobody and stripped. That property is still asserted, and nothing about it depended on
 * this array -- every test injects its own `FrameworkContext.frameworks`, so an empty
 * registry was a convention rather than the proof it was taken for.
 *
 * Reminders is here on the same terms: it is a place other frameworks write into, so it can no
 * more live on a branch of its own than a shelf can. A framework declaring a reminder line and
 * finding nothing to gather it would simply lose the line.
 *
 * What the date framework has that a tracker does not is a counterpart already in the base:
 * `ChatFrameworkState.mode` offers `marker`, and only this framework can make a marker
 * appear. Shipping the mode on one branch and the thing that satisfies it on another would
 * leave the base carrying half a feature. A framework that computes over a marker an author
 * wrote has no such counterpart and still adds itself on its own branch, needing no edit
 * anywhere else.
 */
import { DATE_FRAMEWORK } from './date';
import { REMINDERS_FRAMEWORK } from './reminders';
import type { FrameworkDef } from './types';

export const FRAMEWORKS: readonly FrameworkDef[] = [DATE_FRAMEWORK, REMINDERS_FRAMEWORK];

export function frameworkById(id: string): FrameworkDef | undefined {
	return FRAMEWORKS.find((framework) => framework.id === id);
}
