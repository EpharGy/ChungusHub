# The chat notepad: architecture

A **notepad** is a page of the reader's own notes about one story, in a floating, dockable window raised from the title bar. Four files: [`NotepadWindow.svelte`](../src/lib/components/ui/NotepadWindow.svelte) (what is in the window), [`notepad.svelte.ts`](../src/lib/stores/notepad.svelte.ts) (whose notes, and whether there is a window at all), [`notepad-memory.ts`](../src/lib/utils/notepad-memory.ts) (which chats to reopen one for) and the `notepad` field on [`ChatFeatureState`](../src/lib/types/chat.ts) (the notes themselves). The window shell is [`FloatingWindow`](../src/lib/components/ui/FloatingWindow.svelte), which is not this feature's and is documented in [`floating-window.md`](floating-window.md).

It exists because a long story accumulates things the transcript does not hold: who owes whom what, which thread was dropped four scenes ago, the name you keep forgetting. Every existing place to put those is model-facing (memory, steering notes, lorebooks), so writing one down means deciding to feed it to the model, and the two decisions are not the same decision.

## It is per CHAT, and that is the whole scoping question

The pop-out this shares a shell with binds to the **character** being read. The notepad binds to the **chat**, and the difference is not a detail: a character with six stories running has six sets of notes, because what a notepad tracks is the state of one room, and the same cast in another story is another room. Keyed on the character, six stories would share one page and the notes would be useless in all six.

So the notes live on the chat's own row, in the `feature_state` JSON blob every other per-chat claim already uses (architecture/chat-sessions.md). Duplicating a chat copies its notes, because `duplicateChat` copies that column; deleting a chat deletes them, because the row goes. Neither needed a line of code, which is the argument for that column over a table of our own.

## The notes are the chat's, the window is the device's

Two halves, two homes, and keeping them apart is what makes both behave:

- **The notes** are on the server, on the chat row. They are the reader's writing, so they have to survive a cleared browser, and they have to be on the phone.
- **The window** is in `localStorage`: its rectangle (`FloatingWindow`'s `notepad-rect`) and whether it is standing ([`notepad-memory.ts`](../src/lib/utils/notepad-memory.ts)). A rectangle means nothing on another machine's screen, and neither does "there is a window open", which is a fact about the screen in front of you.

The pop-out puts **both** its halves in `localStorage` and is right to: what it remembers is a picture's path and a rectangle, and a path is a pointer, not content. Copying that answer here wholesale would have put a page of someone's writing in a place a browser reset empties.

**The record of which chats have a window is a bare list of ids**, most-recent-first, capped at twenty. Presence is the whole record: unlike the pop-out's, which needs the gallery its picture came from, there is no second field, because the notes are found by the chat id the window already has.

## Deleting a chat leaves nothing behind

The split above does most of the work by itself. **The notes need no cleanup at all**: they are a column on the chat row, so deleting the chat takes them, on every device at once, with no code here involved. And the **window** is already handled, because deleting the chat you are in routes you somewhere else, which changes the loaded chat, which is exactly the edge the window follows.

What would be left is this device's memory of whether a window was standing. The cap bounds it, so it can never grow, but a bound is not the same as being clean: twenty ids belonging to twenty deleted chats is within the cap and is still twenty rows of nothing. So the window **prunes** the record against the live chat list. It can, because it is mounted for the app's whole life and the list is loaded long before it mounts, and it writes only when something actually goes, so the ordinary case costs a read.

Driving it off the list rather than out of `deleteChat` and `deleteChats` is deliberate on three counts: one row, a batch, and a delete arriving from another device become the same event; no delete path has to know this feature exists; and `chat.svelte.ts` is not touched, which for a fork means this branch and the pop-out's do not both edit the same lines of an upstream file and re-fight it on every rebuild. The pop-out sweeps its own record the same way, for the same reasons.

## The cap is not about the reader's patience

`getAllChats` is `SELECT * FROM chats`, and the client's `chats` array holds every row, blob included. So one chat's notepad is part of what **every** chat-list fetch carries, for every chat, on every device. An unbounded field there turns a list load into a download of everything ever typed into any story.

Hence `NOTEPAD_LIMIT`, clamped in the normalizer rather than only at the input: a row that arrived oversized (hand-edited, restored from a backup, written by a later version) must not be re-saved at its own length. Twenty thousand characters is several pages, far past what the window comfortably holds, so it is a backstop rather than a limit anyone writes up against. The window says how much room is left only in the last tenth, because a counter on screen from the first keystroke reads as a ration.

## Writes are debounced longer than the scene store's, for the opposite reason

A chat row write broadcasts the `chats` scope, and every other device answers that with a chat-list refetch. `chatScene` debounces at 250ms because a slider drag is a burst that **ends**: one write pays for the whole drag. Typing is a burst that keeps restarting, so 250ms here bills a write per word. 600ms is about the gap between sentences, which puts the write where the reader stopped to think.

The pending text is what the window renders meanwhile, so typing paints at full rate, and the write **carries the chat id it started on**, so leaving mid-sentence still lands it on the story it was about. Same shape as `chatScene`, same reason.

The debounce has four ends and only one of them is the timer: closing the window, leaving the story, leaving the page (`beforeunload`), and clicking out of the field (`blur`). A notepad that loses the last sentence on a reload is a notepad nobody trusts with anything, and the trust is the entire feature.

## It reaches no prompt, deliberately

Nothing here is sent to the model. The model-facing homes for standing text already exist and are each budgeted and traceable: the memory engine, steering notes, lorebooks. A field that quietly joined every request would be none of those things, and it would make the notepad unusable for the thing it is best at, which is writing down what you think is about to happen.

That is a decision, not an omission, and it is a small one to reverse: the text is on the chat row where the prompt builder already reads `feature_state`. Reversing it would mean giving it a budget and a trace entry, which is where the cost actually is.

## The window has a launcher, and that changes exactly one thing

The pop-out has none, on purpose: it is opened from a picture and closed for good. The notepad is a thing you return to, so it gets the title bar button, beside Preset Controls, Story Map and Memory, which is where the reader already looks for what belongs to the story they are in. Not a draggable button at the workspace edge: that is the third permanent launcher the pop-out refused to add, and the row already exists.

The one consequence is that **closing is cheap**, so the X is not a destructive act. It puts the window away, keeps every word, and forgets the chat in the local record so returning does not raise it again. The only destructive door is Clear, which asks through `ConfirmDialog` on the destructive-act ladder. Compare the pop-out, where closing forgets the picture because there is nothing to bring it back with.

Three smaller consequences of having a button:

- **A closed notepad holding notes would be invisible**, so the button carries an accent dot when the open chat has notes and the window is down. Without it, a page written last week is a page nobody is reminded of again.
- **On the welcome screen the button is disabled, not hidden.** Hiding it would shift the whole cluster sideways the moment a chat opens.
- **The label-width threshold in `TitleBar` grew** (40rem to 46rem). That rule measures the widest the row can be, and a fourth label made it wider; leaving it would have let the labels overflow at widths that used to fit.

## Following the reader between stories is an edge, not an invariant

`followChat` runs only when the **loaded** chat actually changes, never as a reactive assertion, and this is the same trap the pop-out documents: an invariant re-asserted every tick would fight the frame in which the button opened the window. A window is only wrong once the reader moves.

The chat it keys on is `currentChatState.chat`, the chat **on screen**, deliberately not `activeChatId`, the chat being navigated to. The id is claimed the instant a row is clicked and the rows land a couple of hundred milliseconds later, so notes keyed on the id would swap at the click and leave the story still on screen wearing a stranger's notes. Same choice, same reason, as `chatScene`.

## Desktop only, inherited rather than chosen

`FloatingWindow` renders nothing on mobile, so the title bar filters its button out there and the chat-switch effect skips. Not a judgment about phones: a floating window needs somewhere to float that is not already the whole screen. The state is therefore unreachable rather than merely awkward, which is the standard this fork's other floating window set.

## Where this branch sits

On `feature/floating-window`, which is cut from `main` and holds the window shell and nothing else. The image pop-out sits on the same base. The two are **siblings, not a stack**: neither contains the other, retiring either leaves the other standing, and each is a one-line removal from `$Topics`.

It was not always so. The shell arrived with the pop-out and lived on that branch, which made this one a stack: `git diff main..feature/notepad` carried the entire pop-out, so a pull request for the notepad was a pull request for two features. Extracting the shell fixed that, and it is worth writing down why the obvious alternative is worse. Cutting this branch straight from `main` with its own copy of `FloatingWindow` would give the same 900-line diff against `main` (the shell has to be in the pull request either way, since upstream does not have it), while costing a second copy that every future fix to the docking or resize maths would have to land in byte-identically or the next rebuild conflicts. The parent pointer buys nothing the diff does not already give.

The consequence to remember: a change to the shell belongs on `feature/floating-window`, never here, even when this is the branch that wanted it.
