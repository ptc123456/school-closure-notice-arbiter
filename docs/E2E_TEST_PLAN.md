# E2E TEST PLAN

Status: awaiting anonymous `E2E TEST PLAN` approval before any Studio transaction.

## Exact scope

- Project: `school-closure-notice-arbiter`
- Contract source revision: `5f16738b02994151056a1305d4d42f268e89aea4`
- Contract source SHA-256: `BA62C92CACD85386D2356CAE88760FED167CC6075F563BEE099B3676DCE22B39`
- Network: Studionet
- Studio account and role: `0x34b92E6553eaCA11A00A9d86d75d8a7881779D78`, deployer/upgrader
- Contract classification: `UPGRADABLE`; only the recorded Studio account is authorized for deployment/upgrade.
- Browser surface: Codex in-app Browser, Studio only.
- Scope boundary: deploy and Studio E2E only. No GitHub push, Vercel deployment, or Vercel E2E in this checkpoint.

## Proof requirements

For deployment and every write, retain the transaction hash and inspect the current status, execution result, consensus/finality result, and authoritative readback. A write is `PASS` only when status is `FINALIZED`, the interface-specific execution result is successful (`FINISHED_WITH_RETURN` where returned), consensus/finality is successful, and readback matches the expected state. A rejected write is `PASS` only when the rejection and unchanged readback are both observed.

Before testing, verify the deployed source returned by the current Studio/RPC equivalent matches the source revision and SHA-256 above. Record the contract address, deployment transaction, constructor arguments (`none`), network, account, and Explorer/RPC links.

## Minimum Studio matrix

### DEPLOY-01 — deploy exact reviewed source

- Purpose: prove the reviewed contract compiles and is deployed by the locked Studio account.
- Action: upload `contracts/school_closure_notice_arbiter.py` in Studio Run Debug and deploy with no constructor arguments.
- Expected: deployment hash; `FINALIZED`; successful deployment execution; contract address; source/code parity.
- Evidence: deployment receipt, status/receipt lookup, source hash, address and Explorer link.

### CASE-01 — complete critical journey and unresolved retry

Use one case with two distinct HTTPS URLs that intentionally return missing responses, so the live path exercises web-response status handling without depending on mutable school content:

- `case_id`: `studio-e2e-unresolved-01`
- `school_id`: `STUDIO-E2E-SCHOOL`
- `url_a`: `https://example.com/studio-e2e-missing-a`
- `url_b`: `https://example.com/studio-e2e-missing-b`

Ordered actions and expected evidence:

1. `create_case(case_id, school_id, url_a, url_b)` from the locked account. Expect `FINALIZED`, semantic success, return `studio-e2e-unresolved-01`; `get_case` must show `state=DRAFT`, empty outcome and `retry_count=0`.
2. `freeze_case(case_id)`. Expect `FINALIZED`, semantic success, return `FROZEN`; `get_case` must show `state=FROZEN` and unchanged source binding.
3. `assess(case_id)`. Expect `FINALIZED`, semantic success, consensus/finality evidence, and a method-specific return beginning `RETRYABLE:UNRESOLVED`; `get_case` must show `state=RETRYABLE`, `outcome=UNRESOLVED`, and `retry_count=0`. This is the hosted runtime control for the web response status path and the leader/validator nondeterministic comparison.
4. `retry_unresolved(case_id)`. Expect `FINALIZED`, semantic success, return `RETRYABLE:UNRESOLVED`; `get_case` must show `state=RETRYABLE`, `outcome=UNRESOLVED`, and `retry_count=1`. This proves the retry transition and bounded re-evaluation without creating a second case or changing source binding.
5. Read both `get_case(case_id)` and `get_case_state(case_id)` after the final write. They must agree authoritatively on `RETRYABLE`; retain the complete final record and digest.

The two URLs are distinct valid HTTPS inputs and are expected to return 404 from `example.com`; if live observation differs, record the actual outcome and retain the same case rather than submitting a duplicate write. The plan does not claim a `MATCH` result from mutable external pages.

## RPC and duplicate-write controls

- Use one Studio session and the locked account throughout.
- Perform one write at a time; wait for a terminal receipt before the next write.
- Do not retry a still-pending/proposing transaction and do not create a replacement case after a readback delay; preserve the original hash and reconcile it.
- Use lightweight status polling and fetch the full receipt only at terminal state or for diagnosis; capture authoritative readback once per terminal write.
- Expected write count: 5 total (deployment, create, freeze, assess, retry); expected view readback: after each write where needed, with final agreement between both views.

## Failure handling

Record every attempted case as `PASS`, `FAIL`, or `BLOCKED`. At the first failure, preserve the exact hash/error and continue only safe readbacks and unaffected observations. Do not patch or redeploy during this matrix. Any contract/source/configuration change invalidates this plan and requires a new exact-source plan approval before continuing.

## Acceptance criteria

- `DEPLOY-01` and every `CASE-01` write has a real hash, `FINALIZED`, semantic execution success, consensus/finality evidence, and matching authoritative readback.
- The deployed source hash equals `BA62C92CACD85386D2356CAE88760FED167CC6075F563BEE099B3676DCE22B39`.
- No duplicate transaction is submitted and no write remains unreconciled.
- Studio evidence is sufficient to request anonymous `POST_DEPLOY_TEST` review for this exact deployed source and evidence package.
