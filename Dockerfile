# Stage 1: Build pia-wg-config
FROM golang:1.21-alpine AS go-builder
RUN apk add --no-cache git
RUN git clone https://github.com/Ephemeral-Dust/pia-wg-config.git /app \
    && cd /app \
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
COPY server/package*.json ./
RUN npm install --production
COPY server/ ./

# Copy compiled frontend to the backend's 'public' directory
COPY --from=frontend-builder /app/dist ./public/

# Copy pia-wg-config binary
COPY --from=go-builder /app/pia-wg-config /usr/local/bin/pia-wg-config
RUN chmod +x /usr/local/bin/pia-wg-config

# Pre-create blank env files so volume mounts work on first run without manual setup
RUN touch /usr/src/app/.env \
    && touch /gluetun.env

# Copy and install the entrypoint script
COPY server/entrypoint.sh /usr/src/app/entrypoint.sh
RUN chmod +x /usr/src/app/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/usr/src/app/entrypoint.sh"]
