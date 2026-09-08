FROM node:24-bookworm-slim

# Chromium لتوليد PDF محلياً + خطوط عربية للطباعة.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-noto-core fonts-noto-ui-core fonts-dejavu-core fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    CHROMIUM_PATH=/usr/bin/chromium \
    PORT=3000

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY api ./api
COPY experiments ./experiments
COPY invoice-template-preview ./invoice-template-preview
COPY index.html public-shipment.html ./
COPY *.js *.css *.png *.jpeg *.pdf ./

ARG BUILD_SHA=unknown
ARG DEPLOYED_AT=unknown
ENV BUILD_SHA=$BUILD_SHA DEPLOYED_AT=$DEPLOYED_AT

RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]
