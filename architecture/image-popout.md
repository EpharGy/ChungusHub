# The image pop-out window: architecture

A **pop-out** is one picture in a floating, dockable window that stays on screen while the reader works somewhere else in the app. It is opened from the full-screen viewer's toolbar, pages through the set it was opened from, and can be dragged to an edge to dock like the Chungus Assistant. Three files: [`ImagePopoutWindow.svelte`](../src/lib/components/ui/ImagePopoutWindow.svelte) (what is in the window), [`imagePopout.svelte.ts`](../src/lib/stores/imagePopout.svelte.ts) (which picture, and whether there is a window at all) and [`FloatingWindow.svelte`](../src/lib/components/ui/FloatingWindow.svelte) (where the window is and how it moves).

It exists because the viewer is modal and a reference picture is not. Looking at a character's art while editing their description meant closing the viewer, and the viewer is the only thing in the app that shows a picture at full size.

## The window is mounted at the shell, not beside the grid that opens it

This is the load-bearing decision and it is the one that looks like over-engineering until you try the other way. The gallery lives inside the library entry editor ([`CharacterGallery.svelte`](../src/lib/components/library/CharacterGallery.svelte) → [`EntryFormFields.svelte`](../src/lib/components/library/EntryFormFields.svelte)), so a window rendered as its child is unmounted the moment that editor closes, which is the first thing the reader does after popping a picture out, and the entire reason the feature exists. So the window is mounted once in [`AppShell.svelte`](../src/lib/components/layout/AppShell.svelte), beside the Assistant's widget and for the same second reason: it is fixed-positioned and has to paint above the workspace's isolated stacking context. What is in it comes from a store.

**The set is copied into the store, not referenced.** A window that outlives the surface which named its set cannot hold that surface's live array: nothing is maintaining it any more. The cost is that the window does not follow later gallery edits, and the payment is a missing-file state on the image itself, keyed on the path so paging to a picture that is still there clears it by itself.

**There is exactly one window.** A second needs a z-order between the two, a placement key each, and an answer to which one the arrows belong to. None of that is worth it for a picture you are keeping on screen while you work. Opening another image takes the window over and toasts, so a reader who clicked twice is never left wondering which of the two clicks they are looking at.

## The window belongs to the story being read, not to the picture

A pop-out is furniture of the chat you are in. It is bound to the character whose chat was open **when the picture was popped out**, and that binding is what makes it appear and disappear: opening another character's chat closes it, coming back to that character's opens it again, at the picture it was left on.

**The binding is the reader's character, not the picture's owner, and those are routinely different.** The library is reachable from inside any chat, so opening character A's art while reading character B is ordinary. That window belongs to B. Leaving B closes it *even if where you are going is A*, and returning to B brings it back, still showing A's picture. Binding to the gallery instead reads as reasonable right up to that case, where it produces a window that appears in a story nobody opened it in and refuses to leave the one they did.

The store reads the open chat itself in `show`, rather than taking it as an argument, so no call site can bind a window to the wrong character and no surface offering a pop-out has to know that chats exist. Popped out with no chat open, a window belongs to nobody: the next story to open takes it away and nothing brings it back.

**Two ids, because one cannot do both jobs.** The character read is the key; the entry whose gallery the set came from is stored beside it, since rebuilding the set on the way back in is the only thing it is for. That source may be a persona, which is why nothing in this path filters on entry type.

**It is an edge, not an invariant.** The effect in [`ImagePopoutWindow.svelte`](../src/lib/components/ui/ImagePopoutWindow.svelte) acts only when the active chat's character *changes*. Re-asserting "the window must belong to the open chat" continuously would be simpler to write and wrong: it would shut a window in the frame it opened, every time, because a picture is popped out from the library and the library is opened from inside a chat. A window is only wrong once the reader moves.

**Closing and being closed are different acts, and the record is where they differ.** The X button forgets the picture, because the reader deciding they are done should not be undone by walking to another story and back. A character switch suspends instead: same closed window, record kept, and returning puts it back. One store method each, so no caller has to remember which it wanted.

**Only the path is stored, never the set.** It is re-read from the source entry's live gallery on the way in, which turns a picture deleted in the meantime into a miss that can be reported (a toast, and the record dropped so the notice comes once) rather than a broken image rendered out of a stale snapshot. Same reasoning as the snapshot's missing-file state, arriving at the opposite answer because a reopen has somewhere live to look and a paging window does not.

The **rectangle needs no work at all**: `FloatingWindow` re-reads its saved placement every time it opens, dock included, so a reopened picture is already the size and place the reader left it. The two records are per-device for the same reason: a rectangle means nothing on another machine's screen, and splitting the pair across the settings spine would let the halves disagree.

The record ([`popout-memory.ts`](../src/lib/utils/popout-memory.ts)) is capped at twenty characters, most-recent-first. A prune against the library would be tighter, but this file is read before the library store loads, and a bound that needs another store is not a bound.

## The floating shell is a port of the Assistant's, not a refactor of it

`FloatingWindow` is the Assistant's widget maths (drag, seven-zone snap, eight-handle resize, tear-off-restores-free-size, persisted placement) lifted into a component that takes a header and a body. The geometry underneath it is pure and lives in [`floating-window.ts`](../src/lib/utils/floating-window.ts), tested in [`floating-window.test.ts`](../src/lib/utils/floating-window.test.ts).

[`AssistantFloatingWidget.svelte`](../src/lib/components/assistant/AssistantFloatingWidget.svelte) is deliberately **untouched**. Refactoring it to consume this would be a rewrite of a 946-line file for no behaviour, and it would put a permanent conflict on every future change to it. The duplication is the price, and extracting the maths into a module at least means the next floating window costs a header and a body rather than another 500 lines. The same trade is written down in EchoChamber's widget, which made the same call and kept its copy inline; this one is the version that can be shared.

**Docking measures the real layout rather than recomputing the CSS.** `snapRegion` is handed the rectangles of `[data-assistant-snap-workspace]` and `[data-assistant-snap-column]`, anchors Workspace and TitleBar already place for the Assistant, so a docked window tracks the chat column through zoom, a width change and a breakpoint flip with no responsive arithmetic duplicated anywhere. Those anchors belong to the Assistant, so the lookup **fails soft**: a missing one leaves the window free-floating rather than throwing, because a picture is not worth a crash. The Assistant throws on the same condition, which is right for the feature that owns the contract.

**A snapped rectangle skips the viewport clamp** on a re-fit, so the floating minimums can never push a dock off its own boundaries, and **the drag itself is unclamped** so the header can actually reach an edge; release either docks it or pulls it back. A saved placement records its dock as well as its rectangle, or reopening would silently demote a docked window to a free one wearing the dock's dimensions.

## Two deliberate omissions

**No launcher.** The Assistant and EchoChamber both keep a draggable button on screen when closed, because both are things you return to. A pop-out is opened from a picture and closed for good; closing destroys it. That removes about 140 lines and, more importantly, a third permanent button from the workspace edge.

**No arrow keys.** Paging is the two header buttons and nothing else. A window-level key handler would have to decide whether this window or the composer had the reader's attention, and getting that wrong steals the arrow keys from typing. The full-screen viewer can bind them because it is modal; this window is not.

Both omissions are why the window is **desktop only**. Without a launcher there is nothing to reopen it from, and a phone has nowhere to float it that is not already the full-screen viewer. `FloatingWindow` renders nothing on mobile and the toolbar button is hidden there, so the state cannot be reached rather than merely being awkward.

## The entry point is opt-in

[`ImageLightbox.svelte`](../src/lib/components/ui/ImageLightbox.svelte) is shared by four surfaces (the gallery, a chat message's attachments, an assistant tab's roster and one logged request's images) and grows an `onPopout` prop that only the gallery passes today. Opt-in rather than always-on, because the pop-out keeps a snapshot: that is right for a gallery, which changes only when the reader edits it, and wrong for a set the app is still writing to. A surface offers the button once its set is settled enough to outlive the viewer, and adding one later is a single line at that call site.

Popping out **closes the viewer**, which would otherwise cover the window it just made.
