# Runtime Clean lab image. Database migrations remain an explicit operation.
FROM node:20-bookworm-slim

ARG GIT_COMMIT_SHA
LABEL org.opencontainers.image.revision="${GIT_COMMIT_SHA}"
LABEL org.opencontainers.image.source="https://github.com/ralborta/empliados-support-desk"
LABEL org.opencontainers.image.title="wara-runtime-clean-lab"
LABEL wara.runtime-clean.git-commit-sha="${GIT_COMMIT_SHA}"

ENV NODE_ENV=production \
    PORT=8788 \
    WARA_CLEAN_BIND_HOST=0.0.0.0 \
    GIT_COMMIT_SHA="${GIT_COMMIT_SHA}"

RUN corepack enable && corepack prepare pnpm@9.12.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile --prod=false

EXPOSE 8788

CMD ["pnpm", "--filter", "@wara-v2/app", "runtime-clean:lab"]
