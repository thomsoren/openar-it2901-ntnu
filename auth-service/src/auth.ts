import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db";
import { username } from "better-auth/plugins";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { env } from "./env.js";

const pgPool = new Pool({ connectionString: env.databaseUrl });

const db = new Kysely<Record<string, unknown>>({
  dialect: new PostgresDialect({ pool: pgPool }),
});

const normalizedBasePath = env.betterAuthBasePath.startsWith("/")
  ? env.betterAuthBasePath
  : `/${env.betterAuthBasePath}`;

export const auth = betterAuth({
  baseURL: env.betterAuthUrl,
  basePath: normalizedBasePath,
  secret: env.betterAuthSecret,
  trustedOrigins: env.corsOrigins,
  database: {
    db,
    type: "postgres",
  },
  emailAndPassword: {
    enabled: true,
  },
  plugins: [username()],
  advanced: {
    useSecureCookies: env.nodeEnv === "production",
  },
});

export const runAuthMigrations = async () => {
  const { runMigrations } = await getMigrations({
    ...auth.options,
    database: {
      db,
      type: "postgres",
    },
  });

  await runMigrations();
};

export const closeAuthDatabase = async () => {
  await db.destroy();
  await pgPool.end();
};

export const authBasePath = normalizedBasePath;
