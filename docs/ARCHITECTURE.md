# Architecture and build handoff

## Scope preserved from Stage 1/2

The implementation is limited to comparing two notices for one school. The public workflow is:

`create_case` -> `freeze_case` -> `assess` -> optional bounded `retry_unresolved`.

The persisted record keeps the Stage 2 fields: owner, school ID, two URLs, dates, lifecycle state, outcome, declared revisions, evidence digest, and retry count. The outcome vocabulary is unchanged: `MATCH`, `CONFLICTING_DATES`, `ONE_SOURCE_OLDER`, `INSUFFICIENT_NOTICE`, and `UNRESOLVED`.

Date-only ISO values are accepted. Local timestamps, HTTP `Date`/`Last-Modified`, retrieval order, and page timestamps are not revision authority. Missing identity or declared revision remains `UNRESOLVED`; missing closure/reopen data follows the Stage 2 insufficiency rule; an explicit unknown-duration declaration permits an empty reopen date.

## Minimal implementation adaptations

### `STAGE 1/2 IMPLEMENTATION ADAPTATION`

- Original choice: use the web response status field shown in the current web-access documentation as `status_code`.
- Verified issue/authority: the installed official cached Direct Mode runner `py-genlayer` `1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` exposes `Response.status`; the local probe failed with `AttributeError` when using `status_code`.
- Replacement: use `response.status` and map `404/410` to `MISSING`, `0/429/5xx` to retryable `UNAVAILABLE`, and other non-2xx responses to `MALFORMED`.
- Preserved outcomes: source identity, date comparison, declared revision semantics, retry behavior, and no HTTP timestamp authority are unchanged.
- Affected verification: `test_probe.py` and `tests/test_contract.py` cover status handling, bounded extraction, disagreement, missing fields, and retryability.
- Residual risk: the current online documentation and the cached runner differ on this field name. The 2026-09-01 no-write schema probe passed for both the production source and isolated probe, but hosted Studio Run Debug could not execute the isolated method because the session reported no usable validator and hosted `gen_call` deploy returned a zero-address not-found error; the disputed field remains unverified.

- Original choice: follow the current documentation's dependency prologue alone.
- Verified issue/authority: the build experience record requires the runner version line before the dependency manifest for the live text runner, while current lint accepts both.
- Replacement: retain `# v0.1.0` before the `Depends` line in the exact contract source.
- Preserved outcomes: no product or trust-boundary change.
- Affected verification: `genvm-lint check`, schema, typecheck, Direct Mode tests, and the pre-lock probe all pass.
- Residual risk: the exact Studio runner/version must be recorded at PRE_DEPLOY; no deployment is authorized by this local result.

- Original choice: use `retry_count` as a bounded attempt counter.
- Verified issue/authority: the first implementation counted the initial assessment as a retry, causing the third retry boundary to be off by one.
- Replacement: increment `retry_count` only when `retry_unresolved` is called; the initial assessment leaves it at zero, and the third retry produces terminal `ASSESSED:UNRESOLVED`.
- Preserved outcomes: the Stage 2 bounded-retry workflow is unchanged, with clearer counter semantics.
- Affected verification: retry boundary regression in `tests/test_contract.py`.

- Original choice: treat any announced browser provider as a usable wallet and expose the provider protocol in the chooser.
- Verified issue/authority: the engineering gate requires a user-facing supported-wallet allowlist, graceful unsupported-wallet handling, session revalidation, and transaction identity/finality feedback; provider announcements and metadata are untrusted discovery input.
- Replacement: map only the selected provider object to MetaMask, OKX Wallet, or Rabby; keep discovery details out of visible copy; show inline chooser errors; revalidate account and chain before reads/writes; clean up account/chain/disconnect listeners; and retain the transaction hash with an Explorer link and copy action.
- Preserved behavior: no wallet request occurs before an explicit chooser selection, and no unavailable Studio/live result is claimed locally.
- Affected verification: `node --check frontend/app.js`, local no-wallet browser smoke with no console errors, and the exact-source PRE_DEPLOY package.
- Residual risk: live wallet signing, Studio execution/finality, and authoritative readback remain blocked until anonymous PRE_DEPLOY approval.

- Original choice: clear the transaction UI state in `finally` after waiting for a receipt.
- Verified issue/authority: a browser reload or transient readback failure can lose the only transaction identity and invite a duplicate write; the current GenLayerJS transaction guidance exposes both receipt polling and transaction lookup for reconciliation.
- Replacement: persist one canonical pending hash plus method/case metadata immediately after `writeContract` returns; keep the write lock while finality, consensus, execution, and method-specific readback are reconciled; clear storage only after successful readback.
- Preserved behavior: selected-provider session validation still runs before each read/write, and a failed or incomplete reconciliation never silently submits a replacement.
- Affected verification: `frontend/regression.test.mjs` covers pre-await single-flight, persistence/restart reconciliation, consensus/finality/execution proof, provider rejection/order, listener cleanup, and focus wrapping.
- Residual risk: if the wallet or RPC remains unavailable, the pending record intentionally remains until the same hash can be reconciled.

- Original choice: treat a successful wallet response as sufficient to enable writes.
- Verified issue/authority: a wallet can be connected while its account is invalid, unfunded, or different from a persisted pending transaction.
- Replacement: require a valid EVM account, bind each pending record to account/provider/method/contract/case, preflight local storage, require at least `0.01 GEN` spendable balance before enabling or submitting writes, and keep a volatile lock with the submitted hash if post-hash persistence fails.
- Preserved behavior: reads remain authoritative contract reads; no replacement write is enabled while a pending identity is unresolved.
- Affected verification: frontend regression suite covers invalid accounts, insufficient balance, storage failure after submission, account/provider mismatch, and restart reconciliation.

- Original choice: rely on browser-default focus indication for controls.
- Replacement: provide `:focus-visible` styling for buttons, links, and inputs, while retaining the modal focus trap and close-button return focus.
- Affected verification: CSS source check plus browser smoke focus inspection.

## Trust boundary

Fetched notice bodies are inserted between explicit untrusted-data markers in the extraction prompt. Embedded instructions, commands, policies, and output-format requests are ignored. Only the fixed JSON fields are normalized and used. Leader and validator independently derive the same canonical JSON summary; raw reasoning is not compared.

## Evidence and release boundary

Local Direct Mode is implementation evidence only. Before PRE_DEPLOY, the exact source hash, dependency/runtime version, schema, and anonymous-review package must be assembled. Studio deployment, live E2E, GitHub, Vercel, and final release evidence are not complete in this checkpoint.

## Experience entries applied

- Evidence unavailability is separated from a substantive negative result: transport `0`, `429`, and `5xx` remain `UNRESOLVED` and retryable; exact `404/410` is represented separately as `MISSING` before the decision layer.
- Production-shaped web/runtime values are used in mocks, and the probe verifies the actual response shape instead of relying on a permissive fake.
- Storage and nondeterminism are isolated: primitive URL/ID values are captured before the nondeterministic block, and the probe exercises storage copy/readback.
- Version-sensitive runner header ordering is preserved and explicitly held for Studio verification.
