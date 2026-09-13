# The API, and only the API. The client is static and is served by Firebase
# Hosting (firebase.json); Postgres is a managed instance the operator owns.
# Built from the repository root so the workspace packages the API imports
# (@scrbrd/policy, @scrbrd/scoring, @scrbrd/sync) are in the context.
#
#   docker build -t scrbrd-api .
#   docker run -e DATABASE_URL=... -e SESSION_SECRET=... -e WEB_ORIGIN=... -p 8787:8787 scrbrd-api
#
# Migrations do NOT run from this image. tools/migrate.mjs runs as the schema
# owner with psql, from an operator's machine or a job — never as the role the
# API connects with, which cannot own tables (see db/06_app_role.sql).
FROM node:22-alpine

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# The lockfile names every workspace package, so every package.json it names
# has to be present for --frozen-lockfile to agree with it, even the client's.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages ./packages
COPY services/api ./services/api
RUN pnpm install --frozen-lockfile --prod --filter @scrbrd/api...

ENV NODE_ENV=production
# Cloud Run supplies PORT; server.mjs reads it. 8787 is the default elsewhere.
EXPOSE 8787
USER node
CMD ["node", "services/api/server.mjs"]
