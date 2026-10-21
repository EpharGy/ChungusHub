# Chorus: architecture & maintenance

Chorus gives the characters on a chat's list wants of their own. After every reply, a model plays each listed character against that reply, with the triggered lore, and asks two things: what they want right now, and what they would do about it. Their answers go into the next story prompt as one block, and the story model decides which of them matter.

It is built for undirected play, where the reader sends a near-empty turn and lets the story carry on. Without something like this the characters who are not being addressed drift into furniture. Nothing in the block is an order: the shipped wrapper says to use what serves the scene and to quote none of it.

## The shape: Sprites, pushed instead of pulled

Chorus is the Sprites engine's shape (architecture/engines.md). It reads the newest reply once, keeps the answer under that reply's id, and never calls again for a reply that has already been read:

- **Swiping** a new reply keeps the same parent path, so the swipe uses the same reading. No calls.
- **Regenerating** the read reply makes a sibling nobody has read, so Chorus runs for it.
- **Walking to another branch** shows that branch's own readings, already stored.

**The one difference is who asks.** Sprites is pulled: the sprite layer calls `ensureRead` when it draws, so a chat nobody looks at spends nothing. Chorus feeds the next prompt whether or not anyone is looking, so its `ensureRead` is driven by [`ChorusWindow.svelte`](../src/lib/components/ui/ChorusWindow.svelte). That component is mounted at the shell for the app's whole life and draws nothing while the window is closed. `ensureRead` is cheap and idempotent: the engine switch, the chat's switch, an enabled member, no stream running, not already read, not in flight, and not failed against the same text are all checked before any call.

It is not pushed from the send path, as EchoChamber and image generation are. Those name the message they just wrote, because a "newest turn on screen" scan can file one reply's result against another turn. Chorus cannot misfile a reading: it is keyed by the id of the exact reply it read, taken before the call starts. Pulling from the panel also covers every way a reply arrives (send, regenerate, opening scene, a greeting, a reply that landed while the reader was in another chat) without an edit to `messages.svelte.ts` for each one.

## Storage: the chat row, never a migration

Two keys on `ChatFeatureState` ([`chorus/state.ts`](../src/lib/chorus/state.ts)):

| Key | Holds | Written by |
|---|---|---|
| `chorus` | the roster: whether this chat runs Chorus, the members, their goals and pins | the reader only |
| `chorusReadings` | what the agents said, by the id of the reply they read | a run only |

**Two keys rather than one**, because `chatStore.updateChatFeatureState` merges a patch at the top level. With one key, a run finishing while the reader renames somebody would write back the roster it read before the rename. Separate keys make that collision impossible. Each kind of write is also serialized inside the store (`editRoster`, `writeReadings`) and computed from the state as it stands once the previous write has landed, so two presses inside one round trip cannot undo each other.

**A reading is not a column on `messages`, although it belongs to a message.** The schema is versioned (`MIGRATIONS` in server/db.ts) and every migration runs once by number. A migration on a branch that never goes upstream claims a number upstream will later use for something else, and a database that has already applied "that number" silently skips upstream's real change. EchoChamber keeps its feeds on the chat row for the same reason. The cost is size, because the blob rides every chat-list fetch:

- `putReading` drops every reading whose reply no longer exists anywhere in the chat, then the oldest past `CHORUS_MAX_READINGS` (8). A reading on another branch is kept: unwatched is not stale.
- Every text field is clamped (`CHORUS_LIMITS`), and the roster holds at most `CHORUS_MAX_MEMBERS` (8). The worst case is about 35KB; an ordinary chat is a few KB.

Normalization follows the rest of the feature state: corrupt or missing data degrades to "off, nobody listed, no readings" and never throws.

## A run

[`chorusService.ts`](../src/lib/services/chorusService.ts) builds and sends one agent's prompt. [`stores/chorus.svelte.ts`](../src/lib/stores/chorus.svelte.ts) decides when, and stores the result.

- **The path is cut at the reply being read, that reply included.** The history macros then read it as the latest thing said, and the lore scan sees its text, so a character who walks in during that reply wakes their own entry.
- **One lore scan per run, shared by every agent.** `chorusContext` calls `buildLiveMacroContext` once, the same resolver the story's surfaces use, with the chat's books, mutes, card fields, steering, budget and sticky history. Every agent reads the same `{{lorebook}}`, and a probabilistic entry gets one roll per run rather than one per character. The trigger is absent, which means a plain send: a character's name in the chat matches their entry's keys exactly as it would for the story.
- **A run moves no sticky or cooldown window.** Those windows are measured off the lore traces stored on turns (`lorebookHistory`). The run's scan trace is returned on the context and never stored. Do not store it on a turn, or every sticky entry gains a generation on every reply.
- **An agent knows what the story model knows and nothing more.** A member's name is the name their entry fires on, so if they have not come up, their entry has not fired, and the story model does not have their sheet either. A per-member pinned sheet was considered and dropped, because it would give an agent information the writer lacks.
- **Answers are JSON**, read through the app's shared `parseJsonObject`, never a copy of another tolerance. [`chorus/answer.ts`](../src/lib/chorus/answer.ts) turns one reply into `{ want, intends, goals }`. A goal the agent leaves out keeps its given value: the template asks for a replacement only when a goal needs one, so silence means still current, never cleared. What "needs one" means is spelled out (never set, reached, given up, overtaken), and each goal is labelled with its horizon: asked only for "changed" goals, a model reads an empty goal, or one already reached, as unchanged and keeps it for good.
- **Calls run in parallel** by default, or one after another (`chorusSequential`) for endpoints that refuse concurrent calls.
- **Failure:** a member whose call fails or ignores the format is stored with an `error` and left out of the block. If every member fails, nothing is stored and the reply is guarded against retrying on every render by its content, Sprites' rule, so an edited reply is a new question. The panel's run button clears the guard.

## Goals

Each member has three goals (immediate, short term, long term). Resolution is pure (`effectiveGoals`, [`chorus/resolve.ts`](../src/lib/chorus/resolve.ts)):

1. A **pinned** goal on the roster always wins.
2. Otherwise the **newest reading on the active path** that has this member speaks for them, at any distance.
3. Otherwise the roster's own text.

Every reading stores the member's **full** goal set after that turn, not only what moved, so the newest reading is a complete answer on its own even after older readings have been pruned. Walking the path rather than the stored readings is what makes goals branch-correct: a reading on another branch is never consulted.

**Typing a goal pins it.** An unpinned goal would be replaced by the agent's own on the very next reading, which reads as the edit not having worked. Unpinning hands the goal back to the agents. An agent's proposal for a pinned goal is ignored.

## Into the prompt

`AssembleInput.chorus` is `{ intentions, wrapper, depth, role }`. Both callers build it through **one** pure resolver, `chorusForPrompt`: the send ([`prompt-builder.ts`](../src/lib/utils/prompt-builder.ts)) over the chat row it reads fresh, and the chat meter ([`InputArea.svelte`](../src/lib/components/chat/InputArea.svelte)) over the store's copy. This is prompt-pipeline coupling 8, the same as steering: a meter that resolves the block its own way prices a prompt the send does not inject.

- **Which reading:** walk the path back over assistant turns and take the first reading within `chorusStaleLimit` replies (default 1). A send made while a run is still in flight goes out with the reading before it rather than waiting. Past the limit, nothing is sent: an old reading describes a scene the story has left.
- **Not on a continuation.** Continue extends the very reply the reading was taken from.
- **Muting takes effect at once.** `renderIntentions` lists only members still on the roster and switched on, so muting someone removes them from the next prompt without waiting for a run.
- **Placement:** a depth splice, the same `DepthSplice` path steering and at-depth lore use, fixed cost and never trimmed. It is not a synthetic lorebook entry: those are priced against the lore budget and can be trimmed silently. **At a shared slot the splice array's order decides, and Chorus goes first**, ahead of lore and steering. A reminders section placed at the same depth rides as lore, so it lands after Chorus, closest to the reply. `chorus.test.ts` asserts that order against a real at-depth entry.
- `{{intentions}}` is a call-site key, like `{{steering}}`, never a `macros.ts` entry.

## Where things live

| What | Where |
|---|---|
| Engine switch, both templates, placement, stale limit, sequential, re-read toggles | Settings → Engines → Chorus (`featurePromptsStore`, `EngineDetail.svelte`) |
| The model it runs on | Connections → Model routing. A calling engine is a routing point automatically |
| Roster, goals, pins, the latest answers, run again | The Chorus floating panel, raised from the title bar (`registerFloatingPanel`, order 50) |
| The block as sent | The prompt debug panel and the review dialog. It never becomes a chat row |

**Re-reading after a rewrite is the caller's decision**, exactly as for Sprites. `messageStore` clears the reading on an edit (`chorusRereadOnEdit`, which ships **on**, unlike Sprites: intentions read from old text steer the next reply towards a scene that is gone) and after Continue (`chorusRereadOnContinue`, off). A minor edit and `create_branch` are exempt for Sprites' reasons.

The engine ships **off**: it spends one call per listed character on every reply.

## Couplings

1. `chorusForPrompt` is the only place the block is decided. A new surface that assembles a story prompt for a live chat must call it or consciously leave Chorus out, as `PromptBuilderView` does.
2. The splice order in `assemblePrompt` (`[chorus, lore, steering]`) is what keeps a same-depth reminders section closest to the reply. Reordering it changes what every chat's model reads last.
3. `ChatFeatureState`'s two keys must keep separate writers. Merging them into one object brings back the lost-rename race.
4. The run's lore trace must never be stored on a turn (see A run).
5. This branch carries its own copy of the floating-window shell commits, like the other floating panels on this fork, and is not meant for upstream while that shell is not upstream.
