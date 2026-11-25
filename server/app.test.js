import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createApp } from "./app.js";

async function startServer(databasePath, mode = "sondage", secureCookie = false, options = {}) {
  const { app, close } = createApp({ databasePath, mode, secureCookie, ...options });
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  let stopped = false;
  return {
    url,
    async stop() {
      if (stopped) return;
      stopped = true;
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      close();
    },
  };
}

async function participant(url) {
  const response = await fetch(`${url}/api/state`);
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  return { cookie: cookie.split(";")[0], state: await response.json() };
}

function vote(url, cookie, number, headers = {}, name = "Player") {
  return fetch(`${url}/api/votes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, ...headers },
    body: JSON.stringify({ number, name }),
  });
}

test("shared votes, atomic uniqueness, hidden results and persistence across mode restart", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "vote100-test-"));
  const path = join(directory, "votes.sqlite");
  const servers = [];
  t.after(async () => {
    for (const server of servers) await server.stop();
    rmSync(directory, { recursive: true });
  });
  const poll = await startServer(path);
  servers.push(poll);
  const participants = [];
  for (const [number, name] of [[2, "Alex"], [2, "Sam"], [7, "Mina"], [11, "Lee"]]) {
    const visitor = await participant(poll.url);
    participants.push(visitor);
    const response = await vote(poll.url, visitor.cookie, number, {}, name);
    assert.equal(response.status, 201);
    const data = await response.json();
    assert.equal(data.myVote, number);
    assert.equal(data.myName, name);
    assert.equal("counts" in data, false);
    assert.equal("winner" in data, false);
  }
  const concurrentVisitor = await participant(poll.url);
  const responses = await Promise.all([
    vote(poll.url, concurrentVisitor.cookie, 13),
    vote(poll.url, concurrentVisitor.cookie, 15),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  const concurrentNumber = (await Promise.all(responses.map((response) => response.json())))
    .find((data) => data.myVote !== undefined).myVote;
  const duplicate = await vote(poll.url, participants[0].cookie, 1);
  assert.equal(duplicate.status, 409);
  assert.match((await duplicate.json()).error, /already voted/);
  const shared = await participant(poll.url);
  assert.equal(shared.state.total, 5);
  assert.equal(shared.state.myVote, null);
  assert.equal("myName" in shared.state, false);

  const attemptedReveal = await fetch(`${poll.url}/api/state?mode=resultats`, {
    headers: { Cookie: participants[0].cookie },
  });
  const hidden = await attemptedReveal.json();
  assert.equal(hidden.mode, "sondage");
  assert.equal(hidden.myVote, 2);
  assert.equal("counts" in hidden, false);
  assert.equal("winner" in hidden, false);
  assert.equal("sequence" in hidden, false);
  const attemptedToggle = await fetch(`${poll.url}/api/mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "resultats" }),
  });
  assert.equal(attemptedToggle.status, 404);
  await attemptedToggle.json();
  await poll.stop();

  const results = await startServer(path, "resultats");
  servers.push(results);
  const revealedResponse = await fetch(`${results.url}/api/state?mode=sondage`, {
    headers: { Cookie: participants[0].cookie },
  });
  const revealed = await revealedResponse.json();
  assert.equal(revealed.mode, "resultats");
  assert.equal(revealed.total, 5);
  assert.equal(revealed.myVote, 2);
  assert.equal(revealed.winner, 7);
  assert.equal(revealed.winnerName, "Mina");
  assert.equal(Object.keys(revealed.counts).length, 100);
  assert.equal(revealed.counts[1], 0);
  assert.equal(revealed.counts[2], 2);
  assert.equal(revealed.counts[7], 1);
  assert.equal(revealed.counts[11], 1);
  assert.deepEqual(revealed.sequence, [2, 2, 7, 11, concurrentNumber]);
  const closed = await vote(results.url, shared.cookie, 1);
  assert.equal(closed.status, 403);
  await closed.json();
  assert.equal((await participant(results.url)).state.total, 5);
});

test("invalid votes, missing cookies and cross-origin submissions are rejected", async (t) => {
  const server = await startServer(":memory:");
  t.after(() => server.stop());
  const visitor = await participant(server.url);
  for (const number of [0, 101, 1.5, "7", null]) {
    const response = await vote(server.url, visitor.cookie, number);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /integer between 1 and 100/);
  }
  for (const name of ["", "   ", "x".repeat(41)]) {
    const response = await vote(server.url, visitor.cookie, 7, {}, name);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /name of 1 to 40 characters/);
  }
  for (const cookie of ["", "vote100_participant=invalid", `vote100_participant=${"a".repeat(64)}`]) {
    const response = await vote(server.url, cookie, 7);
    assert.equal(response.status, 401);
    await response.json();
  }
  const foreign = await vote(server.url, visitor.cookie, 7, { Origin: "https://example.com" });
  assert.equal(foreign.status, 403);
  await foreign.json();
  const response = await vote(server.url, visitor.cookie, 100, { Origin: server.url });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).myVote, 100);
});

test("successful votes are rate-limited per IP, independently of cookies", async (t) => {
  const server = await startServer(":memory:", "voting", false, { ipVoteLimit: 2 });
  t.after(() => server.stop());

  for (const number of [1, 2]) {
    const visitor = await participant(server.url);
    const response = await vote(server.url, visitor.cookie, number);
    assert.equal(response.status, 201);
    await response.json();
  }

  const blockedVisitor = await participant(server.url);
  const blocked = await vote(server.url, blockedVisitor.cookie, 3);
  assert.equal(blocked.status, 429);
  assert.match((await blocked.json()).error, /Too many votes from this network/);

  const otherIpVisitor = await participant(server.url);
  const otherIp = await vote(server.url, otherIpVisitor.cookie, 4, {
    "X-Forwarded-For": "203.0.113.10",
  });
  assert.equal(otherIp.status, 201);
  await otherIp.json();
});

test("existing databases gain a name column and legacy winners remain readable", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "vote100-legacy-test-"));
  const path = join(directory, "votes.sqlite");
  const legacyDb = new DatabaseSync(path);
  legacyDb.exec(`
    CREATE TABLE participants (
      token TEXT PRIMARY KEY,
      vote INTEGER CHECK (vote BETWEEN 1 AND 100)
    );
  `);
  const legacyToken = "a".repeat(64);
  legacyDb.prepare("INSERT INTO participants (token, vote) VALUES (?, ?)").run(legacyToken, 5);
  legacyDb.close();
  const server = await startServer(path, "resultats");
  t.after(async () => {
    await server.stop();
    rmSync(directory, { recursive: true });
  });
  const response = await fetch(`${server.url}/api/state`, {
    headers: { Cookie: `vote100_participant=${legacyToken}` },
  });
  const state = await response.json();
  assert.equal(state.winner, 5);
  assert.equal(state.winnerName, null);
  assert.deepEqual(state.sequence, [5]);
});

test("results without a unique vote have no winner and cookies can require HTTPS", async (t) => {
  const server = await startServer(":memory:", "results", true);
  t.after(() => server.stop());
  const response = await fetch(`${server.url}/api/state`);
  assert.match(response.headers.get("set-cookie"), /Secure/);
  const state = await response.json();
  assert.equal(state.winner, null);
  assert.equal(state.total, 0);
  assert.ok(Object.values(state.counts).every((count) => count === 0));
});

test("invalid mode configuration prevents startup", () => {
  assert.throws(() => createApp({ databasePath: ":memory:", mode: "other" }), /VOTE_MODE/);
  assert.throws(() => createApp({ databasePath: ":memory:", mode: "__proto__" }), /VOTE_MODE/);
  assert.throws(() => createApp({ databasePath: ":memory:", mode: "voting", ipVoteLimit: 0 }), /IP_VOTE_LIMIT/);
});
