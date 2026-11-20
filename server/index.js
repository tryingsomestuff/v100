import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp } from "./app.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const databasePath = resolve(process.env.DATABASE_PATH ?? `${root}/data/votes.sqlite`);
const mode = process.env.VOTE_MODE ?? "sondage";
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}
if (process.env.COOKIE_SECURE && !["true", "false"].includes(process.env.COOKIE_SECURE)) {
  throw new Error("COOKIE_SECURE must be true or false.");
}
mkdirSync(dirname(databasePath), { recursive: true });
const { app, close } = createApp({
  databasePath,
  mode,
  secureCookie: process.env.COOKIE_SECURE === "true",
});

let vite;
if (process.argv.includes("--dev")) {
  const { createServer } = await import("vite");
  vite = await createServer({ root, server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
} else {
  app.use(express.static(resolve(root, "dist")));
  app.get("/{*path}", (req, res) => {
    res.sendFile(resolve(root, "dist/index.html"));
  });
}

const server = app.listen(port, process.env.HOST ?? "127.0.0.1", () => {
  console.log(`Vote 100 : http://${process.env.HOST ?? "127.0.0.1"}:${port} (mode ${mode})`);
});
server.on("error", (error) => {
  console.error("Unable to start the server:", error);
  process.exit(1);
});

async function shutdown() {
  server.close(async () => {
    await vite?.close();
    close();
  });
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
