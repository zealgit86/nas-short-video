FROM node:22-alpine AS frontend
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY src ./src
COPY public ./public
RUN pnpm build

FROM caddy:2.9.1-builder AS caddy-builder
ARG TARGETARCH
RUN GOARCH=$TARGETARCH xcaddy build --with github.com/caddyserver/replace-response

FROM caddy:2.9.1-alpine
RUN apk add --no-cache python3 ffmpeg && mkdir -p /srv/videos/library /srv/videos/mobile /srv/appdata \
    && printf '[]' > /srv/videos/__erin_catalog.json
COPY --from=caddy-builder /usr/bin/caddy /usr/bin/caddy
COPY --from=frontend /app/build/ /srv/
COPY people-api.py /srv/people-api.py
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY docker/start-people.sh /usr/local/bin/start-people.sh
RUN chmod +x /usr/local/bin/start-people.sh
ENV PEOPLE_DATA_PATH=/srv/appdata/people.json PUBLIC_URL=http://localhost:8765 \
    AUTH_ENABLED=true APP_TITLE="NAS Short Video" AUTOPLAY_ENABLED=false \
    IMAGE_DISPLAY_DURATION=5 START_MUTED=true PROGRESS_BAR_POSITION=bottom \
    IGNORE_HIDDEN_PATHS=true SCROLL_DIRECTION=vertical USE_CUSTOM_SKIN=false VIDEO_START_POSITION=start
EXPOSE 8765
CMD ["/usr/local/bin/start-people.sh"]
