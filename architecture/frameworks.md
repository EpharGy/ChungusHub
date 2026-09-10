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

[`day.ts`](../src/lib/frameworks/day.ts) resolves it from a per-chat **mode**, and that is the
whole of it:

| Mode | Answers with | Never reads |
|---|---|---|
| `manual` | the chat's stored day, set by `/day` | the clock |
| `marker` | today, as a serial date | the stored day |

The two are exclusive because their **units** are. A serial date is in the hundreds of
thousands; a story day is whatever number the reader typed. Anything that fell back from one
to the other would shift every cycle reading `day mod length` to an unrelated point, and
nothing on screen would say so.

### There is no marker parsing, and there used to be a lot of it

An earlier version scanned the chat for `<Time: ...>` markers the model had written and took
the latest date it found. Every part of that served one case: a turn narrating a jump ahead of
today, which a clock cannot know about.

That case does not exist. The framework that asks for those markers also tells the model that
real time overrides the story's own sense of when it is, so the transcript is never
authoritative about the date. Reading back a number we handed out a moment earlier is a long
way round to the value we already had.

Three things fell out of deleting it, and the first is the reason the instruction text is
short:

- **The marker no longer has to be parseable.** It is written for the reader to look at, so
  nothing needs policing: not the format, not how the month is spelled, not whether it is the
  first line. A hand-tuned version of the instruction block spent most of its length making the
  marker machine-readable, and none of that is needed.
- **A date the model invents cannot poison a chat.** Under the old rule a hallucinated year
  2087 won permanently, because nothing can be later than a date that has not happened.
- **Nothing depends on the chat path**, so a swipe, a branch and a trimmed history are all
  correct without having to be argued about.

What is given up: a narrated jump forward no longer moves the day. That is consistent with
real time being canonical, and `manual` plus `/day` is there for a story that wants a fictional
day counter instead.

### The clock is an argument, not a read

`day.ts` reads no clock. `today` arrives as a number the caller measured, via `todaySerial(at)`,
so the module stays pure and a test can pin it. The impurity is one default argument in
`apply.ts`.

What a real-time mode genuinely costs is narrower than "impurity": a token meter that ran at
23:59 and a send at 00:01 price different days. That window is a mode asking to be told the
real time.

`todaySerial` is the one place LOCAL date accessors are used, where the rest of the module is
UTC. It has to agree with the date the model is shown, which goes through `toLocaleDateString`
and is the reader's own wall clock.

### A fixed epoch, and what it buys

A date resolves against a FIXED origin, 0001-01-01. Nothing derived from a chat's own history
could be: the path is only ever the history that happens to be loaded and in budget, so
anything anchored to its beginning walks forward as a chat grows and every day number shifts
under it.

The serial that produces is large and costs nothing, because a framework consuming it needs
only `day mod length`. That is what lets a framework's own fields stay small and
calendar-free: a framework can take an optional offset in days and no absolute anchor at all,
so nothing in a character's entry has to name a year and a western or a fantasy setting needs
no editing.

`serialOf` builds it with `setUTCFullYear` rather than `Date.UTC`, because that constructor
reads years 0-99 as 1900+year and would put a story set in AD 47 into 1947 without a word.

**A framework taking an offset should DERIVE an unset one rather than defaulting it to zero.**
While the day count is smaller than the framework's own period, everything modulo that period
collapses together: on story day 3, `3 mod 27` and `3 mod 30` are both 3. Harmless for a serial
date, wrong for a long time under a small manual day. Hashing the subject key spreads a cast
from the first turn and stores nothing.

## A framework can inject blocks, not only answer markers

`compute` and `inject` are separate jobs rather than a required one and an optional extra, and
a framework may have either or both:

| | Answers `@id[...]` | Contributes blocks |
|---|---|---|
| a marker-driven tracker | yes | a reminder line |
| date | no | instructions, and a reminder line |
| reminders | no | the section the others land in |

A tracker decorates text an author already wrote. The date framework contributes an
**instruction addressed to the model**, which belongs to no lorebook entry and no character, so
there is nothing for a marker to sit inside.

### Blocks are DECLARED, not built

A framework that writes into the prompt wants the same three things every time: a piece of text
the reader can edit, a switch, and somewhere for it to land. So a framework declares its blocks
([`blocks.ts`](../src/lib/frameworks/blocks.ts)) and the base stores them, renders their editors
and injects them.

That is not tidiness. The settings detail view used to branch on the framework id, which worked
for exactly one framework and then stopped: **a public file cannot carry a branch for a
framework whose name must not appear in a public file**, so anything on a private branch could
never have tunables at all. Declared blocks mean the settings page draws any framework's
settings without learning whose they are.

**Order is fixed by the declaration and is not the reader's to set.** Everything else about
placement can be. Order is the only coordination frameworks have with each other, and a control
for it is a control for putting a line somewhere it does not belong.

`inject` survives for anything a framework builds itself rather than declaring. It returns a
LIST, because a framework routinely wants two placements at once.

### The reminders section

One short block near the reply that every framework can put a line into. It exists because a
long prompt buries things: instructions perfectly clear a hundred turns up still lose to
whatever the model read most recently, and the fix is not more instructions, it is one line
where the model is looking.

**It gathers rather than being written into.** Every framework declares its own reminder line
(`reminder: true`); the reminders framework declares the section (`gathersReminders: true`) and
receives them already filled in `FrameworkInjectInput.reminders`.

The alternative is how the same thing is done by hand in lorebook entries: an opening bracket
at a low order, a closing bracket at a high one, and everyone else's lines ordered in between.
That comes apart. One framework picking a bad order, or being switched off, leaves a section
hanging open or a line loose in the prompt. One entry cannot come apart.

Three absences are handled deliberately, because each has a wrong answer that looks fine in a
prompt and therefore survives a long time:

- **A reminder with nothing gathering it is dropped**, not injected bare. Outside its section a
  lone line is noise rather than a reminder, and the settings editor says so rather than leaving
  it to be discovered.
- **A section with nothing gathered is not injected at all.** Empty tags announce a system and
  then say nothing about it, which is worse than silence.
- **Every framework's reminder is off by default, even when the section is on.** A reminder is
  a cost paid every turn, and which systems a given model keeps forgetting is not something
  anything here can guess.

This is the one thing the base knows about a specific framework, and it is deliberate: a
section several frameworks write into at once is not something the rest of this contract can
express.

### They ride the lorebook's own pipeline

`frameworkBooks` (apply.ts) returns a synthetic book and the caller adds it to its own. An
injected block is text in a prompt, so it has to be placed somewhere, priced against the budget
that caps lore, and visible in the trace that explains the prompt. `renderLorebookBlock`
answers all three. A second channel beside it would answer them again, differently, and the
second answer is the one that goes wrong: a block outside the lore budget is a block the meter
does not count, and the meter and the send stop agreeing with nothing on screen saying so.

It runs in **two passes**, because a reminder is not injected where it stands: the gathering
framework cannot be asked for its entry until every line that belongs inside it exists.

**Macro expansion never reaches an injected block.** Entry content is expanded and THEN
decorated, so a framework emitting `{{date}}` would ship those braces to the model. That is why
`FrameworkInjectInput` carries `now`, and why a framework fills its own placeholders through
`fill` and declares which ones it understands. A framework whose `fill` returns empty is saying
"nothing this time", and the base drops the block: that is how the date framework says nothing
in manual mode.

**The memory store deliberately injects no framework books**, unlike the prompt and the live
meters. Those blocks tell the model what to write in its next reply, and a summariser is not
writing one.

## Two switches, and what each one answers

| Switch | Lives in | Answers |
|---|---|---|
| availability | `FrameworkSettings.enabled` (app-wide, synced) | does this install carry the framework at all |
| use | `ChatFrameworkState.enabled` (per chat) | does this story want it |

Same split Memory has: an app-wide switch on a settings page, per-chat enablement on its own
surface. An install decides whether a system exists; a story decides whether it wants one.
`runningFrameworks` (apply.ts) intersects them in one place, because a surface that checked
only one would be wrong in a way nothing on screen explains.

**Both default to off.** A framework injects text into every prompt of every chat that opts in,
and one that started writing into prompts the first time someone updated is one nobody agreed
to. The per-chat side is a list of ids rather than a flag per framework, so a chat that never
touches this stores an empty list, and a framework added later arrives off everywhere.

**Requirements are closed over on READ**, not only when a switch is flipped. A blob can arrive
from an older build, another device or a hand edit claiming a combination that cannot work;
resolving it in `enabledFrameworks` means every reader gets a coherent answer and nobody has to
remember to ask. Availability is the outer bound: the closure runs first, so a framework held on
by something that depends on it still loses to the install switch.

The UI enforces the same rule from the other side. Turning one on pulls in what it requires;
turning one off is refused while something that needs it is on, naming what is holding it, since
a switch that springs back with no explanation reads as a bug.

## The date framework

The counterpart to `marker` mode, and the only framework registered on the base branch. The
mode is a base field, nothing but this can tell the model the time, and shipping the two on
different branches would leave the base carrying half a feature. Every other framework still
adds itself on its own branch and needs no edit anywhere else.

Its settings split by what kind of fact each one is:

| Setting | Lives in | Why there |
|---|---|---|
| instructions, reminder, placement | declared blocks, stored under `config.date.blocks` | a template and a position are configuration |
| day mode | `ChatFrameworkState.mode` | the base's own resolver reads it |
| marker shape | `byFramework.date` (per chat) | only this framework reads it |

**In `manual` mode it injects nothing at all.** A reader driving the day by hand has not asked
to be told the real date and would be actively misled by one, so the block is absent rather
than present-and-ignored.

The instruction template understands `{{time}}`, `{{weekday}}`, `{{date}}` and `{{marker}}`,
substituted by the framework because macros never reach it. The settings editor warns when an
edit drops the ones that say what time it is: a template that stopped saying the time has
quietly stopped doing the only thing this framework is for, while still looking like a page of
sensible instructions.

The gap thresholds in the default text are deliberately NOT settings. No code reads them, so a
field for them would be a control that edits a sentence the reader can already edit.

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

**Configuration only, and it is small.** Three places, and the biggest is not in the database:

1. **The character**, in the lorebook entry's marker.
2. **Per chat**, [`ChatFrameworkState`](../src/lib/frameworks/chat-state.ts) on `ChatFeatureState`: which frameworks this story uses, its day and day mode, the subject keys it holds out, and an opaque per-framework map. It rides that column rather than a table of its own, so deleting a chat deletes it, duplicating a chat copies it, and the `chats` sync scope already broadcasts it. No DDL, no migration, no reaping, no sync scope. Same argument architecture/notepad.md makes.

3. **Per install**, [`FrameworkSettings`](../src/lib/frameworks/settings.ts) on the shared settings spine: which frameworks exist here at all, and each one's app-wide tunables. An instruction template is configuration, not a fact about one story, and duplicating a paragraph of prose into every chat blob is the one thing here that genuinely would bloat `getAllChats`.

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
- [`apply.ts`](../src/lib/frameworks/apply.ts): the ONE place a chat's state becomes a `LorebookDecorator`, the ONE place it becomes injected books, and where the two switches are intersected.
- [`blocks.ts`](../src/lib/frameworks/blocks.ts): what a framework declares about an editable block, and how a stored one resolves against it. Pure.
- [`reminders/`](../src/lib/frameworks/reminders/index.ts): the section every other framework's reminder line is gathered into.
- [`settings.ts`](../src/lib/frameworks/settings.ts): the app-wide shape and its normalizer. Pure; [`stores/frameworkSettings.svelte.ts`](../src/lib/stores/frameworkSettings.svelte.ts) persists it on the shared settings spine.
- [`components/settings/FrameworksPage.svelte`](../src/lib/components/settings/FrameworksPage.svelte) and `FrameworkDetail.svelte`: the settings surface. `FrameworkDetail` is the ONE place per-framework settings UI is wired.
- [`date/`](../src/lib/frameworks/date/index.ts): the date framework. The only one registered on this branch, because it is the counterpart to a base field.
- Tests: [`blocks.test.ts`](../src/lib/frameworks/blocks.test.ts), [`reminders/reminders.test.ts`](../src/lib/frameworks/reminders/reminders.test.ts), [`frameworks.test.ts`](../src/lib/frameworks/frameworks.test.ts), which runs against a **fake** framework declared in the test, so the base is provable without a real one; [`day.test.ts`](../src/lib/frameworks/day.test.ts), [`settings.test.ts`](../src/lib/frameworks/settings.test.ts) and [`date/date.test.ts`](../src/lib/frameworks/date/date.test.ts); plus the seam's own cases in [`lorebook/engine.test.ts`](../src/lib/lorebook/engine.test.ts).

## Before touching this

- **The dispatcher and the parser stay pure.** No stores, no db, no Svelte, no clock, no randomness. The token meters and the real send both run them and must produce byte-identical output; `frameworks.test.ts` guards it. Run `bun test` after any change.
- **A framework's `compute` and `inject` are held to the same rule.** Reading a clock or calling `Math.random` there makes the meter and the send disagree, and neither surface will look wrong. `inject` is handed `now` for exactly this reason: take the clock from the input, never from `new Date()`.
- **A new framework is one entry in `FRAMEWORKS` and nothing else.** If it needs an edit anywhere in the base, the base is missing something and that is the change to make first. The date framework is the one exception, and only because it is the counterpart to `ChatFrameworkState.mode`, which is a base field.
- **A tunable is a declared block wherever it can be**, not a bespoke settings component. The settings page renders declarations and knows no framework by name, which is what lets a framework that cannot be named in a public file have settings at all.
- **A framework wanting per-chat state puts it under `byFramework[id]`**, never as a new field on `ChatFrameworkState`, and normalizes the inside of its own slice. The base guarantees only that a slice is a plain object or absent. The date framework's marker shape lives there; its `mode` does not, because the base's own resolver reads that one.
- **Nothing parses what the model writes, and it should stay that way.** A marker in the transcript is for the reader. The moment something reads one back, the instruction text has to police its shape again, a model that forgets it starts mattering, and an invented date can move the day. All three were real and all three went away together.
- **A framework's own settings are normalized by the framework**, both the per-chat slice and the app-wide config. The base guarantees only that each is a plain object or absent, so a framework that reads one without normalizing it is trusting a blob from another build.
- Line-tidying rules live in `applyFrameworks` and nowhere else: a stripped marker takes one adjacent space, and a line left blank by stripping is dropped. Prose on a line that had no marker is never touched.
- **No em dash anywhere**, per the contract in `contracts.test.ts`.

## Hand-kept couplings

1. **One decorator, built in one place.** Every surface that assembles goes through `frameworkDecorator` (apply.ts): `prompt-assembly.ts`'s `buildMacroContext` via `AssembleInput.frameworks`, `live-macro-context.ts`, and the memory store via `ChatCtx`. Build one at a call site instead and the meter prices a prompt the send does not build, with nothing on screen saying so. `PromptBuilderView` deliberately passes nothing, exactly as it omits steering: it prices the preset, not story state.
2. **`frameworkBooks` has TWO callers, one fewer than the decorator.** `prompt-assembly.ts` and `live-macro-context.ts` add it to their books; the memory store deliberately does not, because an instruction about what to write next has no business in a summariser (see above). A third surface that assembles a SEND must add it, or the meter beside it prices a prompt the send does not build.
3. **`frameworkSettingsStore.initialize()` is called in `AppShell`**, beside the lorebook's. The chat meter prices the injected block the moment a chat opens, so an unloaded store would price a prompt with nothing in it and then disagree with the send a beat later.
4. **`resolveLorebooks` has FOUR callers, one more than prompt-pipeline coupling 3 lists.** Besides the three context builders there is `LorebookScanTester`, which passes `NO_DECORATION` **deliberately**, for the same reason it passes no `expand`: it scans one book against typed text with no chat, no card fields and no story state, so it tests matching and only matching.
5. **`ChatCtx` has three construction sites** (`chat.svelte.ts`, `MemoryView.svelte`, `messages.svelte.ts`) and every one must fill `frameworks`, through `chatFrameworkState` in [`chat-setup.ts`](../src/lib/utils/chat-setup.ts). The memory store may never import `chatStore`, which is why this travels on the ctx like the version pin and the persona claim do.
6. **`FrameworkContext.disabled` is separate from `frameworks` on purpose.** A framework left out of the list reads as `unknownFramework`; a switched-off one reads as `disabled`. The two send someone debugging a silent marker to completely different places, so pass every registered framework and name the off ones.
7. **`registry.ts` imports no store**, unlike `engines/registry.ts`. Prompt assembly reads this list and may not touch a store, so an app-wide switch belongs beside the callers that already read settings.
8. **The date framework and `macros.ts` share three formatters.** `formatClock`, `formatLongDate` and `formatWeekday` are exported from `macros.ts` so `{{time}}`, `{{weekday}}` and `{{date}}` and the injected marker produce the same strings. Two copies of `toLocaleDateString('en-US', ...)` would drift the first time either was tidied, and the reader would be shown one time while the model was told another.
