import "dotenv/config";

const getRequired = (key: string): string => {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const getOptional = (key: string, fallback: string): string => {
  const value = process.env[key]?.trim();
  return value || fallback;
};

const getOptionalNumber = (key: string, fallback: number): number => {
  const value = process.env[key]?.trim();
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a number`);
  }

  return parsed;
};

const getOptionalCsv = (key: string, fallback: string[]): string[] => {
  const value = process.env[key]?.trim();
  const source = value ? value.split(",") : fallback;
  return source.map((item) => item.trim()).filter(Boolean);
};

export const env = {
  port: getOptionalNumber("PORT", 3001),
  nodeEnv: getOptional("NODE_ENV", "development"),
  betterAuthUrl: getOptional("BETTER_AUTH_URL", "http://localhost:3001"),
  betterAuthBasePath: getOptional("BETTER_AUTH_BASE_PATH", "/api/auth"),
  betterAuthSecret: getRequired("BETTER_AUTH_SECRET"),
  corsOrigins: getOptionalCsv("CORS_ORIGIN", [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]),
  databaseUrl: getRequired("DATABASE_URL"),
};
