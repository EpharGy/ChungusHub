# The image pop-out window: architecture

A **pop-out** is one picture in a floating, dockable window that stays on screen while the reader works somewhere else in the app. It is opened from the full-screen viewer's toolbar, pages through the set it was opened from, and can be dragged to an edge to dock like the Chungus Assistant. Two files of its own: [`ImagePopoutWindow.svelte`](../src/lib/components/ui/ImagePopoutWindow.svelte) (what is in the window) and [`imagePopout.svelte.ts`](../src/lib/stores/imagePopout.svelte.ts) (which picture, and whether there is a window at all). Where the window is and how it moves is [`FloatingWindow`](../src/lib/components/ui/FloatingWindow.svelte), which is shared and documented in [`floating-window.md`](floating-window.md).

It exists because the viewer is modal and a reference picture is not. Looking at a character's art while editing their description meant closing the viewer, and the viewer is the only thing in the app that shows a picture at full size.

## The window is mounted at the shell, not beside the grid that opens it

This is the load-bearing decision and it is the one that looks like over-engineering until you try the other way. The gallery lives inside the library entry editor ([`CharacterGallery.svelte`](../src/lib/components/library/CharacterGallery.svelte) → [`EntryFormFields.svelte`](../src/lib/components/library/EntryFormFields.svelte)), so a window rendered as its child is unmounted the moment that editor closes, which is the first thing the reader does after popping a picture out, and the entire reason the feature exists. So the window is mounted once in [`AppShell.svelte`](../src/lib/components/layout/AppShell.svelte), beside the Assistant's widget and for the same second reason: it is fixed-positioned and has to paint above the workspace's isolated stacking context. What is in it comes from a store.

**The set is copied into the store, not referenced.** A window that outlives the surface which named its set cannot hold that surface's live array: nothing is maintaining it any more. The cost is that the window does not follow later gallery edits, and the payment is a missing-file state on the image itself, keyed on the path so paging to a picture that is still there clears it by itself.

**There is exactly one window.** A second needs a z-order between the two, a placement key each, and an answer to which one the arrows belong to. None of that is worth it for a picture you are keeping on screen while you work. Opening another image takes the window over and toasts, so a reader who clicked twice is never left wondering which of the two clicks they are looking at.

## The window belongs to the story being read, not to the picture

A pop-out is furniture of the chat you are in. It is bound to the **chat** that was on screen **when the picture was popped out**, and that binding is what makes it appear and disappear: opening another story closes it, coming back to that one opens it again, at the picture it was left on.

**The key is the chat, not the character.** A character with six stories running is six separate rooms, and a reference picture pinned up in one of them is not a fact about the other five. Keying on the character makes those six share one window, so a picture pinned up while working through one story follows you into every other story that character is in. It is also the same unit the notepad's notes use ([`notepad.md`](notepad.md)), which is not a coincidence: both are the reader's own scaffolding around one story.

**The binding is the reader's chat, not the picture's owner, and those are routinely different.** The library is reachable from inside any chat, so opening character A's art while reading a story about B is ordinary. That window belongs to B's story. Leaving it closes the window *even if where you are going is a story about A*, and returning brings it back, still showing A's picture. Binding to the gallery instead reads as reasonable right up to that case, where it produces a window that appears in a story nobody opened it in and refuses to leave the one they did.

The store reads the open chat itself in `show`, rather than taking it as an argument, so no call site can bind a window to the wrong story and no surface offering a pop-out has to know that chats exist. It reads the **loaded** chat rather than the active id, because the id is claimed the moment a row is clicked and the rows land a couple of hundred milliseconds later: keyed on the id, the window would swap out from under a story still on screen. Popped out with no chat open, a window belongs to nobody: the next story to open takes it away and nothing brings it back.

**Two ids, because one cannot do both jobs.** The chat read is the key; the entry whose gallery the set came from is stored beside it, since rebuilding the set on the way back in is the only thing it is for. That source may be a persona, which is why nothing in this path filters on entry type.

**It is an edge, not an invariant.** The effect in [`ImagePopoutWindow.svelte`](../src/lib/components/ui/ImagePopoutWindow.svelte) acts only when the loaded chat *changes*. Re-asserting "the window must belong to the open chat" continuously would be simpler to write and wrong: it would shut a window in the frame it opened, every time, because a picture is popped out from the library and the library is opened from inside a chat. A window is only wrong once the reader moves.

## Deletion, and the one thing the binding cannot see

Two things can take a pop-out's subject away, and they need opposite answers.

**The chat is deleted.** The reader is routed elsewhere, the loaded chat changes, and the edge above fires and puts the window away. Nothing else is needed to get it off the screen, but the *record* would survive, so the prune below drops it. Nobody is owed a notice: there is no returning to a story that no longer exists.

**The library entry the picture came from is deleted**, which sweeps that entry's image files with it. This is the case the binding cannot see at all, under any key: deleting a character happens from the library panel *inside* the story you are reading, so the chat never changes and the edge never fires. Left alone, the window sits there showing files the delete already removed, and the only thing that ever tells the reader is the image's own missing-file panel. So there is a **second effect**, and unlike the first it *is* an invariant, legitimately so, and the difference is the reason it is allowed to be. "The window belongs to the story on screen" is false for a frame every time a picture is popped out, because the library is opened from inside a chat. "The picture's gallery still exists" is never legitimately false: nothing can pop a picture out of an entry that is not there. An invariant that fights nothing costs nothing. It closes the window and says why, and it closes rather than suspends, because the picture is not coming back.

Records for *other* chats that sourced the same deleted entry are deliberately left alone. Each of those chats can still be walked back into, and `reopenFor` reads the source's gallery live, misses, and tells that reader at the moment it is worth hearing: once, dropping the record as it goes. Sweeping them in advance would take the explanation away and leave a window's absence unaccounted for.

**Closing and being closed are different acts, and the record is where they differ.** The X button forgets the picture, because the reader deciding they are done should not be undone by walking to another story and back. A character switch suspends instead: same closed window, record kept, and returning puts it back. One store method each, so no caller has to remember which it wanted.

**Only the path is stored, never the set.** It is re-read from the source entry's live gallery on the way in, which turns a picture deleted in the meantime into a miss that can be reported (a toast, and the record dropped so the notice comes once) rather than a broken image rendered out of a stale snapshot. Same reasoning as the snapshot's missing-file state, arriving at the opposite answer because a reopen has somewhere live to look and a paging window does not.

The **rectangle needs no work at all**: `FloatingWindow` re-reads its saved placement every time it opens, dock included, so a reopened picture is already the size and place the reader left it. The two records are per-device for the same reason: a rectangle means nothing on another machine's screen, and splitting the pair across the settings spine would let the halves disagree.

The record ([`popout-memory.ts`](../src/lib/utils/popout-memory.ts)) is capped at twenty chats, most-recent-first. The cap is what makes it a **bound**: it is enforced on write, by a file that is read before any store loads, so it holds no matter what else is or is not working.

The cap alone still leaves it going stale, though: twenty pictures pinned to twenty deleted chats is within the cap and is still twenty rows of nothing. So a third effect **prunes** it against the live chat list, which the window can do because it is mounted for the app's whole life and the list is loaded long before it mounts. Driving it off the list rather than out of the delete paths means one row, a batch, and a delete arriving from another device are all the same event, no delete path has to know this feature exists, and (the reason it matters for a fork) `chat.svelte.ts` is not touched at all. It writes only when something actually goes, so the ordinary case costs a read.

The key changed when the binding did, and the old character-keyed record is **swept on read, not migrated**. Turning one into the other means guessing which of that character's chats the picture was pinned up in, and guessing wrong puts a window in a story nobody opened it in, which is the exact failure the chat key exists to prevent. Dropping it costs one reader one reopen; leaving it would park a dead key in every browser forever.

## The floating shell is not this feature's

Dragging, docking, resizing and remembering where the window was left are all [`FloatingWindow`](../src/lib/components/ui/FloatingWindow.svelte), which has its own branch and its own note: [`floating-window.md`](floating-window.md). It arrived with this feature and was extracted once a second one wanted it, so that neither can be sent upstream carrying the other.

What is left here is what this window puts IN that shell, and one thing worth repeating from the other note because it shows up as a bug report about pictures: the snap anchors belong to the Assistant, so a missing one leaves the window free-floating rather than throwing. A picture is not worth a crash.

A change to how the window moves belongs on `feature/floating-window`, not here.

## Two deliberate omissions

**No launcher.** The Assistant and EchoChamber both keep a draggable button on screen when closed, because both are things you return to. A pop-out is opened from a picture and closed for good; closing destroys it. That removes about 140 lines and, more importantly, a third permanent button from the workspace edge.

**No arrow keys.** Paging is the two header buttons and nothing else. A window-level key handler would have to decide whether this window or the composer had the reader's attention, and getting that wrong steals the arrow keys from typing. The full-screen viewer can bind them because it is modal; this window is not.

Both omissions are why the window is **desktop only**. Without a launcher there is nothing to reopen it from, and a phone has nowhere to float it that is not already the full-screen viewer. `FloatingWindow` renders nothing on mobile and the toolbar button is hidden there, so the state cannot be reached rather than merely being awkward.

## The entry point is opt-in

[`ImageLightbox.svelte`](../src/lib/components/ui/ImageLightbox.svelte) is shared by four surfaces (the gallery, a chat message's attachments, an assistant tab's roster and one logged request's images) and grows an `onPopout` prop that only the gallery passes today. Opt-in rather than always-on, because the pop-out keeps a snapshot: that is right for a gallery, which changes only when the reader edits it, and wrong for a set the app is still writing to. A surface offers the button once its set is settled enough to outlive the viewer, and adding one later is a single line at that call site.

Popping out **closes the viewer**, which would otherwise cover the window it just made.
