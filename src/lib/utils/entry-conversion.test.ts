import { describe, it, expect } from 'bun:test';
import { personaDescriptionFromCharacter } from './entry-conversion';

const base = { description: '', personality: '', background: '' };

describe('personaDescriptionFromCharacter', () => {
	it('returns a lone field verbatim, with no heading', () => {
		expect(personaDescriptionFromCharacter({ ...base, description: 'A tall woman.' })).toBe(
			'A tall woman.'
		);
	});

	it('heads each block once there is more than one', () => {
		expect(
			personaDescriptionFromCharacter({
				...base,
				description: 'A tall woman.',
				personality: 'Blunt, warm underneath.'
			})
		).toBe('Description:\nA tall woman.\n\nPersonality summary:\nBlunt, warm underneath.');
	});

	it('skips the fields that carry nothing', () => {
		expect(
			personaDescriptionFromCharacter({ ...base, personality: '  ', description: 'Just this.' })
		).toBe('Just this.');
	});

	it('leaves the character-only fields behind', () => {
		expect(
			personaDescriptionFromCharacter({
				...base,
				description: 'Just this.',
				scenario: 'A tavern at closing time.',
				firstMessage: 'Hey.',
				exampleDialogue: '<START>',
				creatorNotes: 'Play her cold.'
			})
		).toBe('Just this.');
	});

	it('folds an empty sheet to nothing', () => {
		expect(personaDescriptionFromCharacter({ ...base })).toBe('');
	});
});
