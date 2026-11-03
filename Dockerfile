# Second Brain MCP server (stdio).
#
#   docker build -t second-brain .
#   docker run -i --rm -v second-brain-data:/data second-brain
#
# MCP clients talk to it over stdin/stdout. Notes live in /data/vault, so mount a
# volume there to keep them. Zero dependencies: nothing is installed at build time.
FROM node:22-alpine

WORKDIR /app
COPY package.json LICENSE README.md ./
COPY api ./api
COPY sdk ./sdk
COPY mcp ./mcp
COPY ui ./ui

# The vault and the sandbox scratch folder live outside the image, owned by the
# unprivileged user the server runs as.
ENV BRAIN_VAULT=/data/vault \
    SANDBOX_WORKSPACE=/data/sandbox_workspace \
    NODE_ENV=production
RUN mkdir -p /data/vault /data/sandbox_workspace && chown -R node:node /data /app
VOLUME /data
USER node

# The MCP server starts the local API on the first tool call; the API binds to
# 127.0.0.1 inside the container and is not exposed.
CMD ["node", "mcp/server.js"]
