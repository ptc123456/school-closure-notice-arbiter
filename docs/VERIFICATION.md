# Verification

This document records the current local build checkpoint. It is not a PRE_DEPLOY, live Studio, GitHub, or Vercel approval.

## Exact revision

- Contract/source commit: `a8bd6ea66fa7731e8f763b3dec443a3407927ba0`
- Contract source SHA-256 at that commit: `3A1FBAD7B8D148A81765E02BF2F213E08457E8A37674CC9EC461B6785540E43F`
- Frontend hardening baseline commit: `4c6fdadd52d824b9d1fc8a261f8387c13cb0a4cc`
- Frontend transaction/recovery correction commit: `9836b2cd6c201507260e029ad35793b2f4919e06`
- Runtime conflict probe commit: `ac9b535f8d541d5b4e4536700401e603d2f60444`
- Current public-tree commit: recorded in the GitHub Presentation Pre-Push Report immediately before any push; this document intentionally identifies the exact source/frontend commits rather than self-referencing a future documentation commit.
- Contract: `SchoolClosureNoticeArbiter`
- Network: Studionet is the intended release network; no contract is deployed yet.
- Studio deployer/upgrader: `0x34b92E6553eaCA11A00A9d86d75d8a7881779D78`, directly selected in the signed-in GenLayer Studio session; no signature has been requested.
- Current exact local-tree commit: `ac9b535f8d541d5b4e4536700401e603d2f60444`; no GitHub push has occurred.

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
node --test .\frontend\regression.test.mjs
# 5 tests passed
powershell -ExecutionPolicy Bypass -File E:\Genlayer\scripts\audit-genlayer-project-gates.ps1 -ProjectName school-closure-notice-arbiter
# PASS shared-governance structured invariants; PASS project
```

## Frontend regression evidence

The dependency-free Node suite was run on 2026-08-31 with Node `v22.22.2`:

- pre-await single-flight lock: passed;
- pending hash persistence after readback failure and restart reconciliation: passed;
- explicit `FINALIZED`, accepted consensus, and `FINISHED_WITH_RETURN` proof: passed;
- selected-provider account approval/chain-switch ordering and rejected connection: passed;
- listener cleanup and focus wrapping: passed.

The local browser smoke was run against `http://127.0.0.1:8765/frontend/index.html?v=20260831-recovery2` on 2026-08-31. It verified disconnected reload state, explicit wallet chooser, unsupported-wallet handling, no visible `EIP-6963` protocol label, and zero browser console errors. No wallet signature or Studio transaction was sent.

## Runtime conflict evidence

Official documentation was retrieved on 2026-08-31 at approximately 22:03 +07:00:

- [GenLayer Web Access](https://docs.genlayer.com/developers/intelligent-contracts/features/web-access) shows `Response.status_code` in its HTTP examples and says external responses must be reduced to stable consensus-safe fields.
- [GenLayerJS transaction methods](https://docs.genlayer.com/api-references/genlayer-js/transactions) documents `waitForTransactionReceipt` at `FINALIZED` and `getTransaction` as the source for status, execution result, and consensus details.
- [GenLayer networks](https://docs.genlayer.com/developers/networks) records Studionet RPC `https://studio.genlayer.com/api`, chain ID `61999`, and Explorer `explorer-studio.genlayer.com`.

Installed verification environment at 2026-08-31 22:03:19 +07:00: Python `3.13.6`, Node `v22.22.2`, `genvm-lint 0.11.0`, cached runner `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`.

Exact reproduction command for the documented-field conflict:

```powershell
$env:PYTHONIOENCODING='utf-8'
py -3.13 -m pytest -q .\runtime_status_probe.py -p no:cacheprovider
# exit code 1
# AttributeError: 'Response' object has no attribute 'status_code'
# probe_status_code_contract.py:11: return gl.nondet.web.get(url).status_code
```

The production-shaped replacement probe uses `response.status` in `test_probe.py` and passes as part of the 26-test contract suite. The exact Studio runtime remains a required post-approval verification because the online documentation and cached runner are version-sensitive and must not be silently conflated.

## Live evidence status

- Studio contract address: Not deployed; PRE_DEPLOY is required first.
- Studio account selection: deployer/upgrader `0x34b92E6553eaCA11A00A9d86d75d8a7881779D78` selected and recorded; no deployment/signature/write sent.
- Deployment transaction / Explorer: Not available.
- Deployment-source parity: Not available until deployment.
- Live web URL: Not deployed.
- Studio E2E matrix: Not run.
- GitHub URL: Not configured or pushed.
- Vercel E2E: Not run by design; this task stops before Vercel.

## Known limitations and next gate

The cached Direct Mode runner is `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` and exposes `Response.status`. The current online web-access documentation uses `status_code` in its example. This is recorded as a version-sensitive boundary; the exact Studio runtime must be probed before PRE_DEPLOY. No live evidence is inferred from the local green tests.
