# Verification

This document records the current local build checkpoint. It is not a PRE_DEPLOY, live Studio, GitHub, or Vercel approval.

## Exact revision

- Commit: `856279f7d060d68d666088f1fc81d0e7e475cb46`
- Contract source SHA-256 at the committed revision: `7AE391A3E8000B0279D8DCABFD9FC04366C832AE83E586EF4B86A884EEA77EC4`
- Contract: `SchoolClosureNoticeArbiter`
- Network: Studionet is the intended release network; no contract is deployed yet.

## Contract inventory

- Storage: `TreeMap[str, ClosureCase]`, with `@allow_storage` dataclass and `retry_count:u8`.
- Writes: `create_case`, `freeze_case`, `assess`, `retry_unresolved`.
- Views: `get_case`, `get_case_state`.
- Nondeterminism: bounded `gl.nondet.web.get` plus fixed-field `gl.nondet.exec_prompt`, wrapped by a custom leader/validator `gl.vm.run_nondet_unsafe` comparison.
- Consequence: only the normalized outcome, retry state, stored evidence fields, and digest are mutated; unavailable or disagreeing evidence cannot become a substantive positive result.

## Local commands and results

```powershell
$env:PYTHONIOENCODING='utf-8'
py -3.13 -m pytest -q -p no:cacheprovider
# 26 passed
genvm-lint check .\contracts\school_closure_notice_arbiter.py
# Lint passed; Validation passed
genvm-lint schema .\contracts\school_closure_notice_arbiter.py
# 6 methods: 4 write, 2 view
genvm-lint typecheck .\contracts\school_closure_notice_arbiter.py
# No type errors found
node --check .\frontend\app.js
# exit code 0
powershell -ExecutionPolicy Bypass -File E:\Genlayer\scripts\audit-genlayer-project-gates.ps1 -ProjectName school-closure-notice-arbiter
# PASS shared-governance structured invariants; PASS project
```

## Live evidence status

- Studio contract address: Not deployed; PRE_DEPLOY is required first.
- Deployment transaction / Explorer: Not available.
- Deployment-source parity: Not available until deployment.
- Live web URL: Not deployed.
- Studio E2E matrix: Not run.
- GitHub URL: Not configured or pushed.
- Vercel E2E: Not run by design; this task stops before Vercel.

## Known limitations and next gate

The cached Direct Mode runner is `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` and exposes `Response.status`. The current online web-access documentation uses `status_code` in its example. This is recorded as a version-sensitive boundary; the exact Studio runtime must be probed before PRE_DEPLOY. No live evidence is inferred from the local green tests.

