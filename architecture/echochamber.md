# EchoChamber: architecture & maintenance

A feed of audience reactions beside the story. After a reply lands, the engine asks a model
for a crowd reacting to it - a Discord room, a news ticker, a comment section, depending on
the style - and shows the result in a floating panel that can sit anywhere on screen while
the story is read.

Ported from [SillyTavern-EchoChamber](https://github.com/mattjaybe/SillyTavern-EchoChamber)
v5.2.0 (MIT, mattjaybe). The port is a rewrite with a reference implementation rather than a
transplant: roughly 1,200 of the extension's 5,756 lines are logic worth keeping (prompt
assembly, the line parser, the styles), and the rest is a hand-rolled jQuery panel this app
already has better versions of.

**The one thing to internalise before touching anything here:** the extension was written
for a chat that is a **line**, and this one is a **tree**. Every departure from it below
follows from that, or from the fact that a feed is decoration and must never be able to cost
the story anything.

## Where a feed lives

Feeds ride `chats.feature_state`, the per-chat opaque JSON blob, keyed by **the id of the
message they reacted to**, through `chatStore.updateChatFeatureState`'s serialized
read-merge-write. `feed-state.ts` owns the shape and the pruning.

**Keyed by id, never by position.** The extension keyed its saved commentary by
`chat.indexOf(msg)`, an index into a flat array. On a tree an index names a different turn on
every branch, so one swipe silently re-points every stored reaction at a message nobody
wrote. An id is stable across every branch change, which is why a feed survives a swipe here
and did not there.

**Why `feature_state` and not a table.** Three things fall out of it that a table would have
to build:

- **No migration.** Nothing is appended to `MIGRATIONS`, so the port can never collide with
  an upstream schema version.
- **Deletion cannot be forgotten.** `feature_state` is a column on the chats row and
  `deleteChat` is a `DELETE FROM chats`, so a deleted chat takes its feeds with it,
  atomically, with no cleanup code at all. Compare `steering_notes` in that same function: a
  separate table with no FK, reaped by hand because it cannot cascade. That reap is a line
  somebody had to remember to write, and this design has no equivalent line to forget.
- **It syncs on `chats`, not `settings`.** A feed written per turn on the global settings
  spine would rewrite one blob covering every chat there is, and make every other device
  re-read every synced setting, on every reply.

What it costs is size, since the whole blob is rewritten whenever a feed changes. Two rules
in `putFeed` hold that down, and both run on write, where the blob is being rewritten anyway
and no background sweep has to be scheduled or raced.

**Deleting a message does not cascade**, so `pruneFeeds` drops any feed whose message is
gone. Without it a branch delete leaves feeds addressed to ids nothing resolves: invisible,
unrenderable, and sitting in the blob for the life of the chat. It prunes against
`allMessages` rather than the active path, because a turn on another branch is not deleted,
only unvisited, and its feed is waiting for the reader to walk back to it.

**`MAX_STORED_FEEDS` is 8**, sized from what is actually read: one for the turn on screen
(the reason feeds are persisted at all - without it every reload costs a model call to
recover what was already there), up to `contextDepth` more when past reactions are fed back
into the prompt, and a couple for the current turn's siblings so swiping back does not
re-bill the reader. Past that, walking back far enough and playing forward regenerates
anyway, so older feeds only pay rent.

The ceiling is set against the **worst** case, not the typical one. An earlier cap of 25 was
sized against the default six reactions per feed and missed that `reactionCount` clamps at
30: fully loaded that is a ~90KB blob rewritten on the chats row every turn and resynced to
every device. Any future change to this number is a question about 30 reactions, not 6.

**A reaction is stored as data, never as markup.** The extension saved its rendered HTML and
re-parsed it with `querySelectorAll` to read the feed back. Storing the view means the feed
can never be restyled, re-ordered or made safe after the fact, and it puts model output back
through an HTML parser on every read. Nothing may reintroduce a stored-markup field.

## The prompt

`prompt.ts` assembles it, and the shape is ported deliberately unchanged, because it was
tuned against real models rather than derived from first principles. One part looks like a
mistake and is not: **`<chat_history>` is opened at the end of the system message and closed
at the start of the final user message**, with the story's turns interleaved between them as
real user/assistant turns. That frames the history as a transcript the crowd is reacting to
while still letting the model see it as a conversation. Close the tag in the system message
instead and models start continuing the story rather than reacting to it.

**One deliberate departure from the extension: `<reacting_to>`.** A history window is a
transcript with no present tense in it - nothing but position says which turn just landed -
and the extension's final user message asked only for reactions "based on the chat history
above". With several turns of background in front of the reply, models answer that by
reaching for the top of the window, and the feed reads as a crowd reacting to something the
reader finished with three turns ago. The block names the last turn as the moment being
reacted to and demotes everything above it to background, and the `<task>` line points at the
same turn.

It sits in the **final user message**, beside `</chat_history>`, for the reason the failure
exists: that is the last thing the model reads before it writes, and the one position a long
history window cannot push the target away from. It **names** the turn rather than quoting it
again - the reply is already in the window, and with `includeUserInput` off the window IS the
reply, so quoting would send the same text twice for emphasis the wording already carries.
The one-turn window gets different wording, because the multi-turn text demotes turns that in
that case do not exist, and inviting a model to look for them is how it invents them.

The window itself is `history.ts`, which is pure and tested: the last `contextDepth` turns,
moved **forward** to begin on a user turn so the crowd sees a complete exchange rather than an
answer to a question it was never shown. Forward, not back - the rule used to walk backwards
for the user turn and then trim to `contextDepth` again, which lands on exactly the turn the
walk started from, so it never once changed the window it was meant to fix. `contextDepth` is
a ceiling the reader set against a cost paid on every reply, never a target to overshoot.

Styles live in `styles.ts` as constants, not as files under `defaults/`, because the app
already holds its editable prompts that way (`featurePrompts.svelte.ts`, `memory/prompts.ts`)
and because a style is needed on the client, where reaching a file would mean a server route
this port otherwise does not need. The bodies are generated from the upstream markdown; do
not hand-edit them.

Two macros are EchoChamber's own and resolve here against the cast: `{{characters}}` and
`{{story_characters_block}}`. `{{user}}` and `{{char}}` are the app's ordinary macros.

## Reading the reply

`parse.ts` turns `username: message` lines into `Reaction[]`, leniently: a feed is
decoration, so a line the parser cannot read costs that line and never the batch. Three of
its rules differ from the extension's, and each was silent data loss there:

1. **The cap is applied before the display order.** Ordering first and taking the first N
   meant `newest-first` kept the LAST n the model wrote and `oldest-first` kept the first n:
   a preference about layout silently decided which half of the batch existed.
2. **Only wrapping name decoration is stripped.** The extension stripped ``*_"` `` from
   anywhere in a handle, so `dave_99` arrived as `dave99` - while the styles instruct the
   model to invent underscore-heavy handles by design.
3. **A rejected cast name does not donate its continuation.** The extension left the parser
   pointing at the last accepted reaction, so a discarded speaker's following lines were
   appended to a real character's message: words nobody wrote, over a name in the cast.

**A cast of one does not snap** (`castNamesForStyle`). One card usually names the story or
the world rather than a speaker, so snapping to it discards every character the model
correctly drew out of the narrative and leaves an empty panel: a far worse failure than an
unfamiliar name.

Reaction text renders through the app's own `renderMarkdown`, which sanitizes with DOMPurify,
so the feed is safe by the same construction as the transcript.

## What the crowd knows about the world

**EchoChamber runs no lorebook scan of its own, ever.** The turn it reacts to already
recorded one: `Message.lorebook` is the trace of what the scan decided for the generation
that produced that turn, and `lorebook-context.ts` filters it with the app's own
`lorebookWasInjected` predicate and resolves the surviving ids to their text.

Reusing it rather than re-scanning is the whole point, and it buys three things:

- **The crowd cannot know more than the story did.** A second scan runs against different
  text at a different moment and activates a different set, so the feed could reference a
  secret the reply itself was never told. Reusing the trace makes that structurally
  impossible rather than unlikely.
- **It is branch-correct for free.** The trace is a column on the message, so walking to
  another branch reads that branch's scan with nothing to recompute or invalidate.
- **It costs nothing.** A scan is real work across every book and every key; this is a
  filter over a list already in memory.

Using `lorebookWasInjected` rather than a hand-rolled status list is what keeps it honest:
an entry that matched but was trimmed by the token budget, or that lost its inclusion group,
never reached the model, so it must not reach the crowd. An entry deleted since the scan
drops out rather than leaving a placeholder - it is gone, and a placeholder would put a hole
in the world description rather than admit one.

Memory is `memoryStore.recall`, the same derived recall the story gets. It describes the
story as of the current path tip, so regenerating a feed on an OLDER turn shows the crowd
slightly more than that turn's model had. That is accepted rather than fixed: the ordinary
case is the newest reply, where the two agree exactly, and the alternative is re-deriving
coverage per message for a decoration.

**The cast is resolved per chat, through the app's own resolvers, for the same reason.** The
crowd is reacting to a reply the story prompt already built, so it has to be told about the
same two people that prompt was built from:

- **Persona** is `chatPersonaEntry(state.chat)` (`utils/chat-setup.ts`), never
  `personaStore.activeEntry`. A chat can play as a persona that is not the app-wide one, and
  reading the app-wide slot hands the crowd whoever the last chat left there. It is invisible
  in a chat with a real cast and real lore, and glaring in one without: the foreign persona
  becomes the only thing in the world description.
- **Character** is `characterLibraryStore.dataForVersion(entry, chat.characterVersionId)`,
  never `entry.data`. A chat pinned to a variant plays against that variant's sheet, and the
  live entry is whichever one the library happens to have active. This is the same call
  `live-macro-context.ts`, `memory/store.svelte.ts` and the generation path all make.

Both resolvers are upstream API and take what they resolve as an argument, so neither closes
an import cycle and neither is fork-only. A dangling version pin **throws**, exactly as it
does on the story path; `generate`'s catch turns it into the same "repin it" toast, and the
failure guard stops the same turn asking again.

## What the panel shows

**The newest feed that EXISTS on the path, not the feed of the newest turn**
(`newestFeedOnPath`). Those two differ for the whole duration of a generation, and reading
the second is a visible flaw: the instant a reply lands it becomes the newest turn with no
feed of its own, so the panel empties, shows its placeholder for the length of the call, and
repopulates. The previous reactions were never deleted; the panel had simply stopped looking
at them. Walking back to the newest turn that has one keeps them on screen and swaps when the
new ones arrive, and it makes a delete fall back to the last surviving feed instead of to an
empty box.

The cost is that the feed on screen can belong to an earlier turn than the reply being read,
so the panel **says so** rather than leaving it to be inferred: stale reactions presented as
current is the one way this can mislead. The delete button targets the feed being displayed
rather than the newest turn, for the same reason - a delete that removes something you cannot
see is a trap.

## Deleting a feed

The panel's delete throws the current feed away and does **not** regenerate. It exists for a
feed that came out wrong, and a reader who wants a different one presses refresh; spending a
call on their behalf would make delete unusable as "stop showing me this". Nothing confirms
it: a feed is decoration and regenerating costs one call, so a dialog in front of that is
friction with nothing behind it.

A deleted feed stops being sent as history on the next turn for free, because
`pastReactionsFor` resolves feeds by id at prompt-build time rather than baking them into
anything.

**A feed is never shown its own predecessor** (`pastReactionsFor`). The turn being reacted to
is the last entry in its own history window, so without that rule a regenerate is handed the
very output it is replacing and asked to keep its voice, which is exactly what pressing
regenerate is meant to escape, and doubly so after deleting one that came out corrupt. Only
turns BEFORE the reacted-to one can be history.

## The engine, and why it floats

EchoChamber is a registry engine (`engines/registry.ts`), which is what earns it a
Connections routing row, an app-wide on/off switch and an honest source label in the prompt
debug panel for one entry. Its `prompts` list is empty on purpose: its prompts are chat
styles, a list a reader adds to, not a fixed set of templates, so they get their own settings
page instead of the Engines page's inline editor.

**The settings blob lives apart from the store, in `echochamber/settings.svelte.ts`.** That
split is not tidiness, it is what keeps the app loading. The registry needs the enabled flag to
draw its row; the store needs the chat, lorebook and memory stores to build a prompt, and memory
imports the LLM provider, which imports `stores/connections.svelte.ts`, which reads `ENGINES`
straight back out of the registry. `ENGINES` is a `const`, so a registry that imports the store
closes a ring in which one side always meets that `const` in the temporal dead zone, and the
module graph dies on load rather than at the call. The settings module imports the setting
transport and the pure config and nothing that can reach a connection, so the registry can hold
the switch without pulling the runtime in behind it. Both sides read one copy of the state, so a
toggle from the Engines page and one from this page are the same write. Adding an import to
`echochamber/settings.svelte.ts` is how this comes back.

The store is shaped after Sprites - one background call per reply, filed against one message
row, never blocking the reply that triggered it - with one rule Sprites does not need:
**one call at a time, newest wins.** A reader swiping alternates can ask for three feeds
faster than one returns, and the right answer to a second request is to abandon the first,
not to queue it and bill for both.

**The turn to react to is named, never searched for.** A scan of the open path answers
"whatever turn is newest right now", which is the turn that just landed only while the reader
stays put: walk to another branch or another chat mid-generation and the scan files this
reply's reactions against a turn nobody generated. Each of the three trigger calls passes the
row it just wrote, and `buildContext` walks that row's own parents (`findActivePath`) rather
than slicing the open path. In the ordinary case the two are the same list; for a turn the
reader has navigated away from the walk is the only one that answers at all. A row that is not
in the open chat resolves to nothing.

**A turn whose generation failed is not asked about again** (`failed`, message id against the
text that failed). This is Sprites' guard, and EchoChamber was missing it, which made a
failure both permanent and expensive: the widget's effect reads `generatingFor` and the turn's
feed, so clearing `generatingFor` in the `finally` re-runs the effect that asked - and a turn
that just failed has no feed and is no longer generating, so it qualified again immediately.
One unreachable connection, or one reply the parser could read nothing out of, was an unbounded
loop of model calls with a toast each. Keyed on the **content** rather than the id alone so the
guard does not outlive what it guards: continuing or editing the reply is a new question and
gets a new attempt. The regenerate button drops it outright - it exists to stop a broken engine
re-asking on every render, never to stop the reader from asking - and a feed that lands clears
it, so one successful regenerate brings the automatic path back with it.

**Arriving at a chat re-asks about its newest reply**, which is what stops "resolves to nothing"
being the end of the story. A reply is committed by the *server*, so it lands whether or not the
page that asked for it is still on that chat - but the sidecar above runs once, from the
generation that placed the row, and a chat load ran nothing at all. So a reader who switched
character mid-reply came back to a turn the crowd never saw, permanently. `EchoChamberWidget`
now calls `ensureForNewestReply()` from an effect, the way `SpriteLayer` calls
`spriteStore.ensureRead()`: the widget asks on every change and the store decides whether that
means a call. It carries **no policy of its own** - every gate is `ensureForMessage`'s, so a turn
with a feed and a turn being generated are both left alone - and it is bounded to the newest
reply, never a sweep back through the branch. Mounted with the widget rather than gated on the
panel being open, so arrival behaves the same whether the feed is on screen or behind the
launcher, which is how the per-turn sidecar already behaves. The image engine carries the same
pair of rules for the same reason (architecture/imagegen.md), where the cost of getting it wrong
is GPU time rather than one call.

**The panel floats rather than docks, and that is the load-bearing UI decision.** The
workspace's side panels are mutually exclusive (`uiStore.dropUnlockedSidePanels`), and a feed
exists to be read WHILE the story is read. Docking it would have meant teaching that
choreography about a panel that never closes - the single highest-risk edit available in this
area, in the file most likely to move upstream. The Chungus Assistant already carved the
exemption for a free-floating widget, so EchoChamber rides it for one added `$state` flag.

It snaps like the Assistant too: drag the header to an edge or a corner and it docks (left,
right, the four quarter-corners, or the centred chat column from the top edge), with a ghost
preview during the drag, a tear-off that restores the free size, and the dock persisted
across reopens. Resizing a docked panel frees it, since a dock is a slot with a size of its
own.

**The dock geometry is read from the app's real layout, not recomputed.**
`[data-assistant-snap-workspace]` and `[data-assistant-snap-column]` are already in the DOM
for the Assistant's own snapping, so querying them keeps the docks aligned with the chat
column through zoom, width changes and breakpoint flips with no responsive maths duplicated,
and it cost this feature no upstream edit whatsoever.

That is a DOM contract this port does not own, so it **fails soft**: `snapRegion` returns
null when an anchor is missing and the panel stays free-floating. The Assistant throws in the
same place, which is correct for the feature the contract belongs to; a reaction feed is
decoration and must degrade instead. What EchoChamber deliberately does NOT do is set
`uiStore.assistantSnapSide`, the flag Workspace reads to draw its animated tint behind a
side-docked panel: teaching Workspace about a second widget is an edit to the file this port
exists to leave alone, for a visual flourish.

Its drag/resize logic is a **sibling** of the Assistant's rather than a shared shell
extracted from it. Extracting would mean rewriting `AssistantFloatingWidget.svelte`, 900
lines of upstream file this port has no other reason to touch, and merge surface on upstream
files is the cost the whole port is shaped to avoid. The duplication is what was bought with
it, deliberately. If upstream ever extracts such a shell itself, adopt it then.

## What it deliberately does not do yet

- **No Livestream.** The extension can drip a batch of reactions out over time as a running
  chatroom, with resume. Additive on top of this spine; it changes nothing here.
- **No chat participation.** Talking back to the crowd, with @mentions, is a second
  generation path and its own input surface. Also additive.
- **No style editor.** Only the shipped styles load. `ChatStyle.custom` exists and nothing
  indexes the style list by position, so reader-authored styles land beside the built-ins
  when the editor does.

## Files

| File | What it is |
|---|---|
| `src/lib/echochamber/types.ts` | Domain types: a reaction, a feed, a style, the settings |
| `src/lib/echochamber/config.ts` | Shipped defaults, bounds, and clamping of a stored blob |
| `src/lib/echochamber/settings.svelte.ts` | The settings state, held where the registry can reach it |
| `src/lib/echochamber/styles.ts` | The 14 shipped styles (generated from upstream markdown) |
| `src/lib/echochamber/parse.ts` | Model output into reactions, and cast-name snapping |
| `src/lib/echochamber/custom-styles.ts` | Reader-authored styles: ids, validation, duplication |
| `src/lib/echochamber/lorebook-context.ts` | The story turn own lorebook trace into world text |
| `src/lib/echochamber/history.ts` | Which turns of the story the crowd is shown |
| `src/lib/echochamber/prompt.ts` | Prompt assembly, the style macros, and `<reacting_to>` |
| `src/lib/echochamber/feed-state.ts` | Where a feed lives, and the pruning that bounds it |
| `src/lib/echochamber/echochamber.test.ts` | `bun test` coverage of all of the above |
| `src/lib/stores/echochamber.svelte.ts` | The engine: styles, generation, context, writes |
| `src/lib/stores/echochamber-retry.test.ts` | What a failed feed costs: the guard against a retry loop |
| `src/lib/components/echochamber/EchoChamberWidget.svelte` | The floating panel and its launcher |
| `src/lib/components/echochamber/ReactionFeed.svelte` | The feed's rows |
| `src/lib/components/settings/EchoChamberPage.svelte` | Settings → App → EchoChamber |

Modified elsewhere, all additive: one `ChatFeatureState` field and its normalizer
(`types/chat.ts`), one engine entry plus its debug colour and route-point icon
(`engines/registry.ts`, `debug/format.ts`, `settings/ConnectionsPage.svelte`), one settings
row and page arm (`config/settings-pages.ts`, `settings/SettingsPageView.svelte`), one
`$state` flag (`stores/ui.svelte.ts`), one mount and one boot step
(`layout/AppShell.svelte`), and three one-line trigger calls plus one private method
(`stores/messages.svelte.ts`).
