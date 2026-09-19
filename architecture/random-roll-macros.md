# {{random}} and {{roll}}: argument macros

Two macros borrowed from SillyTavern, so a preset written there keeps working when it is
imported here: `{{random::red::green::blue}}` picks one option, `{{roll::1d20}}` rolls dice.
They live in [`macros.ts`](../src/lib/macros.ts) with everything else, because that file is
the registry **and** the engine on purpose. Read architecture/macros.md first; this document
covers only what these two do differently, which is a lot for their size.

## This diverges from a stated upstream decision

`architecture/macros.md` says, in the initial commit and in the owner's own words, that what
is deliberately not taken from SillyTavern is "the rest of its macro language: no `::`
arguments, no `{{if}}` blocks, no variables, no author-facing randomness", because
`substitute` being a pure name → string map "is exactly what lets the meters and generation
resolve the same text twice and get the same answer". That is a real invariant and this
feature really does break it. Both halves of that deserve stating plainly rather than being
discovered later:

- **The cost is visible.** A token meter and the send that follows it each resolve the text
  independently, so each rolls independently. The meter prices `{{random::a::verylongoption}}`
  as one option and the send makes another. For dice the drift is a token or two; for a list
  of unevenly-sized options it can be more.
- **The precedent is the clock.** `{{time}}` and its four siblings already read the clock at
  substitution time for exactly the same reason (SillyTavern's do), and macros.md accepts
  that a meter and a send "can land either side of a minute and price a character apart".
  This is the same trade, made for the same reason, at a slightly larger size.

The judgement made here is that a `{{random::...}}` arriving in an imported ST preset is
better rolled than shipped to the model as literal braces. That judgement is not upstream's
to inherit silently: **raise it as an issue and let the owner rule on it before opening a
PR.** A branch existing does not oblige a PR, and this one should not become one by default.

## Syntax, and why it is a superset of ST's

SillyTavern has two macro engines. The default is the regex list in `public/scripts/macros.js`;
the newer registry engine in `public/scripts/macros/` is opt-in behind
`power_user.experimental_macro_engine`. They do not accept the same spellings, so this accepts
the union of both: every form either engine takes resolves here.

| Written | Resolves to | ST default engine | ST new engine |
|---|---|---|---|
| `{{random::a::b::c}}` | one of `a`, `b`, `c` | yes | yes |
| `{{random:a,b,c}}` | one of `a`, `b`, `c` | yes | yes |
| `{{random a,b,c}}` | one of `a`, `b`, `c` | **no** (a colon is required) | yes |
| `{{random:a::b}}` | one of `a`, `b` (`::` wins) | yes | yes |
| `{{random:a\,b}}` | `a,b` (escaped comma) | yes | yes |
| `{{roll::1d20}}` | 1–20 | **no, silently empty** | yes |
| `{{roll:1d20}}` | 1–20 | yes | yes |
| `{{roll 1d20}}` | 1–20 | yes | yes |
| `{{roll::6}}` | 1–6 (bare number is `1d6`) | via `{{roll:6}}` | yes |
| `{{roll::3d6+4}}` | 7–22 | via `{{roll:3d6+4}}` | yes |

**The `{{roll::1d20}}` row is a bug in ST, not a policy.** Its default engine matches with
`/{{roll[ : ]([^}]+)}}/gi`, and `[ : ]` is a character class of exactly ONE character, so the
second colon falls into the capture: the formula becomes `:1d20`, fails validation and returns
an empty string with only a `console.debug`. The `::` form its own documentation uses works
only under the experimental engine. Accepting `::`, `:` and whitespace for both macros fixes
that on the way in rather than reproducing it.

**List splitting follows ST's rule exactly**: the presence of `::` anywhere in the argument
decides, and commas are then literal; otherwise commas split and `\,` escapes one. The one
deliberate difference is that items are trimmed on **both** paths. ST's engines disagree here:
the legacy path trims the comma list but not the `::` one, the newer registry engine trims
both, so this follows the newer one. It only ever shows up in `{{random:: a :: b }}`, where
the spaces are formatting rather than part of the option.

**Dice grammar is droll's, restated rather than depended on.** droll is 116 lines whose entire
language is one regex, `/^([1-9]\d*)?d([1-9]\d*)([+-]\d+)?$/i`. So `1d20`, `d20`, `3d6+4` and
`1d20-2` are valid, while `2d6+1d4`, `4d6kh3` and `0d6` are not. Copying the regex keeps an
imported preset accepting and rejecting identically without adding a dependency for twenty
lines of logic, which also matters because `bun install` is not part of the normal loop here.

**A malformed formula stays literal** rather than resolving to `''` as ST's does. That is this
codebase's rule for everything unresolvable, stated three times in macros.ts: a typo belongs in
the prompt where the author can see it. It is the only behavioural difference from ST, and it
only applies to input ST itself considers malformed.

## Why they resolve at match time

This is the part that is not a style choice. Every other macro resolves through
`resolveMacroValues`, which returns a `Record<string, string>` keyed by macro **name**, built
from `extractMacroNames`, and that dedupes through a `Set`. Two `{{roll::1d20}}` in one
template would therefore share one key, one lookup and one number, printing the same result in
both places forever. Correct-by-construction for deterministic macros; wrong for these.

So `substitute` resolves them inside its `replace` callback, where each occurrence is its own
match. `substitute` already used a function replacement, so this is a branch in a callback
rather than a new mechanism.

**It stays a single pass**, via one combined regex derived from `MACRO_REGEX` and
`ARG_MACRO_REGEX` so the two cannot drift. Running the argument macros as a second `replace`
would re-scan the values the first pass injected, and a lorebook entry or a piece of story text
containing the literal characters `{{random::a::b}}` would then be rolled: the author's own
text executed as a macro. `macros.test.ts` pins that it is not.

## Why pruning needs a veto

`pruneEmptyTagBlocks` drops a tag block when the macros in it all resolve empty, and it decides
that from the same `values` map. Argument macros are not in that map, so pruning cannot see
them at all, and `<scene>Tone: {{random::tense::calm}}. {{memory}}</scene>` with no recall
would have been dropped as empty framing, taking a tone line that had real content in it.

`PruneLevel.hasArgMacro` is the fix: set from the block's own text by shape, inherited from
surviving children, and checked in `shouldPrune` **before** the `substitute` emptiness probe,
which would otherwise roll dice purely to measure emptiness and throw the result away. An
argument macro always produces text (a pick, a roll, or its own literal self when malformed),
so it can never be the empty half of a framing pair.

## Before touching this

- **Both entries are `parameterized`.** The bare name is a shape: `{{random}}` and `{{roll}}`
  written alone resolve to nothing and are flagged by the Prompt Builder's lint, which is
  correct: an author who wrote that forgot the argument. Unlike `{{chatHistoryLastN}}`, the
  lint needs no parser hook, because `extractMacroNames` does not match the argument form at
  all and so never sees a name to flag.
- **Keep `MACRO_REGEX` name-shaped.** It also feeds `extractMacroNames` (the lint, the Library
  stats bar), `pruneEmptyTagBlocks` and prompt-assembly's structural tag scan. Widening it to
  admit `::` would change all of them; a second regex changes none.
- **The dice-count ceiling is not decoration.** droll's grammar allows `9999999999d6`, which is
  a browser hang from one typo. Past `MAX_DICE` the macro stays literal.
- Run `bun run check` and `bun test` after any change here. Coverage is in `macros.test.ts`
  (behaviour and ST parity, leaning on one-sided dice so the arithmetic is exact) and
  `prompt-pruning.test.ts` (the veto).

## Hand-kept couplings

1. `ARG_MACRO_REGEX` → `SUBSTITUTION_REGEX` → `substitute`'s capture positions. The combined
   pattern is built from the two sources, so adding a capture group to either shifts the
   callback's arguments. The callback names all four positions for that reason.
2. `ARG_MACRO_REGEX` ↔ `ARG_MACRO_TEST`. The first is global and carries a `lastIndex`, so
   `.test` on it answers differently on alternate calls; the non-global twin exists to be asked
   repeatedly and is derived from the same source.
3. `hasArgMacro` ↔ `shouldPrune`'s veto ↔ `pruneLevel`'s inheritance from surviving children.
   Drop any one and a block carrying a random pick can be pruned as empty framing.
4. `MacroDef.sample` ↔ `MacroReference.svelte`. The chip copies the whole token now rather than
   building `{{name}}`, so a parameterized macro advertises a spelling that resolves.
   `{{chatHistoryLastN}}` uses the same field, so it is one mechanism and not a special case.
5. `DICE_FORMULA` ↔ droll's own regex. Pinned to it deliberately; loosening it makes an
   imported preset behave differently here than it does in SillyTavern.
