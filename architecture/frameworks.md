# Frameworks: architecture & maintenance

A **framework** is a named, deterministic computation over story state that renders a line of text into the prompt. Frameworks themselves are declared downstream of this branch, which holds none: an age that advances, a season turning, a debt coming due are all the same shape, and the point of the base is that none of them teaches it what they are about.

It exists for one reason, and the reason is narrow on purpose: **a lorebook cannot do arithmetic.** Grouping and per-chat enable/disable are already a book's job (a book is a group of entries; the composer's setup chip attaches one to a story and mutes one out of it), and entries already have constant/keyword firing, AND/NOT logic, inclusion groups, recursion, sticky, cooldown and trigger filters. What no entry can do is compute, and a model asked to do modulo over a day counter gets it wrong often enough that the error compounds over a long story. So this is not a second lorebook and must not grow into one: it is a roster-free calculation that rides the lorebook already there.

## The marker is the config AND the placement

Everything a framework knows about a character is written **in that character's lorebook entry**, as one marker:

```text
Rowan, 24, red hair, brusque.
@season[harbor, len=90, start=14]
```

The first field is the subject key and is required; the rest are `name=value` in any order. **The key is a NAME, not a slug**: spaces, apostrophes, periods and non-Latin scripts are all fine, because whoever writes a marker types the character's name. It is folded (lowercased, internal whitespace collapsed) so the same person written two ways is one subject, and everything that keys on it, the per-chat suppression list included, must fold identically or it silently never matches. **The author's own spelling is kept beside it** and is what a framework prints: a status line can end up grouped with others at a depth in the chat, where nothing but the name says who it is about. Field *names* stay strict: that vocabulary is defined by the app, not by a person. That shape is load-bearing rather than cosmetic: **a field added later must never change what an existing marker means**, which all-positional cannot promise once there are four of them. The key is not decoration either: the per-chat suppression list and each framework's own state map key on it, and the reader-facing surfaces label their rows with it.

Two things follow, and they are why the design has no roster at all:

- **The character is portable.** Entry content round-trips as plain text, so a marked-up book carries its configuration into another chat, another install, and out through World Info export and back. `sillytavern.ts` needs no mapping and there is nothing to migrate. The cost is that a book exported to SillyTavern carries the marker into ST's prompt as literal prose, because nothing there consumes it; that is the price of portability and the reason the marker stays short.
- **"Who is tracked" is derived, never stored.** It is answered by "which fired entries carried a marker", freshly, every assembly.

**The marker is deliberately not a macro and must not become one.** It does not match `MACRO_REGEX` (name-shaped by design), so `substitute` leaves it whole and `extractMacroNames` never reports it: the two systems do not interact at all. Keeping the sigil un-brace-shaped is what makes that obvious to a reader, and it means a marker in a build without its framework reads as odd text rather than as a broken macro.

**An unconsumed marker is REMOVED, never passed through.** Framework off, subject suppressed, id misspelled, body malformed: the marker still goes, and what is left is the computed line or nothing. This is the opposite of the macro engine's *"unknown names stay literal so typos surface"* rule, and the two are different kinds of thing. A macro typo is the author's own prose and belongs on screen, while a marker is machine configuration that is noise in a prompt under every circumstance. What replaces "surface the typo" is a `FrameworkRecord` per marker saying exactly what happened to it, the same doctrine as the lorebook's scan records.

## The seam: two lines in the lorebook engine

Entry content is read at exactly two places in [`lorebook/engine.ts`](../src/lib/lorebook/engine.ts), and **both are decorated**:

| Site | What it feeds |
|---|---|
| the recursion feed | the entry's text as a **scan source**, so it can wake other entries |
| `renderLorebookBlock` | the entry's text as it goes **into the prompt** |

The render site is the feature. The recursion site is one extra line that unlocks an **optional authoring trick, not a requirement**: a decorated line reading `Storm Season` can wake an entry keyed on that phrase, which is how per-phase behaviour notes can exist in the prompt only while their phase is live. Nobody has to use it and nothing breaks if nobody does, but skipping that site would remove the possibility silently.

`LorebookDecorator` is `(entry, text) => string`, held to the same purity contract `expand` already carries there, because assembly runs at least twice (the token meter, then the send) and the two must agree byte for byte.

**Two orderings at the render site are load-bearing:**

- decoration runs **after** the emptiness check, so an entry whose own content expanded to nothing keeps its honest `empty` verdict instead of being resurrected by a decorator;
- and **before** `budget.count`, so what a framework adds is priced like any other lore rather than letting the block outgrow `budgetPercent` after the fact.

The field is **required** on `resolveLorebooks`, unlike every other option there, on the `LorebookLinks` rule that a key a caller could leave out is a layer it can drop in silence. `NO_DECORATION` is how a caller means it on purpose.

## Nothing accumulates, and that is the design

A framework is a pure function: `phase = f(day, its own fields)`. Nothing is advanced, incremented, folded or remembered per turn. Everything follows from that, and most of it is the absence of work:

- **Branches, swipes and regenerations are correct with no code**, not because anything tracks them but because there is no accumulated state to be wrong. Go back four turns and the day is whatever that path says; the line recomputes.
- **Meter and send agree** by construction.
- **Nothing needs cleanup**: no per-message column, no event log, no reconciliation when a branch is deleted.

The one thing that would break this property is an automatically *rolled* outcome, because a roll has to be remembered. If one is ever wanted it belongs in `serverDb.commitGeneratedTurn` (the transaction that already spends one-shot steering and stores the lore trace) so it fires once after a persisted success, and only then does a per-message record earn its place.

Where randomness is wanted without storage, **derive it, never roll it**: hash a stable key and read the result. A per-character pick seeded on `subjectKey:phase` is fixed for that character forever, which reads as a trait rather than as dice, and it costs nothing to store.

## Where the day comes from

The day belongs to the base, not to the first framework that wanted one: story time is
infrastructure, and an age that advances, a season turning and a debt coming due all want the
same integer from the same place. A framework may own the instruction that puts a marker in
the transcript; the number those markers resolve to is read in one place.

[`day.ts`](../src/lib/frameworks/day.ts) resolves it from a per-chat **mode**, and the two
modes do not overlap at all:

| Mode | Reads | Ignores | Sources |
|---|---|---|---|
| `manual` | the chat's stored day, set by `/day` | the transcript, and the clock | `manual` |
| `marker` | the latest date in play | the stored day | `clock`, `time-marker` |

**The mode replaced a ladder, and the way the ladder failed is the reason it exists.** It
scanned backwards and let the first turn carrying a marker decide, with the stored day as a
floor. A chat halted on the 1st and resumed on the 10th still had a nine-day-old
`<Time: ...>` as the newest thing the transcript said, so the day stayed nine days behind and
every framework downstream computed against a day the story had already left. No ordering
fixes that: the stale marker is a perfectly good answer to the question the ladder was
asking. The reader could not correct it either, because the stored day was only ever consulted
when nothing stated one.

The modes are exclusive because their **units** are. `marker` yields a serial date in the
hundreds of thousands; `manual` yields whatever small number the reader typed. A fallback
across them does not degrade, it lies: every cycle reading `day mod length` lands on an
unrelated point and nothing on screen says so.

### In marker mode, the LATEST date wins

Not the newest turn's. Today is always a candidate, and a transcript date beats it only by
being further ahead. Two things follow, and both are the point:

- **A resumed chat is current.** The old marker simply loses to today.
- **A narrated jump forward sticks.** A turn saying the story is now three weeks on states a
  date beyond today and keeps winning until the clock catches up to it. A clock alone can
  never know a scene skipped three weeks; only the story can say so.

The cost is real and unguarded: a date the model invents far in the future wins permanently,
because nothing can be later than a date that has not happened. `manual` mode and an edit to
the offending turn are the two ways out. A cap on how far ahead a marker may reach was
considered and left out, because every value for it is arbitrary and a story set in 2400 is
not rarer than a model typo.

### The marker, in two shapes

| Shape | Written | In the transcript |
|---|---|---|
| visible | `<Time: 11:53 AM, Sunday September 6, 2026>` | markdown escapes it; drawn as written |
| hidden | `<!-- Time: 11:53 AM, Sunday September 6, 2026 -->` | an HTML comment; no browser draws it |

**Both are read forever, whichever one is currently being asked for.** Only the instruction
switches. A reader who changes the setting leaves a chat whose older turns are all in the
other shape, and a parser reading only the current shape would go blind to that history the
moment the switch was flipped.

Only the DATE is read. The clock time inside says nothing about which day it is, and the
weekday is ignored: it is redundant against the date, and trusting it would mean disagreeing
with a model that got it wrong. It is asked for anyway, because a weekday beside a long-form
date gives the model a second reading of the same fact to check itself against, and models are
noticeably worse at naming the weekday for a bare ISO date.

**The month must be a NAME.** `parseDate`'s ISO branch is anchored, so it cannot match inside
a marker: `<Time: 18:02, Thursday 2026-11-04>` parses to nothing, and the day silently stops
moving while everything on screen still looks right.

### The clock is an argument, not a read

`day.ts` reads no clock itself. `today` arrives as a number the caller measured, via
`todaySerial(at)`, so the module stays pure and a test can pin it. The impurity is one default
argument in `frameworkDecorator`, and the dispatcher's determinism contract is untouched
because it is handed a number.

What a real-time mode genuinely costs is narrower than "impurity": a token meter that ran at
23:59 and a send at 00:01 price different days. That window is a mode asking to be told the
real time, and it is the same window `{{date}}` in a lorebook entry has always had.

### `<Day N>` is gone

It read `<Day 47>` out of a turn and was removed with the ladder. It only ever worked if the
model incremented an integer across turns, which models do not do reliably, and every drift
moved every cycle silently. Manual mode covers what it was for, including a setting with no
Gregorian calendar at all.

### A fixed epoch, and what that buys

A date resolves against a FIXED origin. An earlier version counted from the first dated turn
on the path, which read far better (day 1 was the day the story started) and was quietly
wrong: that array is only ever the history that happens to be loaded and in budget, so its
beginning walks forward as a chat grows and every day number would shift under a long story
without a word. Nothing here may depend on how far back the path reaches.

The serial that produces is large, and it costs nothing, because a framework consuming it needs
only `day mod length`. That is what lets a framework's own fields stay small and calendar-free:
a framework can take an optional offset in days and no absolute anchor at all, so nothing in a
character's entry has to name a year and a western or a fantasy setting needs no editing.

The epoch is 0001-01-01 rather than 1970 or 1900, purely so a historical setting produces
positive numbers. `serialOf` builds it with `setUTCFullYear` rather than `Date.UTC`, because
that constructor reads years 0-99 as 1900+year and would put a story set in AD 47 into 1947
without a word. `todaySerial` is the one place LOCAL accessors are used, because it has to
agree with `{{date}}`, which goes through `toLocaleDateString` and is the reader's own wall
clock.

**A framework taking an offset should DERIVE an unset one rather than defaulting it to zero.**
While the day count is smaller than whatever the framework's own period is, everything modulo
that period collapses together: on story day 3, `3 mod 27` and `3 mod 30` are both 3. That is
immediately harmless for a serial date and wrong for a long time under a small manual day.
Hashing the subject key spreads a cast from the first turn and stores nothing.

Reading the path rather than a counter is also what keeps the property the rest of this design
has: nothing accumulates, so a branch is correct because a path IS a branch. Swipe away the
turn that stated a date and the day is whatever the surviving path says.

## A framework can inject a block, not only answer a marker

`compute` and `inject` are separate jobs rather than a required one and an optional extra, and
a framework may have either or both:

| | Answers `@id[...]` | Injects a block |
|---|---|---|
| a marker-driven tracker | yes | no |
| date | no | yes |

A tracker decorates text an author already wrote. The date framework contributes an
**instruction addressed to the model**, which belongs to no lorebook entry and no character, so
there is nothing for a marker to sit inside. A framework with neither is a settings row and
nothing else: not an error, almost certainly a mistake.

**An injected block rides the lorebook's own pipeline.** `frameworkBooks` (apply.ts) returns a
synthetic book, and the caller adds it to its own. That is the whole design: an injected block
is text in a prompt, so it has to be placed somewhere, priced against the budget that caps
lore, and visible in the trace that explains the prompt. `renderLorebookBlock` answers all
three. A second channel beside it would answer them again, differently, and the second answer
is the one that goes wrong: a block outside the lore budget is a block the meter does not
count, and the meter and the send stop agreeing with nothing on screen saying so.

The entries are `constant` (addressed to the model, so nothing for a key to match), at depth
**0** (an instruction about THIS reply is worth nothing four turns up), and `order: 0` (ahead
of ordinary lore in the budget's greedy admission; a framework block that lost its place to a
character description would take the day with it).

**Macro expansion never reaches an injected block.** Entry content is expanded and THEN
decorated, so a framework emitting `{{date}}` would ship those braces to the model. That is
why `FrameworkInjectInput` carries `now`, and why the date framework imports the same
formatters `{{time}}`, `{{weekday}}` and `{{date}}` use rather than writing its own.

**The memory store deliberately injects no framework books**, unlike the prompt and the live
meters. Those blocks tell the model what to write in its next reply, and a summariser is not
writing one: telling it to open with a time marker would put a marker in the summary, which
the day resolver would then read back as the story stating a date. Decoration is still shared,
because that rewrites text an author wrote.

## The date framework

It is the counterpart to `marker` mode, and the only framework registered on the base branch.
The mode is a base field; nothing but this can make a marker appear; shipping the two on
different branches would leave the base carrying half a feature. Every other framework still
adds itself on its own branch and needs no edit anywhere else.

Two settings, both per chat, because both are facts about one story:

| Setting | Lives in | Why there |
|---|---|---|
| `mode` (`manual`/`marker`) | `ChatFrameworkState.mode` | the base's own resolver reads it |
| `shape` (`visible`/`hidden`) | `byFramework.date` | only this framework reads it; the parser takes both shapes regardless |

**In `manual` mode it injects nothing at all.** A reader driving the day with `/day` has not
asked to be told the real date and would be actively misled by one, so the block is absent
rather than present-and-ignored.

The round trip is the coupling that matters: this framework writes the marker the model is
asked to copy, and `day.ts` reads it back. `date.test.ts` asserts it across both shapes and a
run of dates, because if those two ever disagree the day silently stops moving while every
surface still looks correct.

## Showing what the markers are doing

A framework's whole effect can be an **absence**. A marker that was stripped and a subject who
was never tracked look identical in a prompt: a line that is not there. Every strip is already
recorded with a reason (`FrameworkRecord`), and until something displays those records the only
way to tell a typo from an untracked subject is to diff the prompt against the entry by hand.

[`panel.ts`](../src/lib/frameworks/panel.ts) is the derivation a surface reads. It is pure: it
is handed the books, the state and the path, and it answers from them.

**It runs the real dispatcher and keeps its records**, rather than reading the markers a second
time and routing them by hand. A second reading is a second answer to "what does this marker
do", and a panel that can disagree with the prompt is worse than no panel. Same rule the
lorebook's Test scan follows, for the same reason.

Which entries it reads is the caller's choice, and the two answers are different questions
rather than a coarse and a fine version of one:

- **Given `injectedEntryIds`**, only markers in entries whose text reached the prompt. This is
  what the model is being told right now, and it is the only readable view of a book carrying
  fifty subjects.
- **Without it**, every marker in every book the chat carries. This is the troubleshooting
  view, and the only one that can show a marker whose entry never fires at all.

Neither is a superset of the other in usefulness, so **a surface must say which one it is
showing**: a reader who took a row from the unfiltered view as proof the line reached the
prompt would be wrong.

That set is ids, not a trace, so this module never learns what a lorebook scan is. Which
statuses count as reaching the prompt is the lorebook's own question, and `lorebookWasInjected`
is its answer. A caller wanting the filtered view should build the set from a LIVE scan rather
than the trace stored on the last turn: a stored trace describes a prompt that was already
sent, and the answer has to move when a book is edited or a subject held out.

`FrameworkRecord` carries `subject`, the author's own spelling of the key, alongside the folded
`key` that decides identity. The folded one is what suppression and framework slices are keyed
on; the spelling is what a row is labelled with, because nobody writes her name in lower case.

## The base/framework line

The base owns what every framework would otherwise reinvent; a framework owns what only it can know.

| Base | A framework |
|---|---|
| the registry (`FrameworkDef`) | its own registry entry |
| the marker grammar and parser | interpreting its own fields |
| the dispatcher: find, route, replace, strip | `compute()` |
| the `decorate` seam and its four callers | its own arithmetic and output |
| the story day, and `/day` | |
| `ChatFrameworkState` | its slice of `byFramework` |

**The day belongs to the base, not to the first framework that wanted one.** Story time is infrastructure: an age, a season, a debt coming due all want the same integer from the same source.

The rule to hold when something new wants a home: **anything true of the CHARACTER goes in the entry; anything true of ONE STORY goes on the chat.** There is no third place, and wanting one is a signal that something has been filed under the wrong one of those two. A per-character store owned by the framework was considered and rejected: it would need a cleanup sweep against the entries (any store needing periodic reconciliation with another source of truth *is* a second source of truth), it would need an archive-wide marker scan, which the app deliberately never does, and it would break the portability the marker design exists for.

## Storage

**Configuration only, and it is small.** Two places, and the bigger one is not in the database:

1. **The character**, in the lorebook entry's marker.
2. **Per chat**, [`ChatFrameworkState`](../src/lib/frameworks/chat-state.ts) on `ChatFeatureState`: the day, the subject keys this story holds out, and an opaque per-framework map. It rides that column rather than a table of its own, so deleting a chat deletes it, duplicating a chat copies it, and the `chats` sync scope already broadcasts it. No DDL, no migration, no reaping, no sync scope. Same argument architecture/notepad.md makes.

`suppressed` and the framework slices exist for one reason each and it is the same reason: **the entry is shared and the story is not.** Rowan's marker says who she is in every chat that triggers it; that she is not being tracked in this one, or owes a debt in this one, is not a fact about her.

Clamped in the normalizer rather than only at the input, because `getAllChats` is `SELECT *`: every chat's blob rides every chat-list fetch on every device, and a blob that arrived oversized must not be re-saved at its own length.

**One accepted consequence:** a cycle anchor lives in the marker, so it is the same anchor in every story. Two chats both on day 40 put a character at the same point. That is coherent rather than wrong, and a story that wants her elsewhere starts its own day counter elsewhere; a per-chat anchor override should not be built before that actually chafes.

## Files

- [`types.ts`](../src/lib/frameworks/types.ts): `FrameworkDef`, `FrameworkComputeInput`, `FrameworkInjectInput`, `FrameworkRecord`, `FrameworkContext`. No logic.
- [`marker.ts`](../src/lib/frameworks/marker.ts): the grammar, `findMarkers`, `hasMarker`. Pure.
- [`dispatch.ts`](../src/lib/frameworks/dispatch.ts): `applyFrameworks`. Pure. The whole of the base's runtime.
- [`day.ts`](../src/lib/frameworks/day.ts): the mode, the marker grammar, `resolveDay`, `todaySerial`, and the serial/date arithmetic. Pure; the clock arrives as an argument.
- [`chat-state.ts`](../src/lib/frameworks/chat-state.ts): the per-chat blob, its normalizer and caps, and `parseDayArg`.
- [`registry.ts`](../src/lib/frameworks/registry.ts): every framework this build carries. Pure data, deliberately store-free (prompt assembly reads it).
- [`apply.ts`](../src/lib/frameworks/apply.ts): the ONE place a chat's state becomes a `LorebookDecorator`, and the ONE place it becomes injected books.
- [`date/`](../src/lib/frameworks/date/index.ts): the date framework. The only one registered on this branch, because it is the counterpart to a base field.
- Tests: [`frameworks.test.ts`](../src/lib/frameworks/frameworks.test.ts), which runs against a **fake** framework declared in the test, so the base is provable without a real one; [`day.test.ts`](../src/lib/frameworks/day.test.ts) and [`date/date.test.ts`](../src/lib/frameworks/date/date.test.ts); plus the seam's own cases in [`lorebook/engine.test.ts`](../src/lib/lorebook/engine.test.ts).

## Before touching this

- **The dispatcher and the parser stay pure.** No stores, no db, no Svelte, no clock, no randomness. The token meters and the real send both run them and must produce byte-identical output; `frameworks.test.ts` guards it. Run `bun test` after any change.
- **A framework's `compute` and `inject` are held to the same rule.** Reading a clock or calling `Math.random` there makes the meter and the send disagree, and neither surface will look wrong. `inject` is handed `now` for exactly this reason: take the clock from the input, never from `new Date()`.
- **A new framework is one entry in `FRAMEWORKS` and nothing else.** If it needs an edit anywhere in the base, the base is missing something and that is the change to make first. The date framework is the one exception, and only because it is the counterpart to `ChatFrameworkState.mode`, which is a base field.
- **A framework wanting per-chat state puts it under `byFramework[id]`**, never as a new field on `ChatFrameworkState`, and normalizes the inside of its own slice. The base guarantees only that a slice is a plain object or absent. The date framework's marker shape lives there; its `mode` does not, because the base's own resolver reads that one.
- **Anything asking the model to write a marker must agree with what `day.ts` parses.** The two are a pair, and a disagreement is silent: the day stops moving while every surface still looks correct. `date.test.ts` asserts the round trip, and a change to either side belongs in the same commit as a change to the other.
- Line-tidying rules live in `applyFrameworks` and nowhere else: a stripped marker takes one adjacent space, and a line left blank by stripping is dropped. Prose on a line that had no marker is never touched.
- **No em dash anywhere**, per the contract in `contracts.test.ts`.

## Hand-kept couplings

1. **One decorator, built in one place.** Every surface that assembles goes through `frameworkDecorator` (apply.ts): `prompt-assembly.ts`'s `buildMacroContext` via `AssembleInput.frameworks`, `live-macro-context.ts`, and the memory store via `ChatCtx`. Build one at a call site instead and the meter prices a prompt the send does not build, with nothing on screen saying so. `PromptBuilderView` deliberately passes nothing, exactly as it omits steering: it prices the preset, not story state.
2. **`frameworkBooks` has TWO callers, one fewer than the decorator.** `prompt-assembly.ts` and `live-macro-context.ts` add it to their books; the memory store deliberately does not, because an instruction about what to write next has no business in a summariser (see above). A third surface that assembles a SEND must add it, or the meter beside it prices a prompt the send does not build.
3. **`resolveLorebooks` has FOUR callers, one more than prompt-pipeline coupling 3 lists.** Besides the three context builders there is `LorebookScanTester`, which passes `NO_DECORATION` **deliberately**, for the same reason it passes no `expand`: it scans one book against typed text with no chat, no card fields and no story state, so it tests matching and only matching.
4. **`ChatCtx` has three construction sites** (`chat.svelte.ts`, `MemoryView.svelte`, `messages.svelte.ts`) and every one must fill `frameworks`, through `chatFrameworkState` in [`chat-setup.ts`](../src/lib/utils/chat-setup.ts). The memory store may never import `chatStore`, which is why this travels on the ctx like the version pin and the persona claim do.
5. **`FrameworkContext.disabled` is separate from `frameworks` on purpose.** A framework left out of the list reads as `unknownFramework`; a switched-off one reads as `disabled`. The two send someone debugging a silent marker to completely different places, so pass every registered framework and name the off ones.
6. **`registry.ts` imports no store**, unlike `engines/registry.ts`. Prompt assembly reads this list and may not touch a store, so an app-wide switch belongs beside the callers that already read settings.
7. **The date framework and `macros.ts` share three formatters.** `formatClock`, `formatLongDate` and `formatWeekday` are exported from `macros.ts` so `{{time}}`, `{{weekday}}` and `{{date}}` and the injected marker produce the same strings. Two copies of `toLocaleDateString('en-US', ...)` would drift the first time either was tidied, and the drift would show up as a marker the parser silently stops reading.
