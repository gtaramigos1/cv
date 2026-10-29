# Kitchen Display System — εικόνα για cloud (Railway, Render, Fly.io) ή οποιονδήποτε server με Docker.
FROM node:22-alpine

# Ώρα Ελλάδας: τα στατιστικά ομαδοποιούν ανά ημέρα/ώρα στην τοπική ώρα
# (το Node έχει ενσωματωμένες ζώνες ώρας μέσω ICU — δεν χρειάζεται tzdata).
ENV NODE_ENV=production \
    TZ=Europe/Athens \
    PORT=3000 \
    KDS_DATA_DIR=/data \
    KDS_BEHIND_PROXY=1

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
COPY config ./config
COPY scripts ./scripts

# Η βάση, το μενού και το κλειδί γράφονται στο /data — εκεί πρέπει να «κρεμαστεί» μόνιμος δίσκος (volume).
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
