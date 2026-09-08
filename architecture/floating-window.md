# The floating panel layer: architecture

A **floating panel** is a window that floats above the app: draggable by its header, resizable from eight handles, dockable against an edge or a corner, remembered where you left it, reachable from the title bar, and a full-screen panel on a phone. A feature that wants one supplies a header, a body and a registration, and gets all of that.

Five files, in two halves that never mix:

| File | Holds |
|---|---|
| [`FloatingWindow.svelte`](../src/lib/components/ui/FloatingWindow.svelte) | The window: pointer handling, the portal, the measured anchors |
| [`floating-window.ts`](../src/lib/utils/floating-window.ts) | Its geometry, pure ([tests](../src/lib/utils/floating-window.test.ts)) |
| [`floating-window-stack.ts`](../src/lib/utils/floating-window-stack.ts) | Which window is in front ([tests](../src/lib/utils/floating-window-stack.test.ts)) |
| [`floating-panels.svelte.ts`](../src/lib/stores/floating-panels.svelte.ts) | The registry: who has a panel |
| [`floating-panels.ts`](../src/lib/utils/floating-panels.ts) | What a registration is, and how the title bar arranges them, pure ([tests](../src/lib/utils/floating-panels.test.ts)) |

The layer has no behaviour of its own to show. It exists so that the next thing wanting a floating panel costs a header, a body and eight lines instead of five hundred, and so that the eight lines do not include an edit to anybody else's file.

## It is a port of the Assistant's widget, not a refactor of it

The maths here (drag, seven-zone snap, eight-handle resize, tear-off-restores-free-size, persisted placement) is [`AssistantFloatingWidget.svelte`](../src/lib/components/assistant/AssistantFloatingWidget.svelte)'s, lifted into a component that takes slots.

**The Assistant is deliberately untouched.** Refactoring a 946-line file to consume this would be a rewrite for no behaviour anyone can see, and it would put a permanent conflict on every future change to it. The duplication is the price. What extracting the geometry buys is not the removal of that copy but the cost of the *next* window, and EchoChamber's widget is the evidence: it faced the same choice, kept its copy inline, and there was nothing to share with.

## The geometry is pure and lives in its own module

`floating-window.ts` holds `clampRect`, `centeredRect`, `snapZoneFor`, `snapRegion` and the placement reader/writer, none of which touch the DOM. The split is what lets the snap zones and the clamping be tested without a browser, which matters because those are the rules nobody notices until a window opens half off-screen on a laptop.

The component keeps only what genuinely needs the DOM: pointer capture, the measured anchors, and the effects that re-fit on a layout change.

## Docking measures the real layout instead of recomputing the CSS

`snapRegion` is handed the rectangles of `[data-assistant-snap-workspace]` and `[data-assistant-snap-column]`, anchors that Workspace and TitleBar already place. So a docked window tracks the chat column through zoom, a width change and a breakpoint flip with no responsive arithmetic duplicated in JavaScript.

Those anchors belong to the Assistant, not to this component, so the lookup **fails soft**: a missing one leaves the window free-floating rather than throwing. A borrowed DOM contract is not worth a crash. The Assistant throws on the same condition, which is right for the feature that owns it and wrong for a guest.

Two rules that look like bugs and are not:

- **A snapped rectangle skips the clamp** on a re-fit, so the floating minimums can never push a dock off its own boundaries.
- **The drag itself is unclamped**, so the header can actually reach an edge. Release either docks it or pulls it back.

The workspace anchor does a second job: it is also the **bounds a free-floating window is clamped to**, in place of the viewport. Windows paint on a rung inside the workspace (see the next section), so the title bar and the notification rows above it draw over one rather than under it. A window allowed to settle at the top of the screen would tuck its own header, which is its only drag handle, behind the title bar and become unmovable. Clamping to the region it can actually be seen in makes that unreachable rather than merely unlikely, and `clampRect` therefore takes a `Rect` rather than a `Size`. On the shapes this app has, the two differ only along the top.

A saved placement records its **dock as well as its rectangle**, or reopening would silently demote a docked window to a free one wearing the dock's dimensions.

## Where a window paints is decided by a layer, not by a number

A floating window is mounted at the app shell, because it has to outlive whatever opened it: the image pop-out is launched from a gallery inside the library editor, and the first thing anyone does after popping a picture out is close that editor. But the shell is the wrong place to *paint* from. `.workspace-main` sets `isolation: isolate`, so from outside, the whole workspace is one flat layer: the chat, Settings and the Library are sealed in together, and no z-index at the shell lands between them. Every value is either above all three or below all three, and below all three is behind an opaque chat.

So the component **portals itself** into `[data-floating-window-layer]`, an empty host [`Workspace.svelte`](../src/lib/components/layout/Workspace.svelte) places inside that isolated context on its own rung: above the chat (1) and the welcome landing (10), below the chat-area overlays (20) and the two docks (25). That one placement is what makes a window sit under Settings and the Library while still covering the chat, and it belongs to the layer, so the next window gets it by existing rather than by remembering a number.

Three details hold it up:

- **The moved node is a wrapper outside `{#if open}`, never the window itself.** It mounts and unmounts with the component, so the effect that moved it cannot outlive it, and everything Svelte creates and destroys on `open` stays inside a parent Svelte still owns. Portalling the window instead would tear it out the instant `open` went false and cut its own exit transition. This is the safe end of the always-mounted portal trap that `ImageLightbox` documents from the other side in [`ui-shell-settings.md`](ui-shell-settings.md).
- **The layer and the wrapper are both `pointer-events: none`.** Each is a viewport-sized box sitting above the chat, and either one left clickable would swallow every press meant for the conversation underneath. The window takes its own back with `pointer-events: auto`, and its events still pass up through both, which is what lets the raise handlers live on the wrapper instead of being repeated on the header, the body and eight resize handles.
- **A missing layer fails soft**, like the snap anchors above: the window stays where it was mounted and paints over the workspace rather than throwing.

The rung is a bare number in a stylesheet next to nine other bare numbers, and nothing in the CSS says which ones it has to sit between, so [`contracts.test.ts`](../src/lib/contracts.test.ts) asserts the ordering: raise the layer above an overlay or drop it under the chat and `bun test` fails, rather than the panel quietly going back to covering half the app.

The Chungus Assistant is not in this layer and paints above all of it. See **Not in the layer** at the end.

## Front to back: one ladder, and docking is not a tier

[`floating-window-stack.ts`](../src/lib/utils/floating-window-stack.ts) hands out rungs. Opening a window takes the top rung and so does touching one, so the last window clicked is the frontmost and every other open window keeps its order underneath. A **docked window is on the same ladder as a free-floating one**: clicking a notepad docked down the left edge raises it over a pop-out lying on top of it, because "docked" is a shape the window is in and not a layer it lives on. Nothing in the stack module knows docking exists, which is what guarantees there is no second tier for a dock to fall into.

The rungs are a monotonic counter rather than a re-sorted array. Re-sorting would rewrite every window's z-index whenever any one of them was clicked, and each of those is a style write on a panel that did not move; handing out an ever-higher number touches only the window that was raised. `bringToFront` returns the rung unchanged when it is already the top one, so clicking the frontmost window repeatedly does not walk the counter up on its own. The values are consumed inside the layer, which is its own stacking context, so they are only ever compared with each other and never collide with the app's z-index scale.

Raising is bound to `pointerdown` in the capture phase **and** to `focusin`, both on the wrapper. The capture phase, because a press should raise the window whether or not whatever it landed on goes on to handle the event. `focusin`, because a window tabbed into from behind another would otherwise be taking typing from underneath it.

## Placement is per device, and the key is the caller's

`storageKey` is a `localStorage` key the caller supplies, one per window kind. Per device because a rectangle means nothing on another machine's screen, and out on the caller because two windows must not fight over one placement.

A window re-reads its placement **every time it opens**, dock included, so anything reopened is already the size and place it was left.

## Every panel registers, and the title bar reads the registry

A window nobody can open is a window that closes once. So a panel calls `registerFloatingPanel` from its own module, and the title bar renders what it finds beside Preset Controls, Story Map and Memory, where the reader already looks for what belongs to the story they are in.

**Registration is a call, not a row in a table**, and that is the one decision here made for the fork rather than for the app. The obvious shape is an array of definitions in one file, which is what `engines/registry.ts` and `config/settings-pages.ts` both are. But a panel arrives on its own topic branch, so a shared table is a line every branch adds in the same place, and that is a conflict re-fought on every single rebuild. The notepad is the evidence: it used to add its button by hand, and its diff against this branch touched 111 lines of `TitleBar.svelte`. It now touches none of them.

The cost is that registration rides an import, so a panel is registered only once something has imported its module. In practice the app shell mounts every panel's window, which imports its store, which registers: the chain that makes the panel exist is the chain that registers it, and a panel that is somehow not mounted has no window to open either.

**Every registered panel gets an entry, and that is not an option.** A flag would allow a panel with no entry point at all, which is the one configuration that cannot work. It also keeps the title bar the single place a reader looks for "what can I open", instead of the answer being spread across a title bar, a settings page and whichever widget pinned a launcher to the edge of the screen.

Four consequences worth knowing:

- **Everything reactive on an entry is a getter.** An entry is declared once, at module scope, and describes a panel whose state changes every turn. Values captured at registration would be the state at boot, forever.
- **`available` and `disabled` are different questions.** Absent versus present-and-inert. The notepad on the welcome screen is `disabled`, because hiding it would shift the whole centred cluster sideways the moment a chat opened. The image pop-out is `available` only while a window is out, because there is no such thing as opening one cold.
- **Past `TOPBAR_INLINE_LIMIT` the WHOLE set collapses into one dropdown**, not just the overflow. A row that is part buttons and part menu makes opening the notepad cost one click or two depending on how many unrelated features happen to be installed, and nothing on screen says which.
- **The label-width rule is computed from that limit**, not tuned beside it. The limit is the row's widest state exactly, since past it the panels become one chevron and the row narrows again, so raising the limit cannot silently leave the bar clipping labels it no longer has room for.

**There is no settings page for this layer, deliberately.** Registration is the whole API and the entry is the whole control surface. A page whose every row reads "show the button for the panel you can already see a button for" is a page that exists to be configured and never is.

## On a phone it is one full-screen panel

The panel takes the workspace whole, flush, with no radius and no shadow: the same treatment a dock gets, for the same reason. Drag, resize and the seven zones are all off, there being nowhere to float on a screen the panel already fills. Placement is neither read nor written there, so a visit from a phone cannot overwrite the rectangle a desktop left behind.

The **workspace** and not the viewport, for the reason `clampRect` gives at length: a panel spanning the viewport tucks its own header under the title bar, and on a phone that costs the close button rather than the drag handle.

This used to render nothing at all on mobile, and the reasoning was that a floating window needs a launcher to come back from and a launcher pinned to a phone screen is clutter with no home. **The registry retired that premise**: every panel is reachable from the title bar at every width. A phone was being handed an entry point that did nothing, rather than the panel.

The ladder still applies there and matters more, not less: full-screen panels hide each other completely, so which one is on top is the whole of what the reader sees.

## Why it is its own branch

Because several features want it: the image pop-out, which brought it, the chat notepad, and a panel on a private topic. A layer owned by one of them makes the others impossible to send upstream on their own, since their diff against `main` would drag a whole unrelated feature along.

Cut from `main`, with the consumers cut from here, they are **siblings**: any can be retired with a one-line edit to `$Topics`, and any can be opened as a pull request carrying this layer and nothing else it does not need.

A change to how a panel drags, docks, resizes or offers itself belongs on this branch, never on a consumer's, even when a consumer is what wanted it. The registry is what makes that rule cheap to keep: a consumer that needs an entry point no longer has any reason to reach into `TitleBar` and leave a copy of this layer's business behind on its own branch.

## Not in the layer

**The Chungus Assistant** still paints above everything, Settings included, and keeps its own copy of the geometry this module was lifted from. Same call as the rest of this branch: it is a 946-line upstream file, so moving it would be a behaviour change to upstream's own widget rather than to this layer, and rewriting it to consume this would buy a permanent conflict on every future upstream change to it. A visible inconsistency, not an oversight.

**EchoChamber** keeps its own copy too, and unlike the Assistant it has no upstream reason to: the comment at the top of that widget says extracting a shared shell would have meant rewriting the Assistant, and that reason expired the day this was extracted without touching it. Deferred rather than rejected.
