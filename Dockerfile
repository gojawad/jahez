FROM node:24-bookworm-slim

# Chromium لتوليد PDF محلياً + خطوط عربية للطباعة.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fontconfig fonts-noto-core fonts-noto-ui-core fonts-dejavu-core fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Supplied at deployment from private storage, never committed or served by the app.
COPY .private/pdf-fonts/ /usr/local/share/fonts/jahez-private/
RUN fc-cache -f /usr/local/share/fonts/jahez-private \
    && fc-match -f '%{postscriptname}\n' ':family=Calibri' | grep -Fx Calibri \
    && fc-match -f '%{postscriptname}\n' ':family=PMingLiU-ExtB' | grep -Fx PMingLiU-ExtB \
    && fc-match -f '%{postscriptname}\n' ':family=Cambria:style=Regular' | grep -Fx Cambria \
    && fc-match -f '%{postscriptname}\n' ':family=Cambria:style=Bold' | grep -Fx Cambria-Bold \
    && fc-match -f '%{postscriptname}\n' ':family=Times New Roman:style=Regular' | grep -Fx TimesNewRomanPSMT \
    && fc-match -f '%{postscriptname}\n' ':family=Times New Roman:style=Bold' | grep -Fx TimesNewRomanPS-BoldMT \
    && fc-match -f '%{postscriptname}\n' ':family=Garamond:style=Bold' | grep -Fx Garamond-Bold \
    && fc-match -f '%{postscriptname}\n' ':family=Tahoma' | grep -Fx Tahoma \
    && fc-match -f '%{postscriptname}\n' ':family=IBM Plex Sans Arabic Medium' | grep -Fx IBMPlexSansArabic-Medium \
    && fc-match -f '%{postscriptname}\n' ':family=IBM Plex Sans Arabic SemiBold' | grep -Fx IBMPlexSansArabic-SemiBold

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
COPY country-flags ./country-flags
COPY pdf-fonts ./pdf-fonts
COPY index.html public-shipment.html qr-splash.html sending-data.html ./
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
