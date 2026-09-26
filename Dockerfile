# ChungusHub on a pre-AVX2 x86-64 NAS (e.g. Synology DS920+, Celeron J4125).
#
# Two problems this solves:
#  1. The shipped linux-x64 release binary is compiled on a runner WITH AVX2 and
#     crashes on a CPU without it. We install the `baseline` Bun build instead.
#  2. DSM's glibc is older than Bun wants. Irrelevant here: the container brings
#     its own.
#
# The app is run from source (`bun server/index.ts`), a supported path, so no
# `bun build --compile` is involved at all.
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Pinned to the version the upstream release builds use (see README / CI).
ARG BUN_VERSION=1.3.9
# The `-baseline` variant is the one built for CPUs without AVX2.
RUN curl -fsSL -o /tmp/bun.zip \
      "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64-baseline.zip" \
 && unzip -q /tmp/bun.zip -d /tmp \
 && mv /tmp/bun-linux-x64-baseline/bun /usr/local/bin/bun \
 && chmod +x /usr/local/bin/bun \
 && rm -rf /tmp/bun.zip /tmp/bun-linux-x64-baseline \
 && bun --version

WORKDIR /app

# Dependencies in their own layer, ABOVE the source.
#
# The manifest and the lockfile are the only inputs `bun install` has, so this
# layer is rebuilt when a dependency changes and cached every other time. With
# `COPY . .` above it instead, editing one line of one file re-downloaded every
# package, which on this hardware is the slowest part of the build.
COPY package.json bun.lock ./

# Nothing here goes through node_modules/.bin, deliberately.
#
# Bun in this environment resolves a bin shim's relative imports against the
# .bin/ directory rather than the symlink's real target, so every packaged CLI
# breaks the same way:
#   .bin/svelte-kit -> import('./src/cli.js')      => .bin/src/cli.js       X
#   .bin/vite       -> import('../dist/node/cli.js') => node_modules/dist/  X
# Calling each package's real entrypoint sidesteps that entirely.
#
# --ignore-scripts stops `bun install` firing this repo's own `prepare`
# (svelte-kit sync), which hits the same trap. Nothing is lost: the lockfile
# declares no install hooks, so `prepare` was the only script that would run.
RUN bun install --frozen-lockfile --ignore-scripts

COPY . .

# The client build. Kept in the image even though compose bind-mounts a
# host-built `build/` over it, so the image still serves on its own if those
# mounts are ever removed: the fast path is a convenience, not a dependency.
RUN bun node_modules/@sveltejs/kit/svelte-kit.js sync \
 && bun node_modules/vite/bin/vite.js build

# server/config.ts resolves the data dir from this, else ./user-data next to cwd.
ENV CHUNGUS_DATA_DIR=/data
EXPOSE 4242

# The client build already happened above, so run the server directly rather
# than `bun run start` (which would rebuild the client on every start).
CMD ["bun", "server/index.ts"]
