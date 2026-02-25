FROM node:22.14-alpine

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Accept GitHub token for OpenBridge packages on GitHub Packages
ARG GITHUB_TOKEN
RUN if [ -n "$GITHUB_TOKEN" ]; then \
      echo "@ocean-industries-concept-lab:registry=https://npm.pkg.github.com" > .npmrc && \
      echo "//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}" >> .npmrc; \
    fi

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Remove .npmrc after install (don't bake token into image)
RUN rm -f .npmrc

COPY . .

EXPOSE 5273

CMD ["pnpm", "dev"]
