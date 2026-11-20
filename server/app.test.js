import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "./app.js";

async function startServer(databasePath, mode = "sondage", secureCookie = false) {
  const { app, close } = createApp({ databasePath, mode, secureCookie });
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

function vote(url, cookie, number, headers = {}) {
  return fetch(`${url}/api/votes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, ...headers },
    body: JSON.stringify({ number }),
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
  for (const number of [2, 2, 7, 11]) {
    const visitor = await participant(poll.url);
    participants.push(visitor);
    const response = await vote(poll.url, visitor.cookie, number);
    assert.equal(response.status, 201);
    const data = await response.json();
    assert.equal(data.myVote, number);
    assert.equal("counts" in data, false);
    assert.equal("winner" in data, false);
  }
  const concurrentVisitor = await participant(poll.url);
  const responses = await Promise.all([
    vote(poll.url, concurrentVisitor.cookie, 13),
    vote(poll.url, concurrentVisitor.cookie, 15),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  await Promise.all(responses.map((response) => response.json()));
  const duplicate = await vote(poll.url, participants[0].cookie, 1);
  assert.equal(duplicate.status, 409);
  assert.match((await duplicate.json()).error, /already voted/);
  const shared = await participant(poll.url);
  assert.equal(shared.state.total, 5);
  assert.equal(shared.state.myVote, null);

  const attemptedReveal = await fetch(`${poll.url}/api/state?mode=resultats`, {
    headers: { Cookie: participants[0].cookie },
  });
  const hidden = await attemptedReveal.json();
  assert.equal(hidden.mode, "sondage");
  assert.equal(hidden.myVote, 2);
  assert.equal("counts" in hidden, false);
  assert.equal("winner" in hidden, false);
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
  assert.equal(Object.keys(revealed.counts).length, 100);
  assert.equal(revealed.counts[1], 0);
  assert.equal(revealed.counts[2], 2);
  assert.equal(revealed.counts[7], 1);
  assert.equal(revealed.counts[11], 1);
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

test("results without a unique vote have no winner and cookies can require HTTPS", async (t) => {
  const server = await startServer(":memory:", "resultats", true);
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
});
