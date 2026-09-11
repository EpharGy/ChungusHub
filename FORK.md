# What this fork adds

A fork of [patcireamo/ChungusHub](https://github.com/patcireamo/ChungusHub). `main` here is a
plain mirror of upstream; everything below lives on `deploy`, which is the branch to pull if
you want the lot.

Each item is a branch of its own, cut from `main`, so any of them can be taken on its own or
sent upstream as a pull request. **Items are removed from this list once upstream implements
them or they stop being needed**, so a short list is a good sign, not a stalled one.

Four of them - the gallery window, the notepad, EchoChamber and the frameworks panel - are built on a shared
floating-panel layer that has a branch of its own (`feature/floating-window`, cut from `main`
like the rest). It is not listed below because it adds nothing you can see on its own: it is
the dragging, docking, placement memory, front-to-back order, title bar entry and full-screen
phone layout that all four windows get for free. Taking any of those features means taking
that layer with it, and none of them drags the others.

`deploy` is rebuilt from those branches rather than committed to, which means it is **force
pushed** and does not fast-forward. Clone it or `git reset --hard origin/deploy`; `git pull`
is the one thing that will not work.

## Features

| Feature | Branch | What it does |
|---|---|---|
| EchoChamber | `feature/echochamber` | A floating audience that reacts to each turn as it lands. Its own engine, settings page and authorable styles; feeds ride the chat row, so deleting a chat reaps them. The crowd is told the persona and card version *this chat* plays as, so it never describes someone the reply was not built from. The feed sits in a floating window raised from the title bar: drag it anywhere, resize it, or drop it against an edge or corner to dock it, and it is a full-screen panel on a phone. See `architecture/echochamber.md`. |
| Image generation | `feature/comfy-inject` | `[[IMG: ...]]` markers in a reply become pictures, drawn by a ComfyUI server the backend dials directly. Settings page for host, workflow, sampler and framing. See `architecture/imagegen.md`. |
| Corrections | `feature/corrections` | Rewrites a reply you have already read, to a direction you type. Two extra rows in that reply's Retry menu: replace it, or keep it and write the correction as a branch. It reuses the retry's own prompt, so the rewrite sees the history, lorebooks and memory the original saw. Its own engine, with an editable prompt in Settings → Engines. |
| Gallery window | `feature/image-popout` | Keeps one picture from any card's gallery on screen while you work elsewhere in the app. Raised from the title bar, and it browses for its own image: a grid of every card that has gallery pictures, then that card's pictures. Drag it anywhere, resize it, or drop it against an edge or corner to dock it; two header buttons page through the rest of that card's gallery. What is pinned is remembered per chat and kept with the chat rather than in the browser, so returning to a story brings its picture back on any device you read it from; hiding the window keeps the picture rather than throwing it away, and whether the window is standing stays per device. On a phone it is a full-screen panel. See `architecture/image-popout.md`. |
| Notepad | `feature/notepad` | A page of your own notes about one chat, in a floating window raised from the title bar beside Preset Controls and Story Map. Per chat, not per character, so a character with six stories running has six sets of notes. The notes ride the chat row, so duplicating a chat copies them and deleting it reaps them; the window's size, place and dock are per device. Jump to the end, export as `.txt`, clear behind a confirmation. Nothing in it is ever sent to the model. On a phone it is a full-screen panel. See `architecture/notepad.md`. |
| Random & dice macros | `feature/random-roll-macros` | `{{random::red::green::blue}}` picks one of the options and `{{roll::1d20}}` rolls dice, anywhere a macro resolves: preset items, lorebook entries, character fields. SillyTavern's own syntax and its whole spelling surface, so a preset imported from there works unchanged, including `{{roll::1d20}}` itself, which SillyTavern's default engine silently drops. Every occurrence rolls separately. Note that a roll is made fresh on each resolution, so the token meter and the message actually sent can differ by one pick. See `architecture/random-roll-macros.md`. |
| Steering wakes lore | `feature/lore-scan-steering` | A **Steering** pill in a lorebook entry's *Also scan*, beside Description, Personality and the rest. The entry then searches the steering standing over this reply as well as the chat, so a line of guidance can pull in background the story itself has not mentioned yet: steer toward a place and the place's entry comes with it, on the very turn the steering first applies rather than a turn later. It reads the notes' own text, not the wrapper the preset puts around them, and it reads exactly the notes that reply will carry, so an entry never wakes on guidance that was not sent. Off by default on every entry, like every other scan source. On the way out to SillyTavern it rides `matchCharacterDepthPrompt`, which names the same job there. |
| Story day & frameworks | `feature/frameworks` | A framework is a deterministic calculation over story state that writes into the prompt, so the model is told a fact instead of working it out and getting it wrong. Settings > App > Frameworks says which ones this install carries and holds their tunables; each chat then chooses which of them it uses, so one story can run a system another does not. **Two ship.** **Date** puts the day in the prompt: set a chat to real time and it states the current date each turn, with instructions for bridging a gap since the last reply, and asks the model for a time marker back so you can see where the story thinks it is - nothing parses that marker, it is for you, and it can be visible or hidden inside an HTML comment. Set the chat to manual instead and `/day` drives it (`42`, or `+1` / `-1` to step), with nothing reading the clock. **Reminders** is one short section that every other framework can put a single line into, placed where the reply begins rather than a hundred turns up where a long prompt buries it. It gathers rather than being written into, so a framework switched off cannot leave the section hanging open, and each framework's line stays off until you turn it on, because a reminder is a cost paid on every turn. A framework can also splice its line **into a lorebook entry**, where an `@framework[subject, name=value]` marker is both the configuration and the spot the line lands in; that is the seam a new framework is written against, and neither shipped framework uses it. See `architecture/frameworks.md`. |
| Frameworks panel | `feature/frameworks-panel` | A floating window raised from the title bar carrying this story's framework switches: which frameworks it uses, whether time runs on the clock or by hand, and whether the time marker is visible. It also says what every framework marker in this chat's books is doing and why - computed, stripped as a typo, held out for this story, or claimed by nobody - which with no marker-consuming framework installed is mainly how a mistyped one gets caught. It runs the real dispatcher rather than reading the markers a second time, so it cannot disagree with the prompt it is describing. On a phone it is a full-screen panel. |
| Docker | `feature/docker` | A container image and compose file for self-hosting, built on bun from source. Host networking, so the app's IP allowlist can still tell devices apart. |

## Fixes

Not features, so they are listed apart: each one changes how something already here behaves,
and each is a candidate to go upstream and then disappear from this list.

| Fix | Branch | What it does |
|---|---|---|
| Token counting is cached | `fix/token-count-cache` | Memoizes BPE counting per encoding. The token meters re-assemble the whole prompt whenever any store they read changes, so typing into a lorebook entry re-counted every chat turn that memory had not yet archived, twice per keystroke. On a long chat whose memory has fallen behind, that was over a million tokens of encoding per character typed, and the composer visibly lagged behind the keyboard. Counting is pure, so the cache has nothing to invalidate. |
| A lorebook key listed twice is read once | `fix/duplicate-lore-keys` | An entry can hold the same key string more than once: the editor refuses a repeat, but SillyTavern's own World Info files carry them and an import reads the list verbatim. The scan reported one match per copy, which broke the trace popup outright - clicking a turn's lorebook pill did nothing at all, because two identical matches are a duplicate key in a keyed each and Svelte throws there in production as well as in dev. The same repeat also inflated the entry's inclusion-group score past a rival that had genuinely matched more keys. Upstream issue #72. |
| An entry can carry every spelling of a keyword | `fix/duplicate-key-input` | The keyword chips refused any alternate capitalisation of a key already on the entry, and refused it in silence - with `phone` present, typing `Phone`, `PHONE` or `pHoNe` cleared the box and added nothing. Matching is decided per key rather than per entry, so a case-sensitive entry has to be able to hold several spellings, and the per-key rule can be set after the key is added. A repeat is now a key the list already holds byte for byte, said out loud rather than dropped; two keys that will match the same text are mentioned and still added. |

## Running it

Docker needs two addresses specific to the machine it runs on, so they are not committed.
Create a `.env` beside `docker-compose.yml`:

```env
CHUNGUS_HOST=<this host's own IP>
CHUNGUS_ALLOWLIST=<your client IPs, comma separated>
```

`CHUNGUS_ALLOWLIST` may be left empty, in which case `allowlist.json` governs alone. Then:

```sh
docker compose up -d --build
```

That is the whole of it. The image builds the client itself, so there is no host-side build
step and nothing to install first. A later client change wants `up -d --build` again; a
change under `server/`, `shared/` or `defaults/` only needs `docker compose restart`, because
those are bind mounted.
