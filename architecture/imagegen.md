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

**What this path does NOT do is `toStoredFormat`** (the client-side gate in `imageService.ts`): that gate is a browser canvas and there is no canvas on the server. Format and resolution are covered anyway — ComfyUI emits png, and dimensions come from settings already clamped to 4096 and a multiple of 8 — so what is left unenforced is the ~3.5 MB budget. Worth knowing before pointing this at a workflow that upscales to 4K.

A **failed job is reported, not waited out**: ComfyUI keeps the failure in the same history entry, so `describeFailure` digs the exception out of it rather than letting the reader watch a spinner until the timeout. The error text travels all the way to the marker, because "checkpoint not found: sdxl.safetensors" is actionable and "image generation failed" is not.

## Rendering: components, never HTML

The app's only sanitize call (`utils/markdown.ts`) allows neither `img` nor a relative URL. **Do not widen it.** Model output flows through that sanitizer, so an `img` tag it permits is a beacon any reply can fire at any host. `MessageBody` splits the body on markers instead and hands each gap to a component.

`MessageBody` renders **inside** the caller's `.prose .message-prose` element, which stays in `Message.svelte`. That is what keeps the transcript's typography and the find-in-chat `data-search-text` hook where they have always lived: those rules are descendant selectors, so any number of runs inherit them, and a second `data-search-text` would make one turn several search hits.

A turn with no marker renders as **one** element with one `use:renderedHtml`, exactly as before this existed. Every ordinary turn in the app would otherwise pay an element per run for a feature it does not use.

## Seeds and the tree

`LOCK` means "the seed the last picture used", which only a path can answer. `imagegenStore.resolveSeed` walks back from the turn through its own **ancestors**, so a swipe reuses the look of the reply it replaced rather than the look of a branch the reader has left. With nothing to lock onto (the first picture in a story), it is a random seed rather than an error.

**Retry always bypasses the seed lock.** A reader clicked it because they did not want that picture, and honouring `LOCK` there hands them the same one back.

## Where it plugs in

- `messageStore.triggerImageGeneration()` — fire-and-forget after a reply, a continuation and an opening scene, beside `triggerMemoryMaintenance`. It takes no message id: all three callers have just refreshed the chat and the turn to read is the same thing in each case, the newest assistant turn on the path.
- `imagegenStore.ensureForMessage` — every marker with no picture yet, **sequentially**. ComfyUI runs one job at a time through one GPU, so parallel requests only make the first picture arrive last.
- A marker that **failed** is not retried automatically. A broken host would otherwise be re-asked by every subsequent reply, one slow timeout at a time. The failure lives in the store (not the row) with a button beside it, because a picture that failed is a marker with no picture, which the text already describes.
- Settings ride the `settings` spine under `imagegen`, and the page is Settings → App → Image Generation. It is deliberately **not** an entry in the Engines registry: every engine there is a routing point for an LLM connection, and this one answers to a diffusion server (architecture/engines.md).

## Before touching this

- `bun test src/lib/imagegen` covers the pure half: the parser's salvage rules, the split's offsets, the locks, and settings clamping. Keep `parse.ts`, `request.ts` and `config.ts` free of `$lib` and of Svelte so they stay testable.
- **The parser is lenient on purpose.** Models drop the seed, reorder the fields, state one twice, or bury `CLOSE` in the prompt, and every one of those is a picture the reader still wants. Only two shapes fail: an empty marker, and one with no prompt left after the control tokens are taken. Repairs are recorded in `RepairMeta` rather than hidden, because a quietly repaired marker is exactly the one whose picture looks wrong to its author.
- Matching is **exact and case-sensitive**, and a bare number is only taken as a seed when it is a whole segment or a whole comma part. `close up of a wide field` is prose; `standing on platform 9432` keeps its number. Loosening either turns story text into control tokens.
- Workflow placeholders are matched **with their quotes** (`"{{STEPS}}"` → `24`), which is what keeps a number a number. The set is documented in `defaults/imagegen-workflows/README.md`; adding one means adding it there too.
- A workflow name from the page is a filename and nothing else (`safeWorkflowName`): it is joined onto a path and read off disk.
