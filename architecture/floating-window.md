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

- **A snapped rectangle skips the viewport clamp** on a re-fit, so the floating minimums can never push a dock off its own boundaries.
- **The drag itself is unclamped**, so the header can actually reach an edge. Release either docks it or pulls it back.

A saved placement records its **dock as well as its rectangle**, or reopening would silently demote a docked window to a free one wearing the dock's dimensions.

## Placement is per device, and the key is the caller's

`storageKey` is a `localStorage` key the caller supplies, one per window kind. Per device because a rectangle means nothing on another machine's screen, and out on the caller because two windows must not fight over one placement.

A window re-reads its placement **every time it opens**, dock included, so anything reopened is already the size and place it was left.

## Desktop only, and it renders nothing on mobile

Not a judgment about phones: a floating window needs somewhere to float that is not already the whole screen, and it needs a launcher to come back from. Callers hide their own entry point on mobile and this renders nothing there, so the state cannot be reached rather than merely being awkward. A window that could be opened but never seen is worse than no window.

## Why it is its own branch

Because two features want it: the image pop-out, which brought it, and the chat notepad. A shell owned by one of them makes the other impossible to send upstream on its own, since its diff against `main` would drag a whole unrelated feature along.

Cut from `main`, with both consumers cut from here, they are **siblings**: either can be retired with a one-line edit to `$Topics`, and either can be opened as a pull request carrying this shell and nothing else it does not need.

A change to the window's behaviour belongs on this branch, never on a consumer's, even when a consumer is what wanted it.
