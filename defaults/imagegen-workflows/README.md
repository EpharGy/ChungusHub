# Image-generation workflows

ComfyUI workflows the image engine can run. `default.json` uses only built-in nodes, so it
works with any standard checkpoint and nothing needs installing.

## Using your own

1. Build the workflow in ComfyUI and export it with **Save (API format)**. The API format is
   the one this reads; a normal save is the editor's own graph and will not run.
2. Replace the values the engine should fill with the placeholders below, quotes included.
3. Drop the file in `data/imagegen-workflows/` (created on first run) and pick it in
   Settings → Image Generation.

A file in `data/imagegen-workflows/` wins over a bundled one with the same name, so copying
`default.json` there and editing the copy is how you change the shipped workflow without an
update overwriting your edit.

## Placeholders

Each is replaced **including its quotes**, so a number lands as a number and a string as a
string. Write `"steps": "{{STEPS}}"` and the workflow runs with `"steps": 24`.

| Placeholder | Type | Comes from |
|---|---|---|
| `{{CHECKPOINT}}` | string | Settings → Checkpoint |
| `{{POSITIVE_PROMPT}}` | string | Prepend + shot tags + the marker's prompt + append |
| `{{NEGATIVE_PROMPT}}` | string | Settings → Negative prompt |
| `{{WIDTH}}` / `{{HEIGHT}}` | number | The marker's AR token, or the resolution lock |
| `{{SEED}}` | number | The marker's SEED token, resolved (RANDOM / LOCK / a number) |
| `{{STEPS}}` | number | Settings → Steps |
| `{{CFG}}` | number | Settings → CFG |
| `{{SAMPLER}}` / `{{SCHEDULER}}` | string | Settings → Sampler / Scheduler |
| `{{DENOISE}}` | number | Settings → Denoise |

Nothing else in the file is touched: nodes the engine has no placeholder for run exactly as
you saved them, so LoRAs, upscalers, face detailers and ControlNets all work.

## Requirements

The workflow must end in a node that reports an image in ComfyUI's history. The engine takes
the first image the finished job reports.

`SaveImage` (what the bundled workflow uses) writes into ComfyUI's `output/` folder.
`PreviewImage` writes into its `temp/` folder instead, which ComfyUI clears on restart — use
that if you would rather ComfyUI not keep a second permanent copy of every picture. Either
works: ChungusHub copies the bytes into its own `images/chat/` store as soon as the job
finishes, so **ComfyUI's folders can be emptied at any time without affecting your chats**,
and the pictures in a chat are deleted with the messages that reference them.
