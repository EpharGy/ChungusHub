# What this fork adds

A fork of [patcireamo/ChungusHub](https://github.com/patcireamo/ChungusHub). `main` here is a
plain mirror of upstream; everything below lives on `deploy`, which is the branch to pull if
you want the lot.

Each item is a branch of its own, cut from `main`, so any of them can be taken on its own or
sent upstream as a pull request. **Items are removed from this list once upstream implements
them or they stop being needed**, so a short list is a good sign, not a stalled one.

`deploy` is rebuilt from those branches rather than committed to, which means it is **force
pushed** and does not fast-forward. Clone it or `git reset --hard origin/deploy`; `git pull`
is the one thing that will not work.

## Features

| Feature | Branch | What it does |
|---|---|---|
| EchoChamber | `feature/echochamber` | A floating audience that reacts to each turn as it lands. Its own engine, settings page and authorable styles; feeds ride the chat row, so deleting a chat reaps them. See `architecture/echochamber.md`. |
| Image generation | `feature/comfy-inject` | `[[IMG: ...]]` markers in a reply become pictures, drawn by a ComfyUI server the backend dials directly. Settings page for host, workflow, sampler and framing. See `architecture/imagegen.md`. |
| Per-chat persona | `feature/per-chat-persona` | A chat, or a character card, can play as its own persona instead of the one app-wide "you". Resolves global then character then chat; a Settings page states what is in force and which layer owns it. See `architecture/library.md`. |
| Docker | `feature/docker` | A container image and compose file for self-hosting, built on bun from source. Host networking, so the app's IP allowlist can still tell devices apart. |

## Running it

Docker needs two addresses specific to the machine it runs on, so they are not committed.
Create a `.env` beside `docker-compose.yml`:

```
CHUNGUS_HOST=<this host's own IP>
CHUNGUS_ALLOWLIST=<your client IPs, comma separated>
```

`CHUNGUS_ALLOWLIST` may be left empty, in which case `allowlist.json` governs alone. Then:

```
docker compose up -d --build
```

That is the whole of it. The image builds the client itself, so there is no host-side build
step and nothing to install first. A later client change wants `up -d --build` again; a
change under `server/`, `shared/` or `defaults/` only needs `docker compose restart`, because
those are bind mounted.
