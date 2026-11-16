FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY apps ./apps
RUN pnpm build

FROM build AS app
COPY deploy/ubuntu/bootstrap.mjs /workspace/deploy/ubuntu/bootstrap.mjs
ENV HOST=0.0.0.0 PORT=3001
EXPOSE 3001
CMD ["node", "apps/api/dist/server.js"]

FROM nginx:stable-alpine AS web
COPY deploy/ubuntu/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 80
