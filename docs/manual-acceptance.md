# MP3 staged manual acceptance

Scope through Round 5 preparation: all ten User/Task resource operations, models, shared
validation/transactions, queries and service/readiness responses. DELETE uses
the approved provisional D6 response: 200 with JSON {message,data:[]}.
The fixture CLI remains a local developer tool, not a public seed endpoint.

Round 5 local verification passed on **2026-11-03**: clean lockfile
installation with zero audit findings, 81 local tests and 90 reported Atlas
checks, all with zero failed/cancelled/skipped results. The integration report
contains seven grouping parents, 82 subtests and one standalone availability
case (83 substantive scenarios). All 75 requests and 252 embedded assertions
passed actual server.js / CLI HTTP/VM replay; API-only preparation, an unsaved
manual-style creation and scoped cleanup also passed. Original development data
and private configuration stayed unchanged. Earlier separate-process persistence
checks are recorded in SOP.txt. Automated verification does not complete your
Postman UI/manual acceptance or online/submission gates.
The current combined collection contains 75 requests for the stages below.
All required endpoint methods now exist; the full SOP Appendix B chain is also
available for later end-to-end owner acceptance, with its own fresh data.

## 0. Recommended Round 5 path: one API-only flow locally or on Render

The owner confirmed no Render Web Service exists yet. Follow
[setup.md's Render steps](setup.md#render-preparation) to deploy; the same flow
below can be manually accepted locally now, then repeated on the actual online
revision. Record the origin, full deployed commit, time and runTag separately.
Do not treat local/manual/automated/online results as interchangeable.

1. Start the local service in another terminal with `npm start`, or warm the
   deployed `/api/health`. Require 200 with `data.ready=true`. Use the actual
   origin **without `/api`** in commands. Run commands from the local mp3 folder,
   not a Render shell. The examples below use the local origin; replace just
   that argument with your actual HTTPS origin for online acceptance.
2. For an automated replay before manual inspection:

   ```sh
   npm run acceptance:run -- --origin "http://localhost:3000"
   ```

   Expected: fresh API-created samples, all 75 requests and 252 assertions pass,
   followed by owned cleanup. It needs no DB credential and creates no public
   seed endpoint. It does not restart Render or complete owner manual acceptance.
3. Prepare a **different fresh run** for your manual operation:

   ```sh
   npm run acceptance:prepare -- --origin "http://localhost:3000"
   ```

   Expected: five successful POSTs produce A/B and Task1/2/3 with the state in
   section 3's table. Save the printed `apiBase`, `runTag`, `userA`, `userB`,
   `task1`, `task2`, `task3`; the ignored `.local/http-acceptance.json` retains
   the exact target/run for cleanup. No database URI is printed or loaded by
   this tool. Do **not** also run `fixtures:create` for the same chain.
4. Import `docs/mp3.postman_collection.json`, open its **Variables**, and copy
   those seven values into the values used by your Postman version. Remove or
   select no environment/global overrides with the same names. Clear every
   other resource/date/snapshot variable from a previous run; keep the seven
   new values. Request bodies already supply the correct headers and formats.
5. Use **Send one request at a time**, in collection order: first 13 requests,
   R01-R23, U01-U33, Q01-Q06. Use one iteration only if using Collection Runner;
   do not run requests in parallel or rerun the whole collection on used data.
   Observe status, raw JSON, Tests results and the GET checks in sections 4-7.
   Intentional 400/404 are passing negative tests when their assertions pass.
6. Pause at the checkpoints in the table below; perform fresh GETs rather than
   judging the write response alone. Optional GETs do not change fixture state.
7. Stop other manual writes and clean through the same saved API origin:

   ```sh
   npm run acceptance:clean
   ```

   Expected after the full chain: remove two surviving users and three surviving
   tasks; deleted C/D and Task2 were already removed by the chain. All removed
   IDs return 404, run-scoped lists are empty, and the manifest is removed.
   A stopped/partial chain may leave more owned records: the tool discovers
   this exact random run prefix and uses ID-specific deletes. It also finds
   same-run Postman creations whose IDs were not copied to the manifest.
   A foreign owner/task reference must refuse cleanup before any deletion;
   preserve the manifest and resolve that relationship rather than forcing it.
8. Report the actual environment/revision/runTag, observed pass/fail, restart
   result and cleanup result. Owner acceptance remains pending until you do
   these steps and report it. Repeat on Render even if local acceptance passed.

| Stop after | What you must inspect / expected result |
|---|---|
| Initial M04 reads | Full six-parameter query returns only Task2's name; count=true is 3 despite skip/limit=1; completed count is 1; member select ignores irrelevant malformed where/count |
| R03, R05 | A first contains Task2 + createdTask once each; completing createdTask retains A ownership but removes only createdTask from A.pendingTasks |
| R07, R09, R11/R12 | Completed transfer gives B ownership with no pending ID; reopening adds it once; transfer back removes B's ID and adds A's ID once |
| R14/R15 | Required-fields-only PUT resets all Task optionals, clears ownership and keeps _id/dateCreated; A retains only Task2 |
| Before R16 and after R20 | Save GETs of the created Task and A/B, including __v; after rejected writes every field/version must be identical |
| After R23, before U01 | Run the three extra malformed-body/type/date checks below; all must be 400 without changing the saved Task or either user |
| U01 before U02 | Save C, restart the local service or redeploy the SAME online commit, wait for readiness, GET C: identical ID/date/fields. Do not reseed or continue until this passes |
| U03/U04, U07 | User-side transfer removes former A membership and updates Task2's owner/name; renaming C also updates completed Task3's owner name |
| U08-U11 | Omitting pendingTasks clears C's nonempty pending list and unassigns Task1/Task2; completed Task3 stays owned by renamed C |
| Before U15 and after U20 | Save C/D and all currently existing owned Tasks; duplicate/missing/completed/reference/body failures preserve the snapshots, not only User D's response |
| U24-U26 | DELETE pending Task2 removes its ID from D; GET/repeat DELETE are 404; D still owns Task1 |
| U28, U32/U33 | Deleting C unassigns surviving completed Task3; deleting D unassigns surviving incomplete Task1; IDs/dates survive, users are 404 |
| Q01-Q06 | All invalid query paths are safe 400, except missing member target is 404 first; count=true does not bypass validation |
| Final restart before cleanup | createdTask unassigned with original date, A.pendingTasks=[], Task3 completed/unassigned; C/D/Task2 remain 404 |

Three additional manual negative requests, all to PUT
`{{apiBase}}/tasks/{{createdTask}}` after R23:

| Content-Type and raw body | Expected |
|---|---|
| application/json; `{"name":` (deliberately truncated JSON) | 400 safe parser error |
| application/json; `{"name":"QA-{{runTag}}-created","deadline":"2026-12-01","completed":"false"}` | 400: JSON Boolean strings are invalid; compare R21's valid URL-encoded Boolean |
| application/json; `{"name":"QA-{{runTag}}-created","deadline":"2026-02-30"}` | 400: invalid calendar date must not roll over |

For each, expect exactly `{message,data:{}}` with a readable message, no stack/
database details, and identical fresh GET snapshots afterward. These three
owner-operated requests are **additional** to the collection's 75/252 count.
Keep the original request unchanged by using a separate Postman tab.

If a request fails: stop the sequence and save its request name, method/path,
body, HTTP status, safe response and fresh linked-resource GETs. Do not rerun
POST or reset variables to hide a failure. Keep the manifest for cleanup.
If a CLI process was forcibly stopped and a `.lock` remains, first verify no
acceptance process is active, remove only that stale lock, then run cleanup;
retain the JSON manifest. For service downtime, restore readiness before cleanup.

The remaining sections retain the original local fixture-CLI path and give
per-request expected results usable by **either** fixture method. Choose one
preparation/cleanup method; the local CLI is restricted to `_dev` and is not
an online preparation tool.

## 1. Run checks that do not require Atlas

From this project's directory:

```sh
npm ci
npm run check
```

Expected: installation succeeds; syntax/contract checks and all reported pure/
transport tests pass. HTTP transport tests use temporary loopback ports and
model doubles. They do **not** establish real MongoDB filtering or atomicity.
No fixed future test count is promised; use the actual count shown by the run.

If `.env` has blank database URIs, `npm start` must exit with a safe configuration
error instead of printing “Server ready”. This is the expected unconfigured
behavior, not a ready application. No mock server or substitute data is started.

## 2. Complete the real database gate

Follow [setup.md](setup.md) and privately configure `MONGODB_URI` and a distinct
`TEST_MONGODB_URI` naming `cs409_mp3_test`. Run:

```sh
npm run db:probe
npm run test:integration
```

Expected: both probe databases pass ping, index, transaction commit and abort;
the integration suite passes real GET/query/projection/default-limit/unique-
index cases, including 101 tasks and 101 users. Cleanup removes only owned IDs.
Missing configuration fails visibly; an absent database is never a skipped pass.
Database error messages are sanitized and must not expose a URI or password.

## 3. Prepare fresh owned fixtures

In one terminal:

```sh
npm run fixtures:create
```

Expected: two users and three tasks are created in one real transaction in the
dedicated `_dev` database. The command prints non-secret `runTag`, `userA`,
`userB`, `task1`, `task2`, `task3` and writes `.local/round1-fixtures.json`.
Do not run again until this fixture manifest has been cleaned.

The fixture state is deliberately different from SOP Appendix B's separate
POST-based creation sequence; do not mix their IDs or expected lists:

| Resource | Expected stored state |
|---|---|
| User A | Name `QA-<runTag>-A`; pendingTasks contains only task2 |
| User B | Name `QA-<runTag>-B`; pendingTasks is empty |
| Task 1 | Name ends `-01`; incomplete and unassigned |
| Task 2 | Name ends `-02`; incomplete, assigned to A with A's name |
| Task 3 | Name ends `-03`; completed, assigned to B, absent from B.pendingTasks |

All three deadlines represent `2026-12-01T12:00:00.000Z`. Defaults and creation
dates come from the models. Fixtures are tagged and contain only dummy data.

## 4. Start and manually inspect the four GET operations

Run `npm start` (or `npm run dev` for Node's native automatic restart) in a
separate terminal. Expected: the service announces readiness only after actual
database connection/index readiness; local URL is `http://localhost:3000/api`
unless PORT was changed.

Import the current `docs/mp3.postman_collection.json` into Postman. Set
`runTag`, `userA`, `userB`, `task1`, `task2`, `task3` from the fixture output;
leave `apiBase` as the local base. With a fresh fixture set and no previous
created resources left behind, clear `createdTask`, `createdDate`,
`lastTaskSnapshot`, `createdUserC`, `createdUserCDate`, `createdUserD`,
`createdUserDDate`, `lastUserDSnapshot` and `completedTaskDate`.
`missingUser` and `missingTask` are generated automatically for error cases.
Do not put a database URI or password into Postman. Run the first 13 read/CORS
requests in order, then R01-R23, U01-U33 and Q01-Q06 below. The combined
collection contains 75 requests. Existing saved createdTask/UserC/UserD values deliberately
block another creation until you clean those resources. Save these IDs even if
you stop the sequence early; cleanup must use only your own saved resources.

| Action | Expected |
|---|---|
| GET `/api` | 200; `{message:"OK",data:{service:"cs409-mp3-api"}}` |
| GET `/api/health` | 200, `data.ready=true`; no token or URI |
| Scoped GET `/users` for A/B | 200; two users, sorted A then B |
| Scoped GET `/tasks` for three IDs | 200; three tasks, names ending 01/02/03 |
| where + sort + select + skip=1 + limit=1 + count=false | 200; one object containing only task2's name |
| Same request with count=true | 200; `data=3`, before paging |
| Scoped completed=true count | 200; `data=1` |
| GET `/tasks/<task1>?select={"name":1,"_id":0}&where=NOT_JSON` | 200; only task1 name; malformed irrelevant where ignored |
| User A member select plus malformed count | 200; only A's name; count ignored |
| Collection where `_id:{$in:[]}` | 200; `data=[]` |
| GET `/users/not-an-id?select=NOT_JSON` | 404; target takes precedence |
| Collection malformed where | 400 with safe `{message,data:{}}` |
| OPTIONS `/tasks` | 204, zero response body, CORS methods/headers |

Optional direct-browser checks can cover GET only. Use Postman for response
codes, encoded Params, OPTIONS and all later write operations. If the health
endpoint reports unavailable, inspect private local configuration; do not treat
the static service-information response as DB connectivity proof.

## 5. Manually verify Task creation and full replacement

Run R01-R23 in order after the first 13 requests. All requests provide complete
required bodies except the deliberately invalid cases. The default deadline is
`2026-12-01T12:00:00Z`; assigned user names are derived when omitted. The created
task name must keep the `QA-<runTag>-` prefix so cleanup can prove ownership.
R01 saves `createdTask` and `createdDate` automatically. Save/copy that task ID
before cleanup; never clear the variable while its task still exists.

| Requests / action | Expected |
|---|---|
| R01 POST task with name/deadline and fake server-owned fields | 201; new ID/current creation date; description empty, completed false, unassigned; client version ignored |
| R02 assign task to A; R03 GET A | PUT 200; derived A name; pendingTasks contains exactly task2 and createdTask |
| R04 complete for A; R05 GET A | Remains assigned to A; A.pendingTasks contains only task2 |
| R06 move completed task to B; R07 GET B | PUT 200; B owns it but B.pendingTasks is empty |
| R08 reopen for B; R09 GET B | completed=false; B.pendingTasks contains createdTask once |
| R10 transfer pending task to A; R11/R12 GET B/A | B empty; A has task2 and createdTask exactly once |
| R13 populate description/completion; R14 PUT only name/deadline; R15 GET A | Optional fields all reset: description empty, completed false, empty/unassigned ownership; A has only task2 |
| R16 missing required fields; R17 malformed URL ID | 400 then 404; no mutation |
| R18 valid nonexistent user with mismatched name; R19 existing user with wrong name | 404 then 400; existence checked before fetched name matching |
| R20 GET task | All task fields equal the R14 snapshot, including creation date and internal version |
| R21 URL-encoded completed=false with A; R22 GET A | Actual Boolean false; A has task2 and createdTask once |
| R23 PUT only name/deadline | Task unassigned again; creation date unchanged |

Inspect status, common response envelope, the Postman Tests panel and the saved
variables, not just visible task names. Every successful PUT retains `_id` and
`dateCreated`; GET the Task/User pair after changes to inspect both directions.
For an additional failure check, save both users' GET responses before R16 and
compare them again after R20; they must also be unchanged.

These steps exercise normal/error behavior manually. Real fault injection,
session auditing, retry and concurrency proofs are provided by the integration
suite; there is deliberately no public fault toggle to click.

## 6. Manually verify User writes and both deletion directions

Continue with U01-U33 after R23. The Task-write sequence leaves createdTask
unassigned, while fixture task1 is unassigned, task2 belongs to A and task3 is
completed for B. The following requests create C/D and save their IDs/dates.
Do not overwrite or clear those saved IDs until their resources are cleaned.

| Requests / action | Expected |
|---|---|
| U01 POST User C with fake server-owned fields | 201; new server ID/date, pendingTasks=[], internal version 0 |
| U02 C lists task1/task2 with a duplicate; U03/U04 inspect A/Task2 | 200; deduplicated list, A becomes empty, Task2 owner/name becomes C |
| U05 assign completed Task3 to C; U06 rename C; U07 GET Task3 | Completed Task stays owned by C and receives C's renamed value |
| U08 replace C with name/email only; U09-U11 GET tasks | C.pendingTasks=[]; Task1/Task2 unassigned; completed Task3 remains assigned to renamed C |
| U12 give Task1 to B; U13 POST D with Task1; U14 GET B | 201 for D; Task1 moves to D and B.pendingTasks=[] |
| U15 duplicate email; U16 missing+completed refs; U17 only completed ref | 400, 404, 400 respectively, with no mutation |
| U18 invalid User URL; U19 missing required field; U20 GET D | 404 then 400; every D field/version equals U13's saved snapshot |
| U21 form pendingTasks JSON array; U22 GET Task2 | 200; D has Task1/Task2 and Task2 points back to D |
| U23 DELETE pending Task2; U24 GET D; U25/U26 GET/repeat DELETE | 200 with data=[]; D keeps only Task1; both later requests return 404 |
| U27 DELETE C with completed ownership; U28 GET Task3 | 200 with data=[]; Task3 still exists, completed=true, unassigned, same creation date |
| U29/U30 GET/repeat DELETE C | Both 404 with safe data={} |
| U31 DELETE D with pending ownership; U32 GET Task1; U33 GET D | 200 with data=[]; Task1 survives unassigned and incomplete; D is 404 |

For a creation persistence check, pause after U01, GET/save User C's data,
stop/restart the service, and GET C again before continuing U02. All fields,
including dateCreated, must match. The automated technical replay exercises
this separate-process check as well as persistence of completed-task cleanup.

The full collection intentionally deletes fixture Task2 and new Users C/D.
That is expected. Keep the other fixture IDs and createdTask for the final
safe CLI cleanup; no full database wipe is involved.

## 7. Verify query-boundary errors and the local release gate

After U33, run Q01-Q06. The surviving fixture User A is still available until
CLI cleanup. These are read-only requests; capture the existing resources if
you want to manually compare before/after state.

| Request | Expected |
|---|---|
| Q01 users select={"":1} | 400, safe message and data={} |
| Q02 tasks select={"name":1,"name.child":1}, count=true | 400; unused select is still validated |
| Q03 users sort={"":1}, count=true | 400; unused sort is still validated |
| Q04 nonexistent member with conflicting select | 404; target lookup comes first |
| Q05 existing User A with conflicting select | 400 |
| Q06 tasks select={"$bad":1}, count=true | 400; invalid reserved projection field |

For the reproducible local release gate, stop manual activity and run:

```sh
npm ci
npm run check
npm run test:integration
```

Expected: clean install from the existing lockfile, no source/lock drift, and
all local/integration checks pass with zero failed/cancelled/skipped cases.
The real suites include 128 query subsets, fault injection at all 19 observed
write positions and controlled stale-snapshot races. Do not deliberately stop
your own Atlas cluster to imitate those tests: the availability suite closes
only its own separate client and checks that persistent data stays unchanged.
Missing database configuration must fail, never be counted as a skipped pass.

## 8. Persistence and safe cleanup

For the recommended API-only method from section 0, stop other manual activity
and use `npm run acceptance:clean`, including after an early stop. Do not use
the database fixture CLI on its API manifest. The instructions below apply
only if you originally used `fixtures:create` and its separate manifest.

After U33/Q06, stop/restart the local service and GET createdTask, User A and
fixture Task3. Expected: createdTask remains unassigned with its original date;
A.pendingTasks=[]; Task3 remains completed/unassigned after C's deletion.
The new C/D users and fixture Task2 remain 404 after restart.

If you stopped before finishing U01-U33, DELETE any surviving createdUserC and
createdUserD by their saved IDs first. Their successful DELETE is 200, or 404
if already removed. This unassigns their tasks so developer cleanup can safely
check relationships. Do not delete an unrelated User just to make cleanup pass.
If you only ran R01-R23, A.pendingTasks=[task2] is the correct intermediate
state instead. Stop the application before CLI cleanup. Copy createdTask and run:

```sh
npm run fixtures:clean -- --task-id YOUR_CREATED_TASK_ID
```

Replace `YOUR_CREATED_TASK_ID` with the saved 24-hex ID, without angle brackets.
If you only ran the initial 13 read requests and never R01, use
`npm run fixtures:clean` without an extra ID. If you deliberately created more
owned tasks, repeat `--task-id ID` for each and retain their QA run-name prefix.

Expected: only the manifest's tagged users/tasks and explicitly supplied tagged
created task IDs are removed transactionally; then the manifest is removed.
Cleanup refuses malformed/foreign IDs or any relationships extending beyond the
supplied set. In particular, omitting an assigned created task's ID refuses the
cleanup rather than leaving it dangling. No database/collection wipe is used.

Restart the app if needed to GET a removed ID: expect 404; a collection scoped
to the removed IDs returns 200 with []. Stop it when finished. Only after
successful cleanup and removal of created Users C/D, clear the saved Postman
resource/date/snapshot variables. Keep the actual saved IDs until then.

## 9. What this round cannot accept yet

- Automated verification does not complete your owner-operated manual acceptance.
- All ten operations and the listed local risk/release gates have automated
  evidence in SOP.txt; actual online release/revision checks remain separate.
- Render service creation, publishing/deploying the actual developed revision,
  private production-DB/network configuration and public HTTPS acceptance are
  pending. The owner confirmed the service does not yet exist.
- After online technical checks, complete the same owner-operated chain on
  that deployed revision and record the actual results.
- Set only submit.js API_URL to the actual origin, warm readiness, run the
  course self-check and review the actual report; no score is claimed yet.
- Fill readable MP3 conversation links into llm_logs.csv, verify sources/public
  repository, then the owner completes the grading form/LLM survey and retains
  its receipt. The original grader URL and timeout remain unchanged.
