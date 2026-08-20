ARG PLAYWRIGHT_VERSION=1.62.0
ARG PLAYWRIGHT_INTEGRITY=sha512-nsNRyq0r2zsG8AcRHWknc9QRA5XCueC7gWMrs+Gx2tlZn9hcl8zudfh00lhJPY1DE7NmZ6bDsT9g2yey8mXljA==

FROM node:24-bookworm-slim AS playwright-runtime

ARG PLAYWRIGHT_VERSION
ARG PLAYWRIGHT_INTEGRITY

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# 浏览器运行时只由 Playwright 版本决定，普通源码和 workspace 版本变化可复用此层。
# 下载包必须匹配 lockfile 中固定的完整性，避免独立缓存层降低供应链校验。
RUN npm pack --json --ignore-scripts "playwright-core@${PLAYWRIGHT_VERSION}" > /tmp/playwright-pack.json \
    && PLAYWRIGHT_EXPECTED_INTEGRITY="$PLAYWRIGHT_INTEGRITY" node -e \
      "const fs = require('node:fs'); const [pack] = JSON.parse(fs.readFileSync('/tmp/playwright-pack.json', 'utf8')); if (pack.integrity !== process.env.PLAYWRIGHT_EXPECTED_INTEGRITY) throw new Error('Playwright integrity mismatch')" \
    && package_file="$(node -p "JSON.parse(require('node:fs').readFileSync('/tmp/playwright-pack.json', 'utf8'))[0].filename")" \
    && npm install --global --ignore-scripts "./${package_file}" \
    && node /usr/local/lib/node_modules/playwright-core/cli.js install-deps chromium \
    && node /usr/local/lib/node_modules/playwright-core/cli.js install --only-shell chromium \
    && chmod -R 755 /ms-playwright \
    && npm uninstall --global playwright-core \
    && rm -rf "$package_file" /tmp/playwright-pack.json /root/.npm

FROM node:24-bookworm-slim AS dependencies

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.15.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --prod --frozen-lockfile --filter @loci/server... --ignore-scripts

FROM playwright-runtime

ENV NODE_ENV=production
ENV LOCI_DATA_DIR=/data
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=dependencies /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=dependencies /app/packages/shared/node_modules ./packages/shared/node_modules

# 应用源码最后复制，普通代码修改不会让浏览器依赖缓存失效。
COPY apps/server/package.json ./apps/server/package.json
COPY apps/server/src ./apps/server/src
COPY packages/core/package.json ./packages/core/package.json
COPY packages/core/src ./packages/core/src
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/shared/src ./packages/shared/src

WORKDIR /app/apps/server
EXPOSE 3000
CMD ["node", "--import", "tsx", "src/index.ts"]
