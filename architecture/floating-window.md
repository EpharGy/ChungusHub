# The floating window shell: architecture

`FloatingWindow` is a panel that floats above the app: draggable by its header, resizable from eight handles, dockable against an edge or a corner, and remembered where you left it. It takes a header and a body and owns everything else. Two files: [`FloatingWindow.svelte`](../src/lib/components/ui/FloatingWindow.svelte) (the component and its pointer handling) and [`floating-window.ts`](../src/lib/utils/floating-window.ts) (the geometry, pure and unit-tested in [`floating-window.test.ts`](../src/lib/utils/floating-window.test.ts)).

It has no behaviour of its own to show. It exists so that the next thing wanting a floating window costs a header and a body instead of five hundred lines.

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

**The Chungus Assistant is not in the layer** and still paints above everything, Settings included. Same call as the rest of this branch: it is a 946-line upstream file, and moving it would be a behaviour change to upstream's own widget rather than to this shell. A visible inconsistency, not an oversight.

## Front to back: one ladder, and docking is not a tier

[`floating-window-stack.ts`](../src/lib/utils/floating-window-stack.ts) hands out rungs. Opening a window takes the top rung and so does touching one, so the last window clicked is the frontmost and every other open window keeps its order underneath. A **docked window is on the same ladder as a free-floating one**: clicking a notepad docked down the left edge raises it over a pop-out lying on top of it, because "docked" is a shape the window is in and not a layer it lives on. Nothing in the stack module knows docking exists, which is what guarantees there is no second tier for a dock to fall into.

The rungs are a monotonic counter rather than a re-sorted array. Re-sorting would rewrite every window's z-index whenever any one of them was clicked, and each of those is a style write on a panel that did not move; handing out an ever-higher number touches only the window that was raised. `bringToFront` returns the rung unchanged when it is already the top one, so clicking the frontmost window repeatedly does not walk the counter up on its own. The values are consumed inside the layer, which is its own stacking context, so they are only ever compared with each other and never collide with the app's z-index scale.

Raising is bound to `pointerdown` in the capture phase **and** to `focusin`, both on the wrapper. The capture phase, because a press should raise the window whether or not whatever it landed on goes on to handle the event. `focusin`, because a window tabbed into from behind another would otherwise be taking typing from underneath it.

## Placement is per device, and the key is the caller's

`storageKey` is a `localStorage` key the caller supplies, one per window kind. Per device because a rectangle means nothing on another machine's screen, and out on the caller because two windows must not fight over one placement.

A window re-reads its placement **every time it opens**, dock included, so anything reopened is already the size and place it was left.

## Desktop only, and it renders nothing on mobile

Not a judgment about phones: a floating window needs somewhere to float that is not already the whole screen, and it needs a launcher to come back from. Callers hide their own entry point on mobile and this renders nothing there, so the state cannot be reached rather than merely being awkward. A window that could be opened but never seen is worse than no window.

## Why it is its own branch

Because two features want it: the image pop-out, which brought it, and the chat notepad. A shell owned by one of them makes the other impossible to send upstream on its own, since its diff against `main` would drag a whole unrelated feature along.

Cut from `main`, with both consumers cut from here, they are **siblings**: either can be retired with a one-line edit to `$Topics`, and either can be opened as a pull request carrying this shell and nothing else it does not need.

A change to the window's behaviour belongs on this branch, never on a consumer's, even when a consumer is what wanted it.
