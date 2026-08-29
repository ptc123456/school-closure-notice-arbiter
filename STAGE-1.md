# Stage 1 — School Closure Notice Arbiter

Trust problem: district and school notices may disagree on closure/reopen dates. Actors: district publisher, parent/reviewer, assessor, validators, reader. Workflow: bind two notices -> freeze -> assess -> `MATCH`, `CONFLICTING_DATES`, `ONE_SOURCE_OLDER`, `INSUFFICIENT_NOTICE`, or `UNRESOLVED`. No emergency dispatch. Closest project: `emergency-alert-revision-arbiter`; this is school-date consistency only. Evidence: school ID, notice IDs, ISO dates, URL digests and readback. Risk: timezone; use date-only values.

## Revision 2 — ordering and missing fields

`ONE_SOURCE_OLDER` is derived only from an explicitly declared revision ordinal or effective ISO date; HTTP headers/timestamps and retrieval order are forbidden authority. Missing school ID or notice identity => `UNRESOLVED`; missing closure date => `INSUFFICIENT_NOTICE`; missing reopen date is allowed only when notice explicitly says closure duration is unknown, otherwise `INSUFFICIENT_NOTICE`; missing revision on either source => `UNRESOLVED`.
