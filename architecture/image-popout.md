# The gallery window: architecture

A **gallery window** is one picture from somebody's gallery, in a floating, dockable window that stays on screen while the reader works somewhere else in the app. It is raised from the title bar, browses the library for what to show, pages through the gallery it is showing, and docks like any other floating panel. Three files of its own: [`ImagePopoutWindow.svelte`](../src/lib/components/ui/ImagePopoutWindow.svelte) (what is in the window), [`imagePopout.svelte.ts`](../src/lib/stores/imagePopout.svelte.ts) (which picture, and whether there is a window at all) and [`gallery-browser.ts`](../src/lib/utils/gallery-browser.ts) (which cards it offers, pure). Where the window is, how it moves and how it is reached are all [`FloatingWindow`](../src/lib/components/ui/FloatingWindow.svelte) and the panel registry, documented in [`floating-window.md`](floating-window.md).

It exists because the full-screen viewer is modal and a reference picture is not. Looking at a character's art while editing their description meant closing the viewer, and the viewer is the only thing in the app that shows a picture at full size.

## It browses for its own picture, and that is the second version of this feature

The first version had exactly one way in: open the library, find a card, open its gallery, open the full-screen viewer, press the pop-out button. That is five steps to put a picture on screen, and, worse, five steps to put a *different* one there, because closing the window destroyed what it held. Changing your mind cost the whole journey again.

So the window carries its own browser, two levels deep: every card with at least one gallery image, then that card's pictures. Choosing one loads it. **The old entry point is gone entirely**, and that is a bigger deletion than it sounds: `ImageLightbox.svelte`, `CharacterGallery.svelte` and `EntryFormFields.svelte` are all upstream files this feature used to modify, and it now modifies none of them. The branch's diff against `main` is new files and one line in the shell.

Two rules the picker follows, both in the pure module so they can be tested:

- **Only cards with something to show.** A tile that opens onto an empty gallery is a click that teaches the reader not to trust the grid.
- **Personas before characters, alphabetical within each**, with a seam between the groups. There are always far fewer personas, so putting them first costs a character card nothing. The sort falls back to the id, because the library allows two cards to share a name and duplication produces them routinely: without the tiebreak the pair can swap places between renders for no visible reason.

The gallery is de-duplicated on the way out of that module rather than trusted. The grid keys its tiles on the path, and a keyed block handed one key twice throws, so a gallery that somehow held a path twice would take the whole window down instead of drawing the picture twice.

## The window is mounted at the shell, not beside anything that opens it

The window is mounted once in [`AppShell.svelte`](../src/lib/components/layout/AppShell.svelte) rather than inside whatever raised it, for the reason every floating panel is: it has to outlive that surface, and it is fixed-positioned above the workspace's isolated stacking context. What is in it comes from a store.

That decision predates the browser and was load-bearing before it: the only way in used to be a grid inside the library editor, so a window rendered as its child died the moment that editor closed, which was the first thing the reader did after popping a picture out. The browser removes the surface that made the point, and the point stands anyway, which is usually the sign it was the right shape.

**The set is copied into the store, not referenced.** A window that outlives the surface which named its set cannot hold that surface's live array: nothing is maintaining it any more. The cost is that the window does not follow later gallery edits, and the payment is a missing-file state on the image itself, keyed on the path so paging to a picture that is still there clears it by itself.

**There is exactly one window.** A second needs a z-order between the two, a placement key each, and an answer to which one the arrows belong to. None of that is worth it for a picture you are keeping on screen while you work. Choosing another image takes the window over, silently: there used to be a notice, because a picture arrived from a viewer somewhere else in the app and replacing one without a word was a surprise. Picking from the window's own browser is not a surprise, since the reader is looking at the window while it happens.

## The window belongs to the story being read, not to the picture

The window is furniture of the chat you are in. It is bound to the **chat** that was on screen **when the picture was chosen**, and that binding is what makes it appear and disappear: opening another story closes it, coming back to that one opens it again, at the picture it was left on.

**The key is the chat, not the character.** A character with six stories running is six separate rooms, and a reference picture pinned up in one of them is not a fact about the other five. Keying on the character makes those six share one window, so a picture pinned up while working through one story follows you into every other story that character is in. It is also the same unit the notepad's notes use ([`notepad.md`](notepad.md)), which is not a coincidence: both are the reader's own scaffolding around one story.

**The binding is the reader's chat, not the picture's owner, and those are routinely different.** The library is reachable from inside any chat, so opening character A's art while reading a story about B is ordinary. That window belongs to B's story. Leaving it closes the window *even if where you are going is a story about A*, and returning brings it back, still showing A's picture. Binding to the gallery instead reads as reasonable right up to that case, where it produces a window that appears in a story nobody opened it in and refuses to leave the one they did.

The store reads the open chat itself in `show`, rather than taking it as an argument, so the picker cannot bind a window to the wrong story and does not have to know that chats exist. It reads the **loaded** chat rather than the active id, because the id is claimed the moment a row is clicked and the rows land a couple of hundred milliseconds later: keyed on the id, the window would swap out from under a story still on screen. There is no loading a picture with no chat open: the title bar entry is disabled on the welcome screen, for the notepad's reason, because a picture pinned to no story is pinned to nothing.

**Two ids, because one cannot do both jobs.** The chat read is the key; the entry whose gallery the set came from is stored beside it, since rebuilding the set on the way back in is the only thing it is for. That source may be a persona, which is why nothing in this path filters on entry type.

**It is an edge, not an invariant.** The effect in [`ImagePopoutWindow.svelte`](../src/lib/components/ui/ImagePopoutWindow.svelte) acts only when the loaded chat *changes*. Re-asserting "the window must belong to the open chat" continuously would be simpler to write and wrong: it would shut a window in the frame it opened, every time, because choosing a picture happens inside the window while a chat is on screen. A window is only wrong once the reader moves.

## Deletion, and the one thing the binding cannot see

Two things can take the window's subject away, and they need opposite answers.

**The chat is deleted.** The reader is routed elsewhere, the loaded chat changes, and the edge above fires and puts the window away. Nothing else is needed to get it off the screen, but the *record* would survive, so the prune below drops it. Nobody is owed a notice: there is no returning to a story that no longer exists.

**The library entry the picture came from is deleted**, which sweeps that entry's image files with it. This is the case the binding cannot see at all, under any key: deleting a character happens from the library panel *inside* the story you are reading, so the chat never changes and the edge never fires. Left alone, the window sits there showing files the delete already removed, and the only thing that ever tells the reader is the image's own missing-file panel. So there is a **second effect**, and unlike the first it *is* an invariant, legitimately so, and the difference is the reason it is allowed to be. "The window belongs to the story on screen" is false for a frame every time a picture is chosen. "The picture's gallery still exists" is never legitimately false: nothing can load a picture from an entry that is not there. An invariant that fights nothing costs nothing. It **unloads** and says why, leaving the frame standing, because what has gone is the picture and not the window.

Records for *other* chats that sourced the same deleted entry are deliberately left alone. Each of those chats can still be walked back into, and `restoreFor` reads the source's gallery live, misses, and tells that reader at the moment it is worth hearing: once, dropping the record as it goes. Sweeping them in advance would take the explanation away and leave a window's absence unaccounted for.

## The window being up and a picture being loaded are two different facts

They used to be one boolean, and with one way in and one way out that was honest: there was no such thing as an empty window, and closing meant you were finished with the picture. Browsing from inside the window makes both halves wrong at once. The reader can want the frame with nothing in it, and can want the picture kept while the frame is away, and neither is expressible.

So they are separate, and the header's two buttons are exactly that split:

| Button | Icon | Drawn by | Touches | Means |
|---|---|---|---|---|
| Clear | trash | this panel | the picture | empties the window, forgets the picture for this story, frame stays up |
| Hide | dash | `FloatingWindow` | the window | puts the frame away, keeps the picture, title bar entry brings it back |

The second is not this feature's to draw. It passes `onHide` and the shell renders it, in the same corner as every other panel's, which is what stops two panels spelling one act two ways. The glyphs for the shared acts come from `PANEL_ICONS`; see the layer's note.

**Minimise, not close, and the icon says so.** Putting a panel away must not destroy what is in it, because the title bar is one press from bringing it back. The one destructive door is Clear, and it wears the icon the notepad's Clear wears, because it is the same act. **No X anywhere on a floating panel**: an X in a window header reads as "close this window", and closing is precisely what the dash beside it does without destroying anything, so the two would be saying the same thing in two glyphs with two different consequences.

**There is no browse button.** There was, and its icon was the problem that found the better shape: the only sensible glyph left was `gallery`, two tall rounded rectangles, which at sixteen pixels is a pause symbol. Rather than hunt for a third icon, the button went. The picker is reached from the empty window's own "Choose an image", which is a labelled control rather than a glyph anybody has to decode, and Clear is what gets you back to an empty window. Swapping one picture for another costs two presses instead of one, which is the price, and it buys a header of two buttons whose meanings nobody has to guess.

That is also why Clear is enabled **while the picker is open**. The picker is only ever reached from an empty window, so there was otherwise no way out of it except choosing something. Removing a loaded picture and abandoning a half-finished choice both end in the same place, an empty window offering to choose, so they are one button rather than a remove and a cancel sitting side by side doing the same thing.

Both facts are remembered per chat, in **one** record rather than two. A window can be down with a picture behind it, or up with nothing in it, and a record that is neither is not written at all: it says nothing, so storing it would be a row that can never affect anything. Records written before the window could stand empty carry no flag, and every one of them described a window that was up, because that was the only thing the old shape could mean. Reading a missing flag as "up" is therefore the whole migration, and it needs no version stamp and loses nothing.

**Only the path is stored, never the set.** It is re-read from the source entry's live gallery on the way in, which turns a picture deleted in the meantime into a miss that can be reported (a toast, and the record dropped so the notice comes once) rather than a broken image rendered out of a stale snapshot. Same reasoning as the snapshot's missing-file state, arriving at the opposite answer because a reopen has somewhere live to look and a paging window does not.

The **rectangle needs no work at all**: `FloatingWindow` re-reads its saved placement every time it opens, dock included, so a reopened picture is already the size and place the reader left it. The two records are per-device for the same reason: a rectangle means nothing on another machine's screen, and splitting the pair across the settings spine would let the halves disagree.

The record ([`popout-memory.ts`](../src/lib/utils/popout-memory.ts)) is capped at twenty chats, most-recent-first. The cap is what makes it a **bound**: it is enforced on write, by a file that is read before any store loads, so it holds no matter what else is or is not working.

The cap alone still leaves it going stale, though: twenty pictures pinned to twenty deleted chats is within the cap and is still twenty rows of nothing. So a third effect **prunes** it against the live chat list, which the window can do because it is mounted for the app's whole life and the list is loaded long before it mounts. Driving it off the list rather than out of the delete paths means one row, a batch, and a delete arriving from another device are all the same event, no delete path has to know this feature exists, and (the reason it matters for a fork) `chat.svelte.ts` is not touched at all. It writes only when something actually goes, so the ordinary case costs a read.

The key changed when the binding did, and the old character-keyed record is **swept on read, not migrated**. Turning one into the other means guessing which of that character's chats the picture was pinned up in, and guessing wrong puts a window in a story nobody opened it in, which is the exact failure the chat key exists to prevent. Dropping it costs one reader one reopen; leaving it would park a dead key in every browser forever.

## The floating shell is not this feature's

Dragging, docking, resizing and remembering where the window was left are all [`FloatingWindow`](../src/lib/components/ui/FloatingWindow.svelte), which has its own branch and its own note: [`floating-window.md`](floating-window.md). It arrived with this feature and was extracted once a second one wanted it, so that neither can be sent upstream carrying the other.

What is left here is what this window puts IN that shell, and one thing worth repeating from the other note because it shows up as a bug report about pictures: the snap anchors belong to the Assistant, so a missing one leaves the window free-floating rather than throwing. A picture is not worth a crash.

A change to how the window moves belongs on `feature/floating-window`, not here.

## One deliberate omission

**No arrow keys.** Paging is the two header buttons and nothing else. A window-level key handler would have to decide whether this window or the composer had the reader's attention, and getting that wrong steals the arrow keys from typing. The full-screen viewer can bind them because it is modal; this window is not.

The other omission used to be a launcher, on the grounds that a window made from a picture has nothing for a cold press to do. The browser answered that: the title bar entry is an ordinary toggle now, the same shape as the notepad's, and the panel registry gives it a place to live. See [`floating-window.md`](floating-window.md).

That entry is worth more here than uniformity would make it. The window paints on the floating-window layer, deliberately under Settings and the Library, so a reader who opens either loses sight of the window and every button on it. On a phone, where both are full-screen, it disappears completely. The title bar is above all of it at every width, so the entry is the one control that can always be reached.

## It works on a phone

It did not. The shell rendered nothing on mobile, the old launch path hid its button there, and `followChat` skipped: the state could not be reached rather than merely being awkward, and the reasoning was that without a launcher there was nothing to reopen the window from and nowhere to float it that was not already the full-screen viewer.

Half of that was answered by the registry, and half by the shell growing a full-screen mobile panel. The remaining objection was that a full-screen picture on a phone looks like the viewer it was opened from, and it is worth saying why that is not an argument: the viewer closes with the library, and this window stays up while the reader goes back to the story. Outliving the surface that opened it is the entire feature, and a phone is where the library covers everything, so it is worth more there rather than less.

Thumbnails are what the two grids draw, by the derived path, with `loading="lazy"` on every tile. A thumbnail is an optimization and never a distinct asset (`resolveImageFile`, server/files.ts), so a card that has never had one built answers with the original beside it: the grid is heavier and never broken. Building them on the way into the picker was considered and refused. The encoder is the browser, so it would mean a download, a decode and an upload per image, which is slower than showing the originals, turns a browse into a server write, and duplicates Settings -> Advanced -> Rebuild thumbnails, which already does it once, explicitly, with progress, and for the whole app rather than for this grid.
