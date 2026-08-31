# School Closure Notice Arbiter

GenLayer Intelligent Contract that compares two independently published school-closure notices for one school.

## Verified links

Studionet contract and Explorer links are intentionally not published yet: PRE_DEPLOY, Studio deployment and POST_DEPLOY_TEST are still required. The static UI is in `frontend/` and is not live evidence.

## Trust problem and why GenLayer

District or school publishers may issue notices that disagree on closure or reopening dates. A reviewer needs a bounded, reproducible comparison instead of trusting retrieval order, HTTP timestamps, or one publisher's claim. GenLayer is essential here because independent validators can re-fetch the two public sources, normalize stable fields, and reject a leader result when the material evidence differs.

## How it works

1. A publisher creates a case with a school ID and two distinct HTTPS notice URLs.
2. The owner freezes the sources, then `assess` independently extracts bounded notice fields.
3. The contract records the outcome and a canonical Keccak evidence digest. `UNRESOLVED` transport/identity/revision failures remain retryable up to three retries.
4. A reader calls `get_case` or `get_case_state` for authoritative on-chain readback.

## Architecture

The Intelligent Contract owns case state, source binding, nondeterministic extraction, validator comparison, outcome selection, retry bounds, and evidence digest. The static browser UI owns wallet selection and user interaction only; it does not become a source of truth. The public notice URLs are external evidence, while the final normalized outcome and digest are on-chain.

## Intelligent Contract

The actors are the case owner/publisher, independent validators, and readers. The state machine is `DRAFT -> FROZEN -> ASSESSED`, with `FROZEN -> RETRYABLE -> ASSESSED` for unresolved evidence. Public methods are `create_case`, `freeze_case`, `assess`, `retry_unresolved`, `get_case`, and `get_case_state`. The validator independently collects the same two notices and compares canonical JSON, not raw model prose. No value transfer or emergency dispatch is in scope.

## Transaction lifecycle

The UI sends writes through the selected EIP-6963 provider, reports signing and submission, waits for `FINALIZED`, checks semantic execution success, then performs `get_case` readback. A failed execution or timeout is shown as an error; it is not represented as a successful state transition. The current static UI uses bounded polling and a single in-flight write guard.

## Current implementation

- Contract: `contracts/school_closure_notice_arbiter.py`
- Direct Mode tests: `tests/test_contract.py`
- Runtime feasibility probe: `test_probe.py`
- Architecture and adaptation record: `docs/ARCHITECTURE.md`

The contract binds two distinct HTTPS sources, freezes the case, independently extracts bounded notice fields, and records one of `MATCH`, `CONFLICTING_DATES`, `ONE_SOURCE_OLDER`, `INSUFFICIENT_NOTICE`, or `UNRESOLVED`. HTTP timestamps and retrieval order are never used as revision authority.

## Verification

```powershell
$env:PYTHONIOENCODING='utf-8'
py -3.13 -m pytest -q -p no:cacheprovider
genvm-lint check .\contracts\school_closure_notice_arbiter.py
genvm-lint schema .\contracts\school_closure_notice_arbiter.py
genvm-lint typecheck .\contracts\school_closure_notice_arbiter.py
```

The browser frontend is a static no-install surface. It loads the pinned GenLayerJS ESM build at runtime and implements EIP-6963 wallet selection, exact provider routing, transaction finality/execution checks, and authoritative readback. It has not been tested against a deployed contract yet.

## Security and trust boundaries

Fetched notice bodies are untrusted data. The extraction prompt delimits them and ignores embedded instructions. Only fixed normalized fields are used. HTTP headers, retrieval order, local timestamps, and free-form reasoning cannot establish revision order. Missing identity, revision, or unavailable evidence fails closed to `UNRESOLVED`.

## Deployment and known limitations

The release target is Studionet. Current local checks do not prove Studio compilation, live consensus/finality, deployed-source parity, wallet behavior against a deployed address, GitHub publication, or Vercel behavior. The exact cached runner exposes `response.status`, while the current online web-access example uses a different spelling; the source records this version-sensitive conflict and requires a fresh Studio probe before PRE_DEPLOY.
