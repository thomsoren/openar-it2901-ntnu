import { createServer } from "node:http";
import { toNodeHandler } from "better-auth/node";
import { auth, authBasePath, closeAuthDatabase, runAuthMigrations } from "./auth.js";
import { env } from "./env.js";

const authHandler = toNodeHandler(auth);

const applyCorsHeaders = (origin: string | undefined, response: import("node:http").ServerResponse) => {
  if (!origin) {
    return;
  }

  if (env.corsOrigins.includes(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    response.setHeader("Vary", "Origin");
  }
};

const server = createServer(async (request, response) => {
  const origin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;
  applyCorsHeaders(origin, response);

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  const url = new URL(request.url || "/", env.betterAuthUrl);

  if (url.pathname.startsWith(authBasePath)) {
    try {
      await authHandler(request, response);
    } catch (error) {
      console.error("Auth handler error:", error);
      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ detail: "Internal auth error" }));
      }
    }
    return;
  }

  if (url.pathname === "/health") {
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ status: "ok", service: "auth-service" }));
    return;
  }

  if (url.pathname === "/") {
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        status: "ok",
        service: "openar-auth-service",
        authBasePath,
      })
    );
    return;
  }

  response.statusCode = 404;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ detail: "Not Found" }));
});

const start = async () => {
  try {
    await runAuthMigrations();
  } catch (error) {
    console.error("Auth migration failed:", error);
    process.exit(1);
  }

  server.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Auth service listening on http://localhost:${env.port}${authBasePath}`);
  });
};

const shutdown = async () => {
  server.close();
  await closeAuthDatabase();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});

void start();
