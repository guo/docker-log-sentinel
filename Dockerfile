# Dockerfile
FROM node:20-alpine

# Create app dir
WORKDIR /app

# Install deps first for better caching
COPY package*.json ./
RUN npm ci

# Copy the script
COPY index.ts ./

# Default command: watch all containers, summarize every 5m
CMD ["npx", "ts-node", "index.ts", "--all", "--summarizeEvery", "300"]