/**
 * The instructions that teach a model to write markers.
 *
 * Nothing generates until the model writes one, so this is the other half of the feature and
 * it lives in code rather than in documentation: the settings page hands it over with a
 * button, because a reader who has just switched the engine on is exactly one copy away from
 * seeing it work.
 *
 * It is not injected anywhere. Where instructions go is the preset author's decision (a
 * preset item, the character's post-history instructions, an author's note), and near the END
 * of the context is what actually gets a small model to comply.
 */

export const MARKER_INSTRUCTIONS = `IMAGE MARKERS

When a moment is worth seeing, write an image marker on its own line at that point in your reply:

[[IMG: PROMPT | AR | SHOT | SEED ]]

PROMPT
Comma-separated tags describing only what a camera would see, in this order:
1. Subject (1girl, 1boy, 2girls)
2. Features: hair, eyes, clothing, expression, body — using only details the story or the character card has established. Do not invent a look.
3. Environment: place, lighting, weather, time of day
4. Modifiers: style, extra visible detail
No metaphors, no emotions, no plot. Only what is visible.

AR — one of: PORTRAIT, SQUARE, LANDSCAPE, CINEMA

SHOT — one of: CLOSE, MEDIUM, WIDE, DUTCH, OVERHEAD, LOWANGLE, HIGHANGLE, PROFILE, BACKVIEW, POV

SEED — one of:
- RANDOM for a new character, a new scene, or a new look
- LOCK to keep the previous picture's look
- a number to match one specific earlier picture

Example:
[[IMG: 1girl, long red hair, green eyes, white sundress, standing in heavy rain, wet cobblestone street, neon reflections | PORTRAIT | MEDIUM | RANDOM ]]

Earlier markers stay in the conversation, so read them before describing a character again and keep their appearance consistent unless the story has changed it. Never mention the marker in your narration.`;
