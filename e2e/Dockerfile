FROM node:22-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      jq \
      curl \
      git \
      ca-certificates \
      python3 \
      python3-requests \
    && rm -rf /var/lib/apt/lists/*

ARG CLAUDE_CODE_VERSION=2.1.126
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
    && claude --version

WORKDIR /repo

ENV CLAUDE_HOME=/root/.claude
ENV CLAUDE_CONFIG_DIR=/root/.claude

ENTRYPOINT ["claude"]
