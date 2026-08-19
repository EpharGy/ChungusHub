/**
 * Asking the user: the one capability whose answer comes from a person rather than the
 * workspace. It stops the turn on a card series, waits as long as it takes, and hands the
 * answers back as an ordinary tool result, so the same turn carries on and acts on them.
 *
 * The free-text box on every card is the panel's, not the model's: options never have to be
 * exhaustive, and nothing here declares one. What comes back says whether the user picked
 * from the options or wrote their own, because "wrote their own" means the options missed.
 */
import type { Capability } from './types';
import type { AskQuestion } from '../types';
import { ToolError, ok } from './util';

/** More than this is a form, not a conversation: the user answers every one of them before
 *  the turn can move, so a long series stalls the work it was meant to steer. */
const MAX_QUESTIONS = 6;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;

/** How much of a question the panel row shows before it is clipped. */
const LABEL_CHARS = 60;

const QUESTION_SCHEMA: Record<string, unknown> = {
	type: 'object',
	additionalProperties: false,
	required: ['question', 'options'],
	properties: {
		question: { type: 'string', description: 'The question, in the user\'s language, answerable by picking from the options below.' },
		options: {
			type: 'array',
			minItems: MIN_OPTIONS,
			maxItems: MAX_OPTIONS,
			items: { type: 'string' },
			description: `${MIN_OPTIONS} to ${MAX_OPTIONS} answers. Each is a genuinely different path, worded so it stands alone on a button. Do not add an "other" or "something else" option: every card already carries a box the user can type their own answer into.`
		},
		multiple: { type: 'boolean', description: 'The user may pick several of these at once. Omit when exactly one answer makes sense.' }
	}
};

/** Validate one question the model wrote, refusing loudly rather than repairing it: a card
 *  with one option is not a choice, and a silently dropped one changes what was asked. */
function parseQuestion(raw: unknown, at: number): AskQuestion {
	const where = `questions[${at}]`;
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ToolError(`${where} must be an object with \`question\` and \`options\`.`);
	const q = raw as Record<string, unknown>;
	const question = typeof q.question === 'string' ? q.question.trim() : '';
	if (!question) throw new ToolError(`${where}.question must be a non-empty string.`);
	if (!Array.isArray(q.options)) throw new ToolError(`${where}.options must be an array of strings.`);
	const options = q.options.map((o) => (typeof o === 'string' ? o.trim() : '')).filter(Boolean);
	if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
		throw new ToolError(`${where}.options must hold ${MIN_OPTIONS} to ${MAX_OPTIONS} non-empty answers, got ${options.length}.`);
	}
	if (new Set(options).size !== options.length) throw new ToolError(`${where}.options repeats an answer. Every option must be a different choice.`);
	if (q.multiple !== undefined && typeof q.multiple !== 'boolean') throw new ToolError(`${where}.multiple must be true or false.`);
	return { question, options, ...(q.multiple === true ? { multiple: true } : {}) };
}

export const askUser: Capability = {
	name: 'ask_user',
	summary:
		'Put multiple-choice questions to the user and wait for their answers. Reach for it when the answer is only theirs to give: which of several things they meant, which direction to take, what they want next. Do NOT use it for anything a read would answer, for wording or formatting you can decide yourself, or to confirm work you have been asked to do.',
	risk: 'read',
	params: [
		{
			name: 'questions',
			type: 'array',
			required: true,
			describe: `1 to ${MAX_QUESTIONS} questions. Each is shown as its own card and the user steps through them, so ask several at once only when they are genuinely independent: a question whose options depend on an earlier answer belongs in a later call.`,
			items: QUESTION_SCHEMA
		}
	],
	async run(args, ctx) {
		if (!ctx.ask) throw new ToolError('There is nobody to ask from here.');
		if (!Array.isArray(args.questions)) throw new ToolError('`questions` must be an array of question objects.');
		if (!args.questions.length) throw new ToolError('`questions` must hold at least one question.');
		if (args.questions.length > MAX_QUESTIONS) {
			throw new ToolError(`\`questions\` holds ${args.questions.length}; at most ${MAX_QUESTIONS} may be asked at once. Ask the most important ones now and the rest after these are answered.`);
		}
		const questions = args.questions.map(parseQuestion);

		const outcome = await ctx.ask(questions);
		if (outcome.stopped) throw new ToolError('The user stopped the turn instead of answering.');

		const answers = questions.map((q, i) => {
			const a = outcome.answers[i] ?? { picked: [], written: null };
			return {
				question: q.question,
				picked: a.picked,
				...(a.written ? { written: a.written } : {}),
				// Their own words mean the options missed the answer, worth knowing before
				// offering the same four again.
				ownAnswer: !!a.written
			};
		});
		const label = questions.length === 1 ? `Asked: ${clip(questions[0].question)}` : `Asked ${questions.length} questions`;
		return ok({ type: 'ask_user', label }, { answers });
	}
};

function clip(text: string): string {
	return text.length > LABEL_CHARS ? `${text.slice(0, LABEL_CHARS - 1).trimEnd()}…` : text;
}
