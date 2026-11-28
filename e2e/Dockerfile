# The harnesses agentdist supports, installed side by side, for the end-to-end tests.
#
# The image holds only the harnesses and the tools they need. agentdist itself, the probe package,
# the probe servers and the runner come from the repository, mounted read-only at /src when the
# tests run, so changing any of them needs no rebuild. See e2e/README.md.
#
# Every harness is pinned to the version the adapters in e2e/runner/harnesses were checked
# against, so a cached image and a fresh build test the same binaries. Each run's report lists them.

# trixie, not bookworm: Zed needs GCC 14's libgcc.
FROM node:22-trixie

ENV DEBIAN_FRONTEND=noninteractive \
    # Installers that put things in ~/.local install here instead, so every test home can be empty.
    TOOLS_HOME=/opt/harness-home \
    PATH=/opt/harness-home/.local/bin:$PATH \
    PROBE_DIR=/tmp/probe \
    DISPLAY=:99

# ripgrep: OpenCode's and Kilo's skill tool. Xvfb, Vulkan, xdotool: Zed, which has no headless mode.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git jq ripgrep bubblewrap procps bzip2 \
      xvfb xdotool mesa-vulkan-drivers libvulkan1 libxkbcommon-x11-0 libfontconfig1 \
      libwayland-client0 libasound2t64 \
    && rm -rf /var/lib/apt/lists/*

# npm-distributed harnesses, one layer each. A layer is rebuilt when it or any layer above it
# changes, so a version bump rebuilds its own layer and everything below it.
RUN npm install -g @anthropic-ai/claude-code@2.1.332 && npm cache clean --force
RUN npm install -g @openai/codex@0.172.0 && npm cache clean --force
RUN npm install -g @google/gemini-cli@0.71.1 && npm cache clean --force
RUN npm install -g @qwen-code/qwen-code@0.28.4 && npm cache clean --force
RUN npm install -g opencode-ai@1.19.6 && npm cache clean --force
RUN npm install -g @kilocode/cli@7.8.32 && npm cache clean --force
RUN npm install -g @github/copilot@1.0.116 && npm cache clean --force
RUN npm install -g @earendil-works/pi-coding-agent@1.6.1 && npm cache clean --force
RUN npm install -g cline@3.0.75 && npm cache clean --force
RUN npm install -g @sourcegraph/amp@0.0.1795622439-g2078b8 && npm cache clean --force

# Cursor Agent CLI, from its versioned tarball.
RUN arch=$([ "$(dpkg --print-architecture)" = arm64 ] && echo arm64 || echo x64) \
    && dir=$TOOLS_HOME/.local/share/cursor-agent/versions/2026.11.22-e9042b2 \
    && mkdir -p "$dir" $TOOLS_HOME/.local/bin \
    && curl -fsSL "https://downloads.cursor.com/lab/2026.11.22-e9042b2/linux/$arch/agent-cli-package.tar.gz" \
       | tar -xz -C "$dir" --strip-components=1 \
    && ln -s "$dir/cursor-agent" $TOOLS_HOME/.local/bin/cursor-agent

# Factory Droid, from its versioned release.
RUN arch=$([ "$(dpkg --print-architecture)" = arm64 ] && echo arm64 || echo x64) \
    && mkdir -p $TOOLS_HOME/.local/bin \
    && curl -fsSL -o $TOOLS_HOME/.local/bin/droid "https://downloads.factory.ai/factory-cli/releases/1.20.0/linux/$arch/droid" \
    && chmod +x $TOOLS_HOME/.local/bin/droid

# Goose.
RUN curl -fsSL https://github.com/block/goose/releases/download/v1.61.0/download_cli.sh \
    | CONFIGURE=false GOOSE_VERSION=v1.61.0 GOOSE_BIN_DIR=/usr/local/bin bash

# Devin CLI, from its versioned setup script. It ends by trying an interactive login, which fails
# without a terminal.
RUN curl -fsSL -o /tmp/devin-install.sh https://static.devin.ai/cli/3000.14.30821/setup.sh \
    && (HOME=$TOOLS_HOME bash /tmp/devin-install.sh </dev/null || true) \
    && rm /tmp/devin-install.sh && test -x $TOOLS_HOME/.local/bin/devin

# Zed.
RUN HOME=$TOOLS_HOME ZED_VERSION=1.30.2 sh -c 'curl -fsSL https://zed.dev/install.sh | sh' \
    && test -x $TOOLS_HOME/.local/bin/zed

# The stdio MCP server the probe package names by command.
RUN printf '#!/bin/sh\nexec node /src/e2e/servers/mcp-probe.mjs "$@"\n' > /usr/local/bin/mcp-probe \
    && chmod +x /usr/local/bin/mcp-probe

WORKDIR /src
ENTRYPOINT ["node", "/src/e2e/runner/run.mjs"]
