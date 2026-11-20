# Vote 100

A React site with a Node.js backend and a SQLite database shared by all participants. Pick a number from 1 to 100: the lowest number with exactly one vote wins.

## Why this experiment?

This lowest-unique-number game explores how people make decisions when success depends on anticipating other people's choices. Low numbers are attractive, but choosing a popular number rules you out.

The interface is in English. Confirmation appears above the 10-by-10 grid. The responsive layout uses side-by-side panels on desktop and stacked panels on phones, with viewport-aware cell heights to reduce scrolling. On very small screens, in landscape or with enlarged text, vertical scrolling remains available rather than clipping content.

Voting and results layouts were checked in Chromium at 1366x768, 1024x768, 390x844, 375x667, 320x568 and 844x390. Both fit without vertical scrolling at the first four sizes. All six retain the 10-by-10 grid without horizontal overflow or clipped cell labels. Touch voting and persistence after reload were also verified with phone emulation.

## Development

Node.js 24 or later is required (using Node's built-in SQLite).

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000`. This single command serves the backend and React through Vite on the same origin.

## Production and revealing results

Build and start the production server on port `3003`:

```bash
bash serve.sh vote
```

To reveal the results, stop the server and restart it in results mode:

```bash
bash serve.sh resultat
```

The script builds the frontend for `/vote100/`, listens on `127.0.0.1:3003`, and enables secure cookies by default. Set `PORT`, `HOST`, or `COOKIE_SECURE` before running it to override those defaults.

For Apache, enable `mod_proxy`, `mod_proxy_http`, and `mod_alias`, then add these directives inside the HTTPS virtual host. The API mapping must precede the general app mapping:

```apache
RedirectMatch 301 ^/vote100$ /vote100/
ProxyPreserveHost On
ProxyPass        /vote100/api/ http://127.0.0.1:3003/api/
ProxyPassReverse /vote100/api/ http://127.0.0.1:3003/api/
ProxyPass        /vote100/     http://127.0.0.1:3003/
ProxyPassReverse /vote100/     http://127.0.0.1:3003/
```

Reload Apache after enabling the modules and updating the virtual host.

`VOTE_MODE` is read only at startup. The existing configuration values are retained for compatibility: `sondage` means voting, and `resultats` means results. No public button, URL parameter or endpoint can change the mode. While voting is open, the API exposes neither per-number counts nor the winner. In results mode, the server rejects all new votes. Open pages refresh every 10 seconds and when the window regains focus.

## Configuration

- `VOTE_MODE`: `sondage` (voting, the default) or `resultats` (results).
- `PORT`: defaults to `3000` when starting the Node server directly; `serve.sh` defaults to `3003`.
- `HOST`: defaults to `127.0.0.1`; use `0.0.0.0` to listen on the network.
- `DATABASE_PATH`: SQLite file path; defaults to `data/votes.sqlite` in the project.
- `COOKIE_SECURE`: defaults to `false` for local HTTP development; set to `true` for an HTTPS site.

Votes are written immediately to SQLite and survive restarts. In a container deployment, mount `data` on a persistent volume. Keep and back up this file: deleting it removes votes and participant identities. Building the frontend does not modify it. Never expose the `data` directory on the Web.

Use HTTPS in production. If a reverse proxy terminates HTTPS, forward the original public `Host` header to the backend. Vote requests from another origin are rejected.

## One vote per cookie

A random `HttpOnly`, `SameSite=Strict` cookie, valid for one year, identifies the browser. An atomic database update enforces one vote per cookie: double clicks, concurrent requests and multiple tabs cannot record a second vote using the same cookie. Without a valid cookie, the API rejects the vote.

This does not verify a person's identity: deleting the cookie, switching browsers or using private browsing allows another vote. This is the identification mechanism selected for this site. Votes from the old `localStorage` demonstration are not imported into the shared poll.

## Checks

```bash
npm test
npm run build
```
