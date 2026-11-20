import express from "express";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const COOKIE_NAME = "vote100_participant";

export function createApp({ databasePath, mode, secureCookie = false }) {
  if (!["sondage", "resultats"].includes(mode)) {
    throw new Error("VOTE_MODE must be sondage (voting) or resultats (results).");
  }

  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS participants (
      token TEXT PRIMARY KEY,
      vote INTEGER CHECK (vote BETWEEN 1 AND 100)
    );
  `);
  const findParticipant = db.prepare("SELECT vote FROM participants WHERE token = ?");
  const addParticipant = db.prepare("INSERT INTO participants (token) VALUES (?)");
  const recordVote = db.prepare("UPDATE participants SET vote = ? WHERE token = ? AND vote IS NULL");
  const totalVotes = db.prepare("SELECT COUNT(*) AS total FROM participants WHERE vote IS NOT NULL");
  const voteCounts = db.prepare(
    "SELECT vote AS number, COUNT(*) AS count FROM participants WHERE vote IS NOT NULL GROUP BY vote ORDER BY vote",
  );

  const app = express();
  app.disable("x-powered-by");
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api", express.json({ limit: "1kb" }));

  function getParticipant(req) {
    const cookie = req.headers.cookie?.split(";").map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE_NAME}=`));
    const token = cookie?.slice(COOKIE_NAME.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const participant = findParticipant.get(token);
    return participant ? { token, vote: participant.vote } : null;
  }

  function state(myVote) {
    const result = { mode, total: totalVotes.get().total, myVote };
    if (mode === "resultats") {
      const rows = voteCounts.all();
      result.counts = Object.fromEntries(
        Array.from({ length: 100 }, (_, index) => [index + 1, 0]),
      );
      for (const row of rows) result.counts[row.number] = row.count;
      result.winner = rows.find((row) => row.count === 1)?.number ?? null;
    }
    return result;
  }

  app.get("/api/state", (req, res) => {
    let participant = getParticipant(req);
    if (!participant) {
      const token = randomBytes(32).toString("hex");
      addParticipant.run(token);
      res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: "strict",
        secure: secureCookie,
        path: "/",
        maxAge: 365 * 24 * 60 * 60 * 1000,
      });
      participant = { token, vote: null };
    }
    res.json(state(participant.vote));
  });

  app.post("/api/votes", (req, res) => {
    if (req.headers["sec-fetch-site"] === "cross-site"
      || (req.headers.origin && req.headers.origin !== `${secureCookie ? "https" : req.protocol}://${req.get("host")}`)) {
      return res.status(403).json({ error: "This origin is not allowed to vote." });
    }
    if (mode !== "sondage") {
      return res.status(403).json({ error: "Voting is closed. The results are available." });
    }
    const number = req.body?.number;
    if (!Number.isInteger(number) || number < 1 || number > 100) {
      return res.status(400).json({ error: "The number must be an integer between 1 and 100." });
    }
    const participant = getParticipant(req);
    if (!participant) {
      return res.status(401).json({ error: "Reload the page and allow cookies to vote." });
    }
    const updated = recordVote.run(number, participant.token);
    if (updated.changes === 0) {
      return res.status(409).json({ error: "This browser has already voted. Your vote cannot be changed." });
    }
    res.status(201).json(state(number));
  });

  app.use("/api", (req, res) => {
    res.status(404).json({ error: "This route does not exist." });
  });

  app.use((error, req, res, next) => {
    console.error("Voting server error:", error);
    if (res.headersSent) return next(error);
    const invalidBody = error.type === "entity.parse.failed" || error.type === "entity.too.large";
    res.status(invalidBody ? 400 : 500).json({
      error: invalidBody ? "The request body is invalid." : "Unable to process the request. Please try again later.",
    });
  });

  return { app, close: () => db.close() };
}
