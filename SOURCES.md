# Sources and tools

Accessed 2026-11-02. Sources are recorded as actually consulted, without claiming
that these documents contain this project's custom implementation.

- Course starter `README.md`, `FAQ.md`, source and lockfile: assignment contract
  and initial structure. Preserve the original course documents and MIT license.
- Prior local MP1/MP2 SOPs and relevant MP2 planning/release conversation:
  24-step workflow, staged acceptance and maintainable English documentation.
- [Mongoose transactions](https://mongoosejs.com/docs/transactions.html):
  sessions, transaction callback behavior and sequential work.
- [Mongoose validation](https://mongoosejs.com/docs/validation.html): unique
  indexes, update-validator limitations and schema validation.
- [Mongoose update return behavior](https://mongoosejs.com/docs/tutorials/findoneandupdate.html).
- [MongoDB transactions](https://www.mongodb.com/docs/manual/core/transactions/)
  and [deployment considerations](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/).
- [Render Node selection](https://render.com/docs/node-version) and
  [Web Services](https://render.com/docs/web-services).
- [RFC 9110, 204](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.5).
- [body-parser security advisory](https://github.com/advisories/GHSA-27r3-jxmh-p828)
  and [qs security advisory](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw):
  targeted compatible lockfile fixes after the initial npm audit. Node 24 native
  watch replaces the redundant nodemon dependency chain; no forced downgrade.
- OpenAI Codex: planning and approved development assistance. Actual shareable
  conversation URLs belong in `llm_logs.csv` once supplied/verified. An empty
  index is not a completed chatlog submission; the owner must also complete the
  course LLM survey if generated code is used.

Live documentation may display newer patch versions than this repository.
Installed locked-version behavior and real tests control compatibility.

Atlas first-cluster setup guidance (owner confirmed no cluster yet):

- https://www.mongodb.com/docs/atlas/tutorial/deploy-free-tier-cluster/
- https://www.mongodb.com/docs/atlas/security-add-mongodb-users/
- https://www.mongodb.com/docs/atlas/security/ip-access-list/
- https://www.mongodb.com/docs/atlas/driver-connection/

Round 2 transaction implementation references, checked 2026-11-03:

- [MongoDB Node.js transactions](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/):
  explicit session propagation, retryable transaction callbacks and errors.
- Installed `mongoose/lib/connection.js` and `mongodb/lib/sessions.js`:
  locked 9.11.1/7.7.0 transaction wrapper, session cleanup and `timeoutMS` support.
  Live docs currently show a newer Mongoose patch; no dependency upgrade was made.
- Existing README/FAQ/API contract and SOP Steps 7, 15-16: full Task replacement,
  completed ownership, bidirectional membership and error precedence.

Round 3, checked 2026-11-03:

- Local README/FAQ and approved SOP Steps 17-18: User error precedence, full
  replacement, assignment transfer, completed-task rename and deletion cleanup.
- Existing transaction service plus actual Atlas/HTTP regression evidence:
  reused the locked implementation; no new dependency or cloud setup was needed.
- D6 remains the owner's approved provisional DELETE 200/JSON contract; neither
  local passing tests nor a documented response claim official grader approval.

Round 4, checked 2026-11-03:

- Actual Atlas query diagnostics: empty projection field (40352), parent/child
  collision (31249), Mongoose empty-sort-path rejection; reproduced HTTP 500
  regressions before adding shared path validation. Connection details omitted.
- [MongoDB projection restrictions](https://www.mongodb.com/docs/manual/reference/limits/#projection-restrictions):
  empty fields, reserved/positional paths and parent/child collisions.
- [Positional projection](https://www.mongodb.com/docs/manual/reference/operator/projection/positional/):
  ending placement and one positional projection.
- Existing locked Mongoose connection/session implementation, transaction service
  and real Atlas tests: same-session sequential writes, observed write-boundary
  aborts, controlled race ordering and a separate real disconnected client.
- Existing SOP risk register, README/FAQ and frozen D1-D7 remain the scope;
  local release verification does not establish cloud/grader/form acceptance.

Round 5 deployment preparation, checked 2026-11-03:

- Actual app/server/query/transaction code, original README/FAQ, current SOP and
  the 75-request collection: reviewed the three requirement pillars and reused
  their executable expectations in API-only owner/online acceptance tools.
- [Render Express deployment](https://render.com/docs/deploy-node-express-app),
  [Node precedence](https://render.com/docs/node-version),
  [outbound IP ranges](https://render.com/docs/outbound-ip-addresses) and
  [Free service behavior](https://render.com/docs/free): actual Dashboard fields,
  environment/version choice, Atlas allowlist and cold-start guidance.
- [Render Blueprint specification](https://render.com/docs/blueprint-spec) was
  consulted as a configuration alternative; this delivery uses Dashboard steps,
  not a Blueprint or a claim that one was deployed.
- The owner confirmed no Render service exists. No cloud account modification,
  public URL, grader score, shared-log completion or form receipt is fabricated.

DELETE response correction, 2026-11-04:

- Owner-provided course autograder report for
  https://cs409-mp3-api-wyqe.onrender.com: 90/100, both DELETE success responses
  require 204/no content; deleted-resource GET checks passed. This resolves D6
  and supersedes the provisional 200/JSON decision. No corrected score is claimed.
- [RFC 9110, 204](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.5):
  204 responses contain no response content. The actual deletion router, shared
  JSON helper and client parser/test assumptions were inspected before the fix.
- Actual README.md:89 explicitly requires Atlas Allow access from anywhere;
  setup guidance is corrected to match the assignment. Credentials remain private.
