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
| EchoChamber | `feature/echochamber` | A floating audience that reacts to each turn as it lands. Its own engine, settings page and authorable styles; feeds ride the chat row, so deleting a chat reaps them. The crowd is told the persona and card version *this chat* plays as, so it never describes someone the reply was not built from. See `architecture/echochamber.md`. |
| Image generation | `feature/comfy-inject` | `[[IMG: ...]]` markers in a reply become pictures, drawn by a ComfyUI server the backend dials directly. Settings page for host, workflow, sampler and framing. See `architecture/imagegen.md`. |
| Docker | `feature/docker` | A container image and compose file for self-hosting, built on bun from source. Host networking, so the app's IP allowlist can still tell devices apart. |
| Memory defaults | `feature/memory-defaults` | App-wide starting values for Chat Memory's five tunables, on Settings → Engines → Chat Memory. Copied into a chat when memory is switched on for it and never read again, so the layer caps cannot move under a story already summarised against them. See `architecture/memory.md`. |

Per-chat overrides used to be here. Upstream implements the same thing itself now, so the
branch has been retired and deleted rather than carried alongside it. The two stored their
decisions in different shapes, so a chat set up under the old one was not read by the new one
and had to be set again from the chat's own setup chip; that is done, and nothing carries the
old shape any more.

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
