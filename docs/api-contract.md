# MP3 API contract

Status: D1-D7 approved by the owner on 2026-11-02. This is the target contract;
the implementation through Round 3 covers all ten User/Task resource HTTP
operations. Runtime checks, owner manual acceptance and later release gates
remain distinct. D6 is now resolved by actual grader feedback: successful DELETE returns 204
with no response body. The original 200/JSON fallback is superseded.

Round 4 release-candidate checks passed on 2026-11-03: clean install, 79 local
and 86 reported Atlas checks, plus the actual 75-request replay. SOP.txt stores
the exact grouping/counts and runtime fingerprint. This is separate from owner
manual acceptance, an actual Render release, grader feedback and submission.
Round 5 reran the full actual-directory gate: 81 local tests and 90 reported
Atlas entries passed, plus the delivered CLI 75/252 HTTP replay and safe cleanup.
Counts/grouping and unchanged-data checks are recorded in SOP.txt.
The DELETE 204 correction passed on 2026-11-04: 90 local tests, 93 reported
Atlas entries and actual server.js 75/249 replay/cleanup. New raw-byte DELETE
cases, deferred failures and strict parser regressions passed. This is local
verification; the corrected online release and official score remain pending.

The actual starter code and lockfile govern integration; README.md and FAQ.md
define required target behavior. Contract changes require updating examples,
tests and implementation together. IDs below correspond to SOP.txt.

## Environment and response ownership

- Node 24, CommonJS, Express 5, Mongoose 9, Atlas, Render Web Service.
- Local base: `http://localhost:3000/api`. Deployment base: actual HTTPS origin
  plus `/api`. `submit.js` instead receives only the origin.
- GET `/api` provides service information; GET `/api/health` returns 200 when
  the database is connected, otherwise 503. Neither exposes tokens or URIs.
- JSON resource responses have exactly `message` (a readable string) and `data`.
  Successful DELETE is the explicit 204/no-body exception; do not parse it as JSON.
  Errors use `data: {}` and do not include database/stack/credential details.
- OPTIONS returns 204, without a body, with the declared CORS headers.
- Unknown API paths return 404 in the same envelope.
- Dates serialize as ISO timestamps. The server owns `_id`, `dateCreated` and
  internal `__v`; incoming values for these fields and unknown properties are
  ignored. Required values are validated before Mongoose casting.

## DATA: resources and normalized input

| User field | Meaning and validation | Omission |
|---|---|---|
| `_id` | Server-generated identity, JSON string | Server generated |
| `name` | Nonempty string after outer trim | 400 |
| `email` | Trimmed string, basic address shape, case preserved, unique | 400 |
| `pendingTasks` | Array of unique existing incomplete task ID strings | `[]` |
| `dateCreated` | Server time at creation; unchanged on PUT | Server generated |

| Task field | Meaning and validation | Omission |
|---|---|---|
| `_id` | Server-generated identity | Server generated |
| `name` | Nonempty string after outer trim | 400 |
| `description` | String, including an empty string | `""` |
| `deadline` | Valid date string; invalid calendar components are rejected | 400 |
| `completed` | JSON Boolean | `false` |
| `assignedUser` | Empty string or existing User ID string | `""` |
| `assignedUserName` | Actual assigned user's name | Derived or `"unassigned"` |
| `dateCreated` | Server time at creation; unchanged on PUT | Server generated |

Explicit null or wrong JSON type is not an omitted field. Valid date-only
strings and date-time strings with timezones are accepted; a date need not be
in the future. Equivalent timezone instants serialize identically. No DNS email
lookup, automatic email lowercasing, or extra business length limits are added.
Reference IDs use 24 hexadecimal characters; their canonical spelling is lower
case. Deduplicate pending IDs while preserving their first occurrence.

JSON request bodies require their real JSON types. For URL-encoded bodies,
decode `completed=true/false` explicitly and `pendingTasks` from a JSON array
string or parser-produced array; then apply the same validator. Reject other
Boolean literals and array shapes. Do not treat the string `false` as true.

## HTTP: methods, statuses, and body semantics

| ID | Method/path | Success data | Success status |
|---|---|---|---|
| HTTP-01 | GET `/users` | User array, or number for count | 200 |
| HTTP-02 | POST `/users` | Created User | 201 |
| HTTP-03 | GET `/users/{id}` | User, subject to select | 200 |
| HTTP-04 | PUT `/users/{id}` | Replaced User | 200 |
| HTTP-05 | DELETE `/users/{id}` | No response body | 204 |
| HTTP-06 | GET `/tasks` | Task array, or number for count | 200 |
| HTTP-07 | POST `/tasks` | Created Task | 201 |
| HTTP-08 | GET `/tasks/{id}` | Task, subject to select | 200 |
| HTTP-09 | PUT `/tasks/{id}` | Replaced Task | 200 |
| HTTP-10 | DELETE `/tasks/{id}` | No response body | 204 |

PUT replaces all business fields, applies missing optional defaults, requires
name/email or name/deadline again, retains identity/creation time, and never
upserts. It is not PATCH. DELETE removes only the selected resource and cleans
references; deleting a user retains their tasks as unassigned.

D6 resolved on 2026-11-04: the owner's actual course grader report required
204 and an empty response body for both successful DELETE endpoints. The earlier
200/JSON policy was a provisional choice and is superseded. A successful DELETE
has zero content bytes and no message/data envelope. Missing/malformed targets
and unexpected failures retain the existing 404/500 JSON error envelopes.

## VALID: error ordering

For a syntactically valid POST/PUT body:

1. A member URL ID that is malformed or absent in the database -> 404.
2. Required fields, raw types, dates and body reference ID formats -> 400.
3. Email already used by another user (exclude this user's ID) -> 400.
4. Well-formed referenced IDs that do not exist -> 404.
5. Fetched-state rules, including completed pending tasks or mismatched assigned
   name -> 400.
6. Unexpected infrastructure error -> 500 with a safe message.

Malformed JSON necessarily fails in parsing -> 400. For member GET, resolve
the URL target before validating select; a missing member returns 404 even if
select is invalid. This precedence is the owner's D5 choice. Malformed
irrelevant member parameters are ignored. Every rejected write leaves all
business and relationship documents unchanged.

## QUERY: collection and member behavior

| ID | Parameter | Format / semantics |
|---|---|---|
| QUERY-01 | `where` | JSON object, Mongo equality/comparison/logical operators including `$in` |
| QUERY-02 | `sort` | JSON field map, each direction 1 or -1 |
| QUERY-03 | `select` | JSON field map, values 1/0; normal `_id` exception allowed |
| QUERY-04 | `skip` | Nonnegative integer; default 0 |
| QUERY-05 | `limit` | Nonnegative integer; tasks default 100, users unlimited, explicit 0 unlimited |
| QUERY-06 | `count` | JSON true/false; true returns a number, false returns documents |

- All six compose on both collection GETs. Use Mongoose filtering, sorting,
  projection, pagination and `countDocuments`; no post-fetch array operations
  may replace query execution.
- Count means all documents matching `where`, before skip/limit and independent
  of sort/select. Still validate all recognized collection parameters first.
  This interpretation and explicit limit=0 are approved D5 choices.
- Malformed JSON or wrong recognized parameter type -> 400. Reject repeated
  recognized parameters, negative/fractional/non-numeric paging and mixed
  non-ID include/exclude projections. Empty maps are valid no-op maps.
- Sort/select paths must have nonempty components and no NUL character.
  Select must not name both a parent and its child. MongoDB reserved-field and
  positional placement/count/inclusion restrictions apply; valid nested paths,
  DBRef field spelling and an ending positional field are preserved. These
  checks run even with count=true. Member target 404 still precedes select 400.
- Unknown query keys are ignored. The framework decodes the URL once; parse
  JSON once. API ordering without an explicit sort is unspecified.
- QUERY-08: member GET recognizes only select; ignore all other query keys,
  even malformed where, count, limit or sort.
- QUERY-09: no collection matches -> 200, `data: []` or `data: 0`. Missing or
  invalid member ID -> 404. A member result may omit `_id` under projection.

Example (enter values in an HTTP client's Params editor):

```text
GET /tasks
where={"completed":false}
sort={"name":1}
select={"name":1,"_id":0}
skip=1
limit=1
count=false
```

## REF and ATOM: invariants after every mutation

- REF-01: an incomplete assigned task occurs exactly once in its user's
  pendingTasks; each pending ID points back to that same incomplete task.
- REF-02: completed tasks occur in no pendingTasks but may stay assigned.
- REF-03: assignedUserName always equals the current user's name; unassigned
  means `assignedUser: ""`, `assignedUserName: "unassigned"`.
- REF-04: no dangling reference or ownership by multiple users.
- REF-05: both POST directions obey the same reference rules as their PUT.
- User PUT unassigns removed pending tasks, assigns newly listed tasks and
  removes them from any prior user's list. Existing completed assignments stay
  assigned. User rename updates names on all their tasks, including completed.
- Task PUT removes former pending membership, adds new membership only if
  incomplete, permits completed reassignment and restores membership on reopen.
- Task DELETE removes membership; User DELETE unassigns all their tasks.
- ATOM-01: use a shared transaction/session with sequential operations and
  conflict/version guards; re-read and recompute on supported retries. Respond
  only after commit. A real unique email index is the race-safe final guard.
- Atomicity and concurrency must be proved against real MongoDB, not mocks.

## Verification and change control

`npm test` runs pure/model/query and HTTP transport tests with model doubles;
`npm run check` checks syntax/contracts and those local tests;
`npm run test:integration` requires the isolated Atlas test database.
Missing database configuration must not be reported as a successful skipped
integration run. Test cleanup deletes only run-owned IDs, never whole databases.
SOP Appendix A maps IDs to steps. The staged Postman collection contains
13 initial read/CORS, 23 Task-write/inspection, 33 User-write/delete and six query-boundary requests;
`docs/manual-acceptance.md` gives the exact fixture and cleanup sequence.
Later rounds extend the same contract.

## Shared transaction implementation

`lib/relationships.js` owns one retryable transaction per operation, snapshot
reads, majority commit, explicit sessions and sequential database operations.
Its 15-second driver transaction budget bounds transient retries; a five-second
commit limit is also configured. Every attempt re-reads and recomputes. Internal
`__v` comparison plus an actual increment guards each touched existing user or
task, including a user whose completed-task assignment changes no pending list.
Missing version keys in older documents are guarded explicitly before the
first increment. No success response is produced inside a retry callback.

User create/replacement/rename and both deletion directions use this same
service and are mounted as HTTP endpoints in Round 3. User POST follows the
same transfer rules as User PUT. A missing pendingTasks field replaces a
nonempty list with []; completed assignments stay owned and receive the new
user name. Task DELETE removes pending membership. User DELETE unassigns all
owned tasks, including completed ones, and retains the task documents.
Constructor-only before/after-write hooks support real rollback/race tests;
there is no request parameter, environment switch or public fault endpoint.

Successful DELETE awaits transaction completion, then returns HTTP 204 with
zero response content. A repeat/malformed/missing target returns 404 with data:
{}. A failed transaction remains a safe JSON 500 and never becomes a false 204.

Transaction behavior was checked against locked Mongoose 9.11.1/driver 7.7.0
source and real Atlas, with the [Mongoose transaction guide](https://mongoosejs.com/docs/transactions.html)
and [driver transaction guide](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/)
as supporting references.

## Local release verification trace

The listed acceptance scope is local; SOP.txt records the actual run results.
The automated suites use real Atlas in the isolated test database, except the
explicit local/unit transport doubles. No test drops a database/collection.

| Requirement / risk | Concrete automated evidence | Manual / remaining gate |
|---|---|---|
| Fields/defaults, full replacement, dates | unit/validation; integration/task-writes and user-deletes | R01-R23, U01-U22 |
| Ten HTTP methods, envelopes, 200/201/400/404/500; OPTIONS 204 empty | unit/http, task-writes, user-deletes; actual collection replay | Initial reads/CORS and R/U sequences; successful DELETE is 204/empty |
| All query parameters, operators, limits and selection | reads plus query-boundaries: 64 subsets per resource, 101-item defaults, member precedence | Initial read checks; Q01-Q06 |
| Exact validation order, own/duplicate email, rejected snapshots | task-writes and user-deletes | R16-R20; U15-U20 |
| Both reference directions and completed ownership | all mutation suites with the independent world invariant checker | R02-R23; U02-U33 |
| Atomicity and session cleanup | transaction-boundaries discovers each successful path and faults every observed write; 19 positions across six mutation types | Constructor-only automated hooks; no public fault toggle |
| Stale reads, lost membership, late new assignments | relationship-races controlled before-write barriers plus prior deterministic races | Automated evidence; not an exhaustive proof of every possible interleaving |
| Actual database unavailable | availability connects then closes a separate real client; readiness 503, all ten operations safe 500, original snapshot retained | Does not disconnect the development/production service |
| Runtime/dependency/source reproducibility | npm ci, check, all integration suites, protected-file hashes and Git ignore audit | Public Render/revision validation remains Round 5 |
| Persistence and cleanup | Actual server-process restarts, owned fixture IDs, database counts and private-file fingerprint | Manual guide sections 7-8; owner acceptance remains pending |
| Sources/chatlogs/form and official score | SOURCES.md and SOP records distinguish actual vs pending evidence | Real readable chatlog links, Render/grader, owner form still pending |

Round 5 adds API-only acceptance preparation/replay/cleanup in
`scripts/acceptance.js` without changing the public contract or runtime business
logic. `integration/http-acceptance` exercises all 75 reviewed collection
requests over real HTTP/Atlas, lost/unsaved-ID recovery, a foreign sentinel and
foreign-link cleanup refusal. Owner checks and exact Render settings are in
`manual-acceptance.md` section 0 and `setup.md`; no public origin or online pass
is inferred from these local results.

DELETE correction regression coverage (2026-11-04):
- Unit HTTP cases for both endpoints assert 204 and actual zero-byte responses;
  deferred failures, missing targets and unexpected failures preserve JSON errors.
- scripts/api-response.js distinguishes empty DELETE success from strict JSON
  responses; negative tests reject the old 200/JSON contract and malformed bodies.
- integration/delete-contract independently reads raw HTTP bytes, then fresh GETs
  verify deleted resources, pending cleanup, surviving completed tasks and
  unchanged unrelated records. Existing rollback/concurrency cases remain active.
- Postman and API cleanup clients use the resolved contract; current collection
  expectations are 75 requests / 249 assertions. Actual run evidence is in SOP.txt.
