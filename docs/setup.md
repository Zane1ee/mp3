# MP3 environment setup

The owner approved D1-D7 and Round 1 on 2026-11-02. Git foundations already
exist. Keep credentials out of chats, commits, screenshots and Postman exports.

## Local environment

Use Node **24.20.0**, as recorded in `.nvmrc` and `.node-version` (Node 24 LTS).
From the mp3 directory, run `npm ci`. Do not run a forced audit upgrade.
Copy `.env.example` to `.env` only if `.env` does not already exist; this round
creates a private blank local template and preserves later user edits.

Set these local values:

```text
TOKEN=<retain the starter value>
MONGODB_URI=<Atlas SRV URI naming cs409_mp3_dev>
TEST_MONGODB_URI=<Atlas SRV URI naming cs409_mp3_test>
PORT=3000
NODE_ENV=development
```

The URI password belongs to the **database user**, not the Atlas website login.
Encode password characters as required by Atlas's connection instructions.
Use distinct explicit database names. Template placeholders and admin/config/
local targets are rejected; integration targets must be dedicated `_test` names.
The local `.env` is ignored by Git and should be readable only by its owner.

## Atlas preparation (owner account)

Status on 2026-11-03: the owner created the cluster and privately configured
the development/test URIs. Both real database probes, the integration suite,
and actual application startup/restart checks passed; no configuration change
was required. Production/Render access remains for the deployment round.

The steps below remain the repeatable first-cluster setup guide. One Free
cluster can host separate logical dev/test/prod databases; three clusters
are not needed.

1. Open https://cloud.mongodb.com/ and sign in, or register an Atlas account if
   needed. Complete the account's own confirmation steps privately. Create or
   select a project such as `CS409-MP3`.
2. From Project Overview choose **Create** (some interfaces say **Build a
   Database**). Select **Free / M0**, showing a zero-cost plan. Choose an available
   US region; AWS / N. Virginia is a reasonable option when offered. Name the
   cluster `cs409-mp3` or retain `Cluster0`. Keep sample-data loading off. Click
   Create and wait until the cluster is ready. No paid plan is needed here.
3. In Security Quickstart or **Database Access / Database Users**, create a
   password-authenticated database user, for example `mp3_app`. Save its strong
   password privately. This is separate from the Atlas login account. Give the
   user read/write privileges for `cs409_mp3_dev`, `cs409_mp3_test` and
   `cs409_mp3_prod` through database-scoped roles/specific privileges where the
   interface offers them. Atlas administrator privileges are unnecessary.
4. Under **Network Access / IP Access List**, choose **Add IP Address** and the
   README-required **Allow Access From Anywhere**, equivalent to `0.0.0.0/0`.
   Confirm the entry is active. This allows connection attempts from any IP;
   database authentication still applies. Use this setting for the course setup
   with strong credentials and this project's scoped database user.
5. On the cluster choose **Connect -> Drivers**, select **Node.js** and a version
   appropriate for the installed current driver. Copy the `mongodb+srv://` URI.
   Dependencies are already installed; do not repeat an extra driver install.
6. In the local `.env`, fill the real database username/password/host, and put the
   database name in the path **before** the question mark. Keep the other lines,
   including the starter TOKEN. Use the same cluster/credentials with two
   different database paths. Preserve additional Atlas query options if present.

```text
MONGODB_URI=mongodb+srv://mp3_app:ENCODED_PASSWORD@YOUR_ATLAS_HOST/cs409_mp3_dev?retryWrites=true&w=majority
TEST_MONGODB_URI=mongodb+srv://mp3_app:ENCODED_PASSWORD@YOUR_ATLAS_HOST/cs409_mp3_test?retryWrites=true&w=majority
```

These are placeholders, not working connection strings. `YOUR_ATLAS_HOST` is
exactly the hostname Atlas supplied. Special password URI characters must be
percent-encoded, for example `@` becomes `%40` and `#` becomes `%23`; never paste
an actual password into chat for help. Retain `authSource=admin` if Atlas includes
it; application data still belongs in the named dev/test database path.

No manual collections or sample records are needed: the approved probes/models
create the required collections/indexes on first use. `cs409_mp3_prod` is reserved
for the later Render deployment; it does not need another cluster now.

After saving `.env`, tell the assistant **configured** so the pending first-round
checks can continue, or run these yourself from the mp3 directory:

```sh
npm run db:probe
npm run test:integration
```

Expected: both databases pass ping, unique-index readiness, transaction commit
and abort; the real read/query integration suite succeeds and cleans only owned
IDs. Until those actual results exist, Round 1 is not fully accepted.

Official references checked 2026-11-02:

- [Deploy a Free cluster](https://www.mongodb.com/docs/atlas/tutorial/deploy-free-tier-cluster/)
- [Database users](https://www.mongodb.com/docs/atlas/security-add-mongodb-users/)
- [IP access list](https://www.mongodb.com/docs/atlas/security/ip-access-list/)
- [Connect with a driver](https://www.mongodb.com/docs/atlas/driver-connection/)

## Render preparation

Current owner-reported service: **https://cs409-mp3-api-wyqe.onrender.com**.
The owner completed the original publication/deployment/acceptance and supplied a
90/100 course grader report, with both DELETE success response checks failing.
The 2026-11-04 correction changes them to 204/empty. Verify the newly published
commit and repeat online acceptance after deploying this correction; the old
score does not establish a corrected online result. The creation guide below
remains the reproducible setup reference for the existing Zane1ee/mp3 repository.

### Create the service in the Dashboard

1. Sign in to [Render Dashboard](https://dashboard.render.com). Select
   **New > Web Service** and connect the existing `Zane1ee/mp3` repository.
   Authorize repository access in your own account if prompted. No Render API
   token, MCP, new database service or Docker setup is required.
2. Use this settings table. The service label is approved; the actual available
   hostname must come from Render, not from an example in a document.

| Setting | Value / acceptance |
|---|---|
| Service type / Language | Web Service / Node |
| Name | `cs409-mp3-api` if available; choose a unique name in your account if needed and record it |
| Branch | `main`, containing the reviewed developed source |
| Root Directory | Leave blank: this repository's root contains package.json/server.js |
| Region | An available region near the Atlas cluster; record the actual selection |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Instance Type | Free; review the displayed plan before creating the service |
| Health Check Path | `/api/health` (Advanced/Settings if not shown during creation) |
| Node version | Environment variable `NODE_VERSION=24.20.0` |
| Application mode | Environment variable `NODE_ENV=production` |
| Database | Secret environment variable `MONGODB_URI`, naming `cs409_mp3_prod` |
| Starter token | Retain the existing TOKEN value privately as agreed; it is not an API authentication scheme |
| Port | Let Render provide PORT; the actual server binds to `0.0.0.0` |

3. Privately prepare the production URI using the existing Atlas cluster. Give
   the selected database user read/write access to `cs409_mp3_prod`; use that
   user's password and preserve the working URI's connection options. Set the
   URI database path to `cs409_mp3_prod`, separate from dev/test. Atlas creates
   collections/data when the application initializes indexes and writes; a
   second cluster or sample dataset is unnecessary. Enter the URI directly in
   Render's private environment editor. Do not upload the local `.env`, copy
   TEST_MONGODB_URI to the service, or replace local dev/test settings.
4. Add the service's outbound ranges to Atlas Network Access: on the Render
   service page choose **Connect > Outbound**, then allow **all listed CIDR
   ranges** in Atlas, retaining the local development access you still need.
   A browser's/current laptop IP alone does not allow traffic from Render.
   README.md:89 additionally requires Allow access from anywhere (0.0.0.0/0)
   for this course; confirm that entry as required by the assignment. Database
   authentication remains enabled. If the first startup fails before network
   access is configured, fix access and deploy the same revision again.
5. Create/deploy and inspect build/start logs. Require the intended commit,
   Node 24.20.0, successful `npm ci`, index/DB readiness and a listening server.
   Copy the actual HTTPS origin and full deployed Git commit into your release
   notes. Compare that commit with the branch containing these changes.

This table follows [Render's Express deployment guide](https://render.com/docs/deploy-node-express-app).
NODE_VERSION takes precedence over `.node-version`/`.nvmrc`, so it must match
the verified version ([version precedence](https://render.com/docs/node-version)).
The outbound procedure is in [Render's IP documentation](https://render.com/docs/outbound-ip-addresses).

### Accept the actual deployed version

1. Open `<actual-origin>/api/health`: require HTTP 200 and
   `{message:"Ready",data:{ready:true}}`. Then GET `/api/users` or `/api/tasks`
   and require real JSON. A green deploy badge or GET `/api` alone is insufficient.
2. From the **local mp3 directory**, run `npm run acceptance:run -- --origin`
   followed by the actual HTTPS origin. Expect all 75 requests / 249 assertions
   and owned cleanup to pass. This requires no Render shell or DB credentials
   in the request tool. The URL argument must omit `/api`.
3. After online technical checks, update **only API_URL** in `submit.js` to the
   actual HTTPS origin **without `/api`**. Preserve AUTOGRADER_URL and the
   six-minute timeout. Warm the service, run `npm run submit` and save its actual
   feedback. This is a self-check, not submission of the grading form.
4. Use a separate fresh `acceptance:prepare` run for the owner-operated Postman
   checks in [manual-acceptance.md](manual-acceptance.md). Never reuse a replayed
   or half-mutated fixture set for a new acceptance chain. If publishing final
   source/log updates triggers another deploy, verify the final deployed commit
   and readiness again before reporting submission-ready status.

Free services can sleep after 15 minutes without traffic and may need about
a minute to wake ([Render Free documentation](https://render.com/docs/free)).
Warm `/api/health` before testing/grading. Do not automatically retry a timed-out
POST: it may have committed; use the retained acceptance run tag to recover.

### Common deployment symptoms

| Symptom | Check / correction |
|---|---|
| Build cannot find package.json | Repository/branch/root directory; do not set root to a nonexistent nested mp3 folder |
| Wrong Node or engine error | NODE_VERSION overrides both pin files; set exactly 24.20.0 |
| Safe database startup error | Private URI database path/password encoding, database-user prod privileges, cluster running, and all actual Render outbound ranges allowed |
| Startup port detection fails | Start `server.js` through npm start; let Render provide PORT; actual code already binds publicly |
| HTML/loading page or request timeout | Wait for a Free instance to wake, then require JSON health readiness before proceeding |
| Dashboard Live but endpoints are old/missing | Compare full deployed commit and source branch; local edits do not reach Render until published/deployed |
| `/api/api/...` gives 404 | Origin argument/API_URL excludes /api; only Postman's apiBase includes /api |

Do not paste credentials or full database URIs into issue reports or screenshots.

## Verification boundaries

Local pure/transport tests and documentation checks can run without Atlas.
Round 1 code can be prepared and checked independently while credentials are
missing, but its real database acceptance remains behind the SOP environment
gate. This scheduling adjustment does not waive any database verification.
`npm run db:probe` and integration checks require real configured databases;
missing credentials must remain an explicit unmet prerequisite, not a green
skipped test. No local mock result substitutes for Atlas transaction evidence.
