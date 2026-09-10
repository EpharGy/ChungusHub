/**
 * Reminders: one short section, near the generation point, that every other framework can put
 * a line into.
 *
 * It exists because a long prompt buries things. A framework's instructions may be perfectly
 * clear a hundred turns up the context and still lose to whatever the model read most
 * recently, and the fix is not more instructions, it is one line where the model is actually
 * looking. Some models need it and some never do, which is why it is a framework you turn on
 * rather than something the base always sends.
 *
 * **It gathers rather than being written into.** Every framework declares its own reminder
 * line; this one receives them already filled and wraps them in a single pair of tags. A
 * bracket-plus-scattered-lines arrangement was the other option and is worse: it depends on
 * every line picking an order between the two brackets, so one framework choosing badly, or
 * being turned off, leaves a section hanging open or a line loose in the prompt. One entry
 * cannot come apart.
 *
 * A framework's reminder is off by default even when this is on. A reminder is a cost paid
 * every turn, and which systems a given model keeps forgetting is not something anything here
 * can guess.
 *
 * See architecture/frameworks.md.
 */
import type { FrameworkBlockDef } from '../blocks';
import type { FrameworkDef } from '../types';

export const REMINDERS_FRAMEWORK_ID = 'reminders';

/** The placeholder the section's own text is built around. */
export const REMINDERS_PLACEHOLDER = '{{reminders}}';

/**
 * The section, as text the reader can edit.
 *
 * It is a template rather than hardcoded tags so the wording, the tag name and any framing
 * around the lines stay the reader's. What it must keep is the placeholder, which is where the
 * gathered lines go; without it the section is a pair of tags with nothing inside.
 */
export const DEFAULT_REMINDERS_TEMPLATE = `<Reminders>
{{reminders}}
</Reminders>`;

export const REMINDERS_BLOCKS: readonly FrameworkBlockDef[] = [
	{
		slot: 'section',
		label: 'Section',
		hint: 'Wraps every reminder the other frameworks contribute. {{reminders}} is where their lines go, one per line.',
		defaultText: DEFAULT_REMINDERS_TEMPLATE,
		placeholders: [REMINDERS_PLACEHOLDER],
		required: [REMINDERS_PLACEHOLDER],
		// The template carries its own tags, so a generated gate would wrap tags in tags.
		gate: false,
		defaultOn: true,
		gathersReminders: true,
		// Depth 0 by default: a reminder four turns up is a reminder of nothing. Both the depth
		// and the role are the reader's to move, because which position a given model actually
		// reads is not something this can know.
		placement: { atDepth: true, depth: 0, role: 'system', order: 0 }
	}
];

export const REMINDERS_FRAMEWORK: FrameworkDef = {
	id: REMINDERS_FRAMEWORK_ID,
	// One word: the section's tags come from the template, but a framework's name still ends
	// up in a gate anywhere else it is used.
	name: 'Reminders',
	icon: 'sliders',
	summary: 'Collects one line from each framework into a short section near the reply.',
	description:
		'A long prompt buries rules. This gathers a single reminder line from every framework ' +
		'that has one switched on and puts them together where the model is actually looking. ' +
		'Each framework decides what its line says, in its own settings; nothing is sent for a ' +
		'framework whose reminder is off.',
	blocks: REMINDERS_BLOCKS,
	/**
	 * Drop the gathered lines into the template.
	 *
	 * Nothing when there are none: the base already skips a gathering block with an empty
	 * list, and this is the second half of the same rule, for a template that somehow reached
	 * here with nothing to say. Empty tags tell the model there is a system here and then say
	 * nothing about it, which is worse than silence.
	 */
	fill(text, input) {
		if (input.reminders.length === 0) return '';
		return text.replaceAll(REMINDERS_PLACEHOLDER, input.reminders.join('\n'));
	}
};
