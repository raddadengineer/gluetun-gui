# Stage 1: Build pia-wg-config
FROM golang:1.21-alpine AS go-builder
RUN apk add --no-cache git
WORKDIR /app
COPY patches/pia-wg-config-legacy-cn-fallback.patch /tmp/pia-wg-config-legacy-cn-fallback.patch
RUN git clone https://github.com/Ephemeral-Dust/pia-wg-config.git /src \
    && cd /src \
    && git apply /tmp/pia-wg-config-legacy-cn-fallback.patch \
    && cd /app \
    && cp -R /src/. /app/ \
    && go mod download \
    && go build -o pia-wg-config

# Stage 2: Build the React Application
FROM node:22-alpine AS frontend-builder
WORKDIR /app
COPY app/package*.json ./
RUN npm install
COPY app/ ./
RUN npm run build

# Stage 3: Setup the Express Backend
FROM node:18-alpine
WORKDIR /usr/src/app
RUN apk add --no-cache ca-certificates
ARG GLUETUN_GUI_GIT_SHA=""
ARG GLUETUN_GUI_GIT_REF=""
ARG GLUETUN_GUI_GIT_COMMITTED_AT=""
ARG GLUETUN_GUI_BUILD_TIME=""
ARG GLUETUN_GUI_RELEASE=""
ENV GLUETUN_GUI_GIT_SHA=$GLUETUN_GUI_GIT_SHA
ENV GLUETUN_GUI_GIT_REF=$GLUETUN_GUI_GIT_REF
ENV GLUETUN_GUI_GIT_COMMITTED_AT=$GLUETUN_GUI_GIT_COMMITTED_AT
ENV GLUETUN_GUI_BUILD_TIME=$GLUETUN_GUI_BUILD_TIME
ENV GLUETUN_GUI_RELEASE=$GLUETUN_GUI_RELEASE
COPY server/package*.json ./
RUN npm install --production
COPY server/ ./

# Include changelog so /api/about can read latest release
COPY CHANGELOG.md ./CHANGELOG.md

# Copy compiled frontend to the backend's 'public' directory
COPY --from=frontend-builder /app/dist ./public/

# Copy pia-wg-config binary
COPY --from=go-builder /app/pia-wg-config /usr/local/bin/pia-wg-config
RUN chmod +x /usr/local/bin/pia-wg-config

EXPOSE 3000

# Start the Express API and Static File Server
CMD ["node", "index.js"]
