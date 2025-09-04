# Dockerfile
FROM oven/bun:1-alpine

# Create app dir
WORKDIR /app

# Install deps first for better caching
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

# Copy the script
COPY index.ts ./

# Default command: watch all containers, summarize every 5m
CMD ["bun", "run", "index.ts", "--all", "--summarizeEvery", "300"]