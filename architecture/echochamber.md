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
  an upstream schema version. Same rule the imagegen port holds.
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

## The engine, and why it floats

EchoChamber is a registry engine (`engines/registry.ts`), which is what earns it a
Connections routing row, an app-wide on/off switch and an honest source label in the prompt
debug panel for one entry. Its `prompts` list is empty on purpose: its prompts are chat
styles, a list a reader adds to, not a fixed set of templates, so they get their own settings
page instead of the Engines page's inline editor.

The store is shaped after Sprites - one background call per reply, filed against one message
row, never blocking the reply that triggered it - with one rule Sprites does not need:
**one call at a time, newest wins.** A reader swiping alternates can ask for three feeds
faster than one returns, and the right answer to a second request is to abandon the first,
not to queue it and bill for both.

**The panel floats rather than docks, and that is the load-bearing UI decision.** The
workspace's side panels are mutually exclusive (`uiStore.dropUnlockedSidePanels`), and a feed
exists to be read WHILE the story is read. Docking it would have meant teaching that
choreography about a panel that never closes - the single highest-risk edit available in this
area, in the file most likely to move upstream. The Chungus Assistant already carved the
exemption for a free-floating widget, so EchoChamber rides it for one added `$state` flag.

Its drag/resize logic is a **sibling** of the Assistant's rather than a shared shell
extracted from it. Extracting would mean rewriting `AssistantFloatingWidget.svelte`, 900
lines of upstream file this port has no other reason to touch, and merge surface on upstream
files is the cost the whole port is shaped to avoid. The duplication is what was bought with
it, deliberately. If upstream ever extracts such a shell itself, adopt it then.

## What it deliberately does not do yet

- **No lorebook or memory in the prompt.** `includeLorebook` and `includeMemory` exist in the
  settings type and the prompt builder handles both (with tests), but the store resolves them
  to empty, because both need text the prompt pipeline assembles server-side. Neither toggle
  is offered on the settings page until it resolves to something: a switch that silently does
  nothing is worse than no switch.
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
| `src/lib/echochamber/styles.ts` | The 14 shipped styles (generated from upstream markdown) |
| `src/lib/echochamber/parse.ts` | Model output into reactions, and cast-name snapping |
| `src/lib/echochamber/prompt.ts` | Prompt assembly and the style macros |
| `src/lib/echochamber/feed-state.ts` | Where a feed lives, and the pruning that bounds it |
| `src/lib/echochamber/echochamber.test.ts` | `bun test` coverage of all of the above |
| `src/lib/stores/echochamber.svelte.ts` | The engine: settings, generation, context, writes |
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
