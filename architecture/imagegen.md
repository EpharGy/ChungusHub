# Image generation: architecture & maintenance

The model writes `[[IMG: prompt | AR | SHOT | SEED ]]` into a reply; the engine turns each marker into a picture from a local ComfyUI and draws it where the marker stands. Ported from the SillyTavern extension [ComfyInject](https://github.com/Spadic21/ComfyInject) (AGPL-3.0, like this app), with three of its structural problems solved by the things this app already has.

**The one thing to internalise before touching anything here:** the turn's stored text is **never rewritten**. The marker stays in the row and the picture is filed against its *index*, and every rule below follows from that.

## Why the text is left alone

A marker replaced by an `<img>` tag is the obvious design, and it costs three things at once:

- **An edit stamp.** Rewriting content sets `edited_at`, and chat memory reads that stamp to decide a summary is stale (architecture/memory.md). Every generated picture would kill the episode covering its turn and pay to re-read it.
- **The continuity trick.** Because the marker survives, the model sees its own previous prompts in the history next turn and keeps a character looking like themselves across pictures. ComfyInject needs a whole outbound interceptor to rebuild that from `<img>` tags; here it is what the row already says. If you ever want the markers hidden from the reader, that is a **display-scope regex rule**, not a rewrite (architecture/prompt-pipeline.md).
- **Reversibility.** Deleting a picture puts its marker back, because the marker never left. Nothing has to reconstruct what the model wrote.

`findMarkers` ([`parse.ts`](../src/lib/imagegen/parse.ts)) re-derives indices and offsets from the text on every read, like memory's derived boundary: an edit that adds or removes a marker re-indexes the rest in the same tick, with nothing stored to fall out of step.

The cost is real and worth naming: an edit that inserts a marker *before* an existing one shifts what every later index means, so pictures after the insertion point now sit against the wrong markers. A stored offset would not survive that edit either (it would point into moved text), and re-anchoring by prompt text guesses. The reader's fix is Retry on the pictures that moved, which is one click each and cannot corrupt anything.

## Storage: one attachment list, one flag

A generated picture is a `MessageAttachment` with a `generated` block (`types/chat.ts`), stored in the same `attachments_json` column as the pictures a reader attaches themselves. That is deliberate rather than lazy: the refcount sweep, `dropOrphanedChatImages`, the branch/fork copy path and the backup inventory all read that column, and a second home for generated art would need every one of them taught about it (architecture/server-core.md).

The flag decides one thing only: **where the picture is drawn**. `generated` set → at its marker, inside the body ([`MessageBody.svelte`](../src/lib/components/chat/MessageBody.svelte)); absent → the attachment strip, where it always was.

`updateMessageAttachments` (db.ts) writes the list **whole**, and must keep doing so: a partial write either strands a file the sweep will reap or frees one that is still on screen.

## The server dials ComfyUI, not the page

[`server/imagegen/comfy.ts`](../server/imagegen/comfy.ts) submits the workflow, polls `/history`, fetches `/view` and stores the bytes. Two things follow, and both are the reason it is not in the browser:

1. **No `--enable-cors-header`.** A page talking to ComfyUI directly needs it started with that flag, which is the single most common reason the feature looks broken. The server has no such rule.
2. **The picture is kept.** A `/view` URL is only good while ComfyUI is running, so a chat read with the GPU box asleep would be a column of broken images. The bytes land in `images/chat/` and are refcounted, swept and backed up like any other picture.

**What this path does NOT do is `toStoredFormat`** (the client-side gate in `imageService.ts`): that gate is a browser canvas and there is no canvas on the server. Format and resolution are covered anyway - ComfyUI emits png, and dimensions come from settings already clamped to 4096 and a multiple of 8 - so what is left unenforced is the ~3.5 MB budget. Worth knowing before pointing this at a workflow that upscales to 4K.

A **failed job is reported, not waited out**: ComfyUI keeps the failure in the same history entry, so `describeFailure` digs the exception out of it rather than letting the reader watch a spinner until the timeout. The error text travels all the way to the marker, because "checkpoint not found: sdxl.safetensors" is actionable and "image generation failed" is not.

## Rendering: components, never HTML

The app's only sanitize call (`utils/markdown.ts`) allows neither `img` nor a relative URL. **Do not widen it.** Model output flows through that sanitizer, so an `img` tag it permits is a beacon any reply can fire at any host. `MessageBody` splits the body on markers instead and hands each gap to a component.

`MessageBody` renders **inside** the caller's `.prose .message-prose` element, which stays in `Message.svelte`. That is what keeps the transcript's typography and the find-in-chat `data-search-text` hook where they have always lived: those rules are descendant selectors, so any number of runs inherit them, and a second `data-search-text` would make one turn several search hits.

A turn with no marker renders as **one** element with one `use:renderedHtml`, exactly as before this existed. Every ordinary turn in the app would otherwise pay an element per run for a feature it does not use.

**A row naming a picture that is not on disk falls back to the placeholder**, rather than drawing the browser's broken-image glyph. `GeneratedImage` records the url whose fetch failed (the url, not a flag, so a retry's new url clears it with nothing having to reset anything) and renders the same "not generated yet" branch, because that is what it now is: the marker never left the text. Three unremarkable things reach that state - a restored backup older than the picture, a hand-tidied `images/chat/`, and the size budget below - and all three want the same Generate button.

## Cleanup: nothing here is a folder anyone has to weed

A generated picture is an ordinary `images/chat/` file, so it inherits the whole lifecycle that column already has (`server/db.ts`, "Chat image attachments"), and inherits it **for free**: `imagePathsIn` reads `item.path` off the blob, and a generated attachment is an item with a path.

| What the reader does | What reaps the file |
|---|---|
| Deletes the chat | `deleteChat` → `dropOrphanedChatImages` |
| Deletes one turn | `deleteMessageOnly` → same |
| Deletes a branch or a subtree ("start this part over") | `deleteMessageAndDescendants` / `deleteDescendants` → same |
| Retries a picture, or removes one from its marker | `updateMessageAttachments` sweeps what the row stopped pointing at |
| Anything else that ends up referenced by nothing | `sweepAbandonedChatImages` at boot, one-hour grace |
| Sets a size budget, or presses Clean up | `sweepGeneratedImageCache`, oldest first, one-hour grace (below) |

Every one of those is **reference counted, after the write**. A branch or fork copies the attachment list, so several rows can point at one file and it dies only when the last of them lets go - which is why the retry sweep asks the rows again rather than deleting what it just replaced.

**`updateMessageAttachments` must keep sweeping.** Without it a retried picture is unreferenced but undeleted until the next server start, and a reader tuning a look through a dozen retries is the exact case that makes that visible.

**ComfyUI's own output folder is not ours and is not needed.** The bytes are copied into `images/chat/` at generation time, so ComfyUI's `output/` can be emptied whenever the reader likes with no effect on any chat - the difference from hotlinking, where clearing it breaks every picture ever posted. A workflow ending in `PreviewImage` rather than `SaveImage` writes to ComfyUI's `temp/` (cleared on its restart) and works here, because the folder comes back with the filename from `/history` rather than being assumed.

## The size budget: the one sweep that deletes a live picture

Every sweep above reaps a file nothing points at any more. `sweepGeneratedImageCache` is the other kind - it deletes pictures that **are** still pointed at, because there are too many of them - and the only reason that is defensible is the rule at the top of this file: the marker never leaves the text. A picture taken away leaves a marker with a Generate button, not a hole, so the cache is a cache rather than an archive. A photo the reader attached is not recoverable that way, which is why the two are told apart by the `generated` block and never by the folder they share.

Three rules carry it, and each one is a way this could quietly eat something it should not:

- **Generated on both sides of the sum.** The budget is measured over exactly the set the sweep may delete. Sizing against everything in `images/chat/` while deleting only the generated half deletes every picture the engine ever made and still reports itself over budget, because the uploads it may not touch are what put it there.
- **Files, not references.** A branch or fork copies the attachment list, so one picture can be named by several turns and is freed only when the last lets go. Counting references would promise bytes no delete can return.
- **One transaction, one broadcast.** A sweep can rewrite hundreds of rows. Putting each through `updateMessageAttachments` would fire a `messages` broadcast per row for every other device to answer with a refetch.

**A budget of 0 means no budget**, and that is what ships. A size limit arriving in a settings sync and quietly reaping a reader's pictures is a surprise; naming a number is the consent.

**The one-hour grace wins over the budget.** Nothing generated in the last hour goes, so a budget that can only be met by reaching into this evening's work is left unmet rather than forced - the alternative is pictures vanishing out of the reply someone is reading. Because the plan is sorted by the same `createdAt` the window tests, everything behind a picture too new to take is newer still, so the walk stops rather than skipping.

**Where it runs is a deliberate short list.** After a picture lands, because that is the only event that grows the cache, and from the button in Settings → App → Image Generation. Chat load and message send were both considered and are both wrong: neither adds a picture, so both would spend the walk to be told nothing changed, on the two paths where the reader is most obviously waiting.

**A file the sweep cannot find is not an error.** `server/imagegenCache.test.ts` pins the four refusals above against real files; note that it writes under `IMAGES_ROOT` rather than its own temp dir, because that const is frozen at first import while the db handle rebinds per test file, and `deleteImage` resolves against the const.

## Seeds and the tree

`LOCK` means "the seed the last picture used", which only a path can answer. `imagegenStore.resolveSeed` walks back from the turn through its own **ancestors** (`findActivePath` from the row, not a slice of the open path), so a swipe reuses the look of the reply it replaced rather than the look of a branch the reader has left. With nothing to lock onto (the first picture in a story), it is a random seed rather than an error.

**Retry always bypasses the seed lock.** A reader clicked it because they did not want that picture, and honouring `LOCK` there hands them the same one back.

## Where it plugs in

- `messageStore.triggerImageGeneration(messageId)` - fire-and-forget after a reply, a continuation and an opening scene, beside `triggerMemoryMaintenance`. Each caller names the row it just wrote. Named rather than scanned for: a scan of the open path answers "whatever turn is newest right now", which is the turn that just landed only while the reader stays put, so walking to another branch or another chat mid-generation would hang one turn's markers on another turn's row. A row that is not in the open chat resolves to nothing.
- `imagegenStore.ensureForMessage` - every marker with no picture yet, **sequentially**. ComfyUI runs one job at a time through one GPU, so parallel requests only make the first picture arrive last.
- A marker that **failed** is not retried automatically. A broken host would otherwise be re-asked by every subsequent reply, one slow timeout at a time. The failure lives in the store (not the row) with a button beside it, because a picture that failed is a marker with no picture, which the text already describes.
- **One reachability check per turn, and the first failure ends the turn.** Those two rules exist because the per-marker failure record above does not cover a turn carrying several markers: the failure is recorded against ONE marker, so the next marker has no record of its own and is asked anyway, and a reply with three markers spends three connection timeouts arriving nowhere. `hostAnswers` pings once (five seconds, ceiling included) before anything is generated, and only once something is actually pending, so a turn with no markers to make still costs nothing. A failed check is deliberately **not** written to `failures`: nothing about it says a marker is broken, only that now was a bad time to ask, so the next turn asks again on its own. The outage is toasted once, not once per turn.
- **The buttons on a marker ignore all of it.** `generateOne` and `retry` never consult the check and never ping - a reader who clicked is asking for an attempt whatever the engine last concluded, and a picture that comes back clears the outage, which is how a manual retry brings the automatic path back with it.
- Settings ride the `settings` spine under `imagegen`, and the page is Settings → App → Image Generation. It is deliberately **not** an entry in the Engines registry: every engine there is a routing point for an LLM connection, and this one answers to a diffusion server (architecture/engines.md).

## Before touching this

- `bun test src/lib/imagegen` covers the pure half: the parser's salvage rules, the split's offsets, the locks, and settings clamping. Keep `parse.ts`, `request.ts` and `config.ts` free of `$lib` and of Svelte so they stay testable.
- `bun test server/imagegenCache.test.ts` covers the size budget against the real database and real files: that an upload is neither counted nor taken, that a shared file outlives one of its two turns, that the grace window beats the budget, and that 0 means no budget. Each is a way the sweep could delete something it must not, so they are worth more than they look.
- `bun test src/lib/stores/imagegen-preflight.test.ts` covers the half that is not pure: how a turn sequences its calls when the host is not there. It shims `$state` and mocks the five modules the store reaches for, following `new-chat-flow.test.ts`. What it pins is a count - one ping, one generation attempt - so deleting either rule turns it red rather than leaving a comment nobody reads.
- **The parser is lenient on purpose.** Models drop the seed, reorder the fields, state one twice, or bury `CLOSE` in the prompt, and every one of those is a picture the reader still wants. Only two shapes fail: an empty marker, and one with no prompt left after the control tokens are taken. Repairs are recorded in `RepairMeta` rather than hidden, because a quietly repaired marker is exactly the one whose picture looks wrong to its author.
- Matching is **exact and case-sensitive**, and a bare number is only taken as a seed when it is a whole segment or a whole comma part. `close up of a wide field` is prose; `standing on platform 9432` keeps its number. Loosening either turns story text into control tokens.
- Workflow placeholders are matched **with their quotes** (`"{{STEPS}}"` → `24`), which is what keeps a number a number. The set is documented in `defaults/imagegen-workflows/README.md`; adding one means adding it there too.
- A workflow name from the page is a filename and nothing else (`safeWorkflowName`): it is joined onto a path and read off disk.
