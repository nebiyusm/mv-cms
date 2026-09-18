import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { Pool } from "pg";
import { registerBookingRoutes } from "./routes/bookings.js";
import { registerKioskRoutes } from "./routes/kiosk.js";
import { registerExtendRoutes } from "./routes/extend.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { registerHousekeepingRoutes } from "./routes/housekeeping.js";
import { registerFolioRoutes } from "./routes/folios.js";
import { registerAdminRoutes } from "./routes/admin.js";

// Load server/.env (next to this file's parent dir); real env vars win.
loadEnv({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });

const port = Number(process.env.PORT ?? 3001);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
  methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
});

registerBookingRoutes(app, pool);
registerKioskRoutes(app, pool);
registerExtendRoutes(app, pool);
registerWebhookRoutes(app, pool);
registerHousekeepingRoutes(app, pool);
registerFolioRoutes(app, pool);
registerAdminRoutes(app, pool);

async function shutdown(signal: string): Promise<void> {
  app.log.info(`received ${signal}, shutting down`);
  try {
    await app.close();
    await pool.end();
    process.exit(0);
  } catch (err) {
    app.log.error(err, "error during shutdown");
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
