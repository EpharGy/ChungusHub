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
same integer from the same place.

[`day.ts`](../src/lib/frameworks/day.ts) resolves it as a ladder, scanning the chat path
backwards from the newest turn. **The first turn carrying a marker decides**, and the chat's
stored day is the floor when no turn carries one:

| Source | Marker | Reads as |
|---|---|---|
| `day-marker` | `<Day 47>` | that number, verbatim |
| `time-marker` | `<Time: 11:53 AM, Sunday September 6, 2026>` | a serial date, days since a FIXED epoch |
| `manual` | none | the stored day, set by `/day` |

Within one turn `<Day N>` wins, because it states the tracker's own unit outright where a date
has to be converted before it means anything.

**The brackets are the whole point of the day marker.** An unbracketed "day 47" appears in
ordinary prose constantly ("it had been day 47 of the siege"), and a tracker that read those
would jump to whatever number a character last reminisced about. The brackets are the author
saying this one is a statement of fact rather than a line of narration.

**Only the newest marker is ever read, and a date resolves against a FIXED epoch.** An earlier
version counted dates from the first dated turn on the path, which read far better (day 1 was
the day the story started) and was quietly wrong: that array is only ever the history that
happens to be loaded and in budget, so its beginning walks forward as a chat grows and every
day number would shift under a long story without a word. Nothing here may depend on how far
back the path reaches.

The serial that produces is large, and it costs nothing, because a framework consuming it needs
only `day mod length`. That is what lets a framework's own fields stay small and calendar-free:
a framework can take an optional offset in days and no absolute anchor at all, so nothing in a
character's entry has to name a year and a western or a fantasy setting needs no editing.

The epoch is 0001-01-01 rather than 1970 or 1900, purely so a historical setting produces
positive numbers. `serialOf` builds it with `setUTCFullYear` rather than `Date.UTC`, because
that constructor reads years 0-99 as 1900+year and would put a story set in AD 47 into 1947
without a word.

**A framework taking an offset should DERIVE an unset one rather than defaulting it to zero.**
While the day count is smaller than whatever the framework's own period is, everything modulo
that period collapses together: on story day 3, `3 mod 27` and `3 mod 30` are both 3. That is
immediately harmless for a serial date and wrong for a long time under `<Day N>`, which starts
small. Hashing the subject key spreads a cast from the first turn and stores nothing.

Reading only the tail is also what keeps the property the rest of this design has: nothing
accumulates, so a branch is correct because a path IS a branch. Swipe away the turn that said
`<Day 9>` and the day is whatever the surviving path says.

**There is no real-time source and there should not be one.** A clock read at substitution
time would put the token meter and the send either side of midnight, which is exactly the
disagreement this whole module is built to avoid. What replaces it is the `<Time: ...>` marker:
the story's own clock, written into the transcript, and therefore stable however many times it
is read.

**Nothing emits these markers.** The framework reads them; something else has to write them,
which today means the reader typing one or the model being told to. A preset item or a steering
note instructing the model to open each reply with a time stamp is what makes the `time-marker`
source work at all, and its absence is why `manual` is still the floor rather than a fallback
nobody reaches.

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

- [`types.ts`](../src/lib/frameworks/types.ts): `FrameworkDef`, `FrameworkComputeInput`, `FrameworkRecord`, `FrameworkContext`. No logic.
- [`marker.ts`](../src/lib/frameworks/marker.ts): the grammar, `findMarkers`, `hasMarker`. Pure.
- [`dispatch.ts`](../src/lib/frameworks/dispatch.ts): `applyFrameworks`. Pure. The whole of the base's runtime.
- [`chat-state.ts`](../src/lib/frameworks/chat-state.ts): the per-chat blob, its normalizer and caps, and `parseDayArg`.
- [`registry.ts`](../src/lib/frameworks/registry.ts): every framework this build carries. Pure data, deliberately store-free (prompt assembly reads it).
- [`apply.ts`](../src/lib/frameworks/apply.ts): the ONE place a chat's state becomes a `LorebookDecorator`.
- Tests: [`frameworks.test.ts`](../src/lib/frameworks/frameworks.test.ts), which runs against a **fake** framework declared in the test, so the base is provable without a real one; plus the seam's own cases in [`lorebook/engine.test.ts`](../src/lib/lorebook/engine.test.ts).

## Before touching this

- **The dispatcher and the parser stay pure.** No stores, no db, no Svelte, no clock, no randomness. The token meters and the real send both run them and must produce byte-identical output; `frameworks.test.ts` guards it. Run `bun test` after any change.
- **A framework's `compute` is held to the same rule.** Reading a clock or calling `Math.random` there makes the meter and the send disagree, and neither surface will look wrong.
- **A new framework is one entry in `FRAMEWORKS` and nothing else.** If it needs an edit anywhere in the base, the base is missing something and that is the change to make first.
- **A framework wanting per-chat state puts it under `byFramework[id]`**, never as a new field on `ChatFrameworkState`, and normalizes the inside of its own slice. The base guarantees only that a slice is a plain object or absent.
- Line-tidying rules live in `applyFrameworks` and nowhere else: a stripped marker takes one adjacent space, and a line left blank by stripping is dropped. Prose on a line that had no marker is never touched.
- **No em dash anywhere**, per the contract in `contracts.test.ts`.

## Hand-kept couplings

1. **One decorator, built in one place.** Every surface that assembles goes through `frameworkDecorator` (apply.ts): `prompt-assembly.ts`'s `buildMacroContext` via `AssembleInput.frameworks`, `live-macro-context.ts`, and the memory store via `ChatCtx`. Build one at a call site instead and the meter prices a prompt the send does not build, with nothing on screen saying so. `PromptBuilderView` deliberately passes nothing, exactly as it omits steering: it prices the preset, not story state.
2. **`resolveLorebooks` has FOUR callers, one more than prompt-pipeline coupling 3 lists.** Besides the three context builders there is `LorebookScanTester`, which passes `NO_DECORATION` **deliberately**, for the same reason it passes no `expand`: it scans one book against typed text with no chat, no card fields and no story state, so it tests matching and only matching.
3. **`ChatCtx` has three construction sites** (`chat.svelte.ts`, `MemoryView.svelte`, `messages.svelte.ts`) and every one must fill `frameworks`, through `chatFrameworkState` in [`chat-setup.ts`](../src/lib/utils/chat-setup.ts). The memory store may never import `chatStore`, which is why this travels on the ctx like the version pin and the persona claim do.
4. **`FrameworkContext.disabled` is separate from `frameworks` on purpose.** A framework left out of the list reads as `unknownFramework`; a switched-off one reads as `disabled`. The two send someone debugging a silent marker to completely different places, so pass every registered framework and name the off ones.
5. **`registry.ts` imports no store**, unlike `engines/registry.ts`. Prompt assembly reads this list and may not touch a store, so an app-wide switch belongs beside the callers that already read settings.
