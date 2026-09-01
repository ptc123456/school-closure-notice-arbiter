# Verification

This document records the current local build checkpoint. It is not a PRE_DEPLOY, live Studio, GitHub, or Vercel approval.

## Exact revision

- Contract/source compatibility correction commit: `402ebae4625f9f54c2fc938b07b4fcf281588bb8`
- Contract source SHA-256 at that commit: `BA62C92CACD85386D2356CAE88760FED167CC6075F563BEE099B3676DCE22B39`
- Frontend hardening baseline commit: `4c6fdadd52d824b9d1fc8a261f8387c13cb0a4cc`
- Frontend transaction/recovery correction commit: `9836b2cd6c201507260e029ad35793b2f4919e06`
- Runtime conflict probe commit: `ac9b535f8d541d5b4e4536700401e603d2f60444`
- Current public-tree commit: recorded in the GitHub Presentation Pre-Push Report immediately before any push; this document intentionally identifies the exact source/frontend commits rather than self-referencing a future documentation commit.
- Contract: `SchoolClosureNoticeArbiter`
- Network: Studionet is the intended release network; no contract is deployed yet.
- Studio deployer/upgrader: `0x34b92E6553eaCA11A00A9d86d75d8a7881779D78`, directly selected in the signed-in GenLayer Studio session; no signature has been requested.
- Current exact local-tree commit: recorded in the exact re-review package after the final commit; no GitHub push has occurred.

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
# 27 passed
genvm-lint check .\contracts\school_closure_notice_arbiter.py
# Lint passed; Validation passed
genvm-lint schema .\contracts\school_closure_notice_arbiter.py
# 6 methods: 4 write, 2 view
genvm-lint typecheck .\contracts\school_closure_notice_arbiter.py
# No type errors found
node --check .\frontend\app.js
# exit code 0
node --test .\frontend\regression.test.mjs
# 9 tests passed
powershell -ExecutionPolicy Bypass -File E:\Genlayer\scripts\audit-genlayer-project-gates.ps1 -ProjectName school-closure-notice-arbiter
# PASS shared-governance structured invariants; PASS project
```

## Frontend regression evidence

The dependency-free Node suite was run on 2026-09-01 with Node `v22.22.2`:

- synchronous pre-await single-flight lock: passed;
- canonical hash persistence after readback failure and restart reconciliation: passed;
- exact `FINALIZED`, `MAJORITY_AGREE`, and `FINISHED_WITH_RETURN` proof, including invalid aliases: passed;
- selected-provider account approval/chain-switch ordering, rejected connection, and invalid-account rejection: passed;
- storage preflight, insufficient-balance no-write path, post-hash storage failure volatile lock, and account/provider-bound recovery: passed;
- malformed pending metadata is retained and blocks writes, including the invalid startup-state reconnect path: passed;
- listener cleanup and focus wrapping: passed.

The local browser smoke was run against `http://127.0.0.1:8765/frontend/index.html?v=20260901-recovery4` on 2026-09-01. It verified disconnected reload state, disabled consequential writes before wallet/balance readiness, explicit wallet chooser, focus-visible outline on the focused close control, focus return to Connect wallet, no visible `EIP-6963` protocol label, and zero browser console errors. No wallet signature or Studio transaction was sent.

## Runtime conflict evidence

Official documentation was retrieved on 2026-08-31 at approximately 22:03 +07:00:

- [GenLayer Web Access](https://docs.genlayer.com/developers/intelligent-contracts/features/web-access) shows `Response.status_code` in its HTTP examples and says external responses must be reduced to stable consensus-safe fields.
- [GenLayer Node `gen_call`](https://docs.genlayer.com/api-references/genlayer-node/gen/gen_call) documents no-transaction deploy calls with `type: "deploy"`, a required zero-address `to`, and no contract-state validation for deploy requests.
- [GenLayerJS transaction methods](https://docs.genlayer.com/api-references/genlayer-js/transactions) documents `waitForTransactionReceipt` at `FINALIZED` and `getTransaction` as the source for status, execution result, and consensus details.
- [GenLayer networks](https://docs.genlayer.com/developers/networks) records Studionet RPC `https://studio.genlayer.com/api`, chain ID `61999`, and Explorer `explorer-studio.genlayer.com`.

Installed verification environment at 2026-08-31 22:03:19 +07:00: Python `3.13.6`, Node `v22.22.2`, `genvm-lint 0.11.0`, cached runner `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`.

Exact reproduction command for the documented-field conflict:

```powershell
$env:PYTHONIOENCODING='utf-8'
py -3.13 -m pytest -q .\runtime_status_probe.py -p no:cacheprovider
# exit code 1
# AttributeError: 'Response' object has no attribute 'status_code'
# probe_status_code_contract.py:14: return gl.nondet.web.get(url).status_code
```

The production contract now uses `_response_status`: it first reads documented `response.status_code`, falls back to cached-runner `response.status`, and returns `-1` for an invalid response shape. The helper regression test executes the function extracted from the exact contract source against documented, cached-runner, and invalid shapes; the Direct Mode suite also exercises the cached-runner `status` branch.

No-write Studionet schema probe, run 2026-09-01 (RPC `https://studio.genlayer.com/api`):

```powershell
$source = Get-Content .\contracts\school_closure_notice_arbiter.py -Raw -Encoding utf8
$bytes = [Text.Encoding]::UTF8.GetBytes($source)
$hex = '0x' + (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
$body = @{ jsonrpc = '2.0'; id = 1; method = 'gen_getContractSchemaForCode'; params = @($hex) } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri 'https://studio.genlayer.com/api' -Method Post -ContentType application/json -Body $body
```

Result: JSON-RPC success; schema contains exactly 6 methods (4 write, 2 view), with `create_case`, `freeze_case`, `assess`, `retry_unresolved`, `get_case`, and `get_case_state`. No contract address, transaction hash, signature, or chain write was produced.

Targeted Studio runtime control: `probe_status_code_contract.py` (with an explicit empty constructor required by the Studio runner) was uploaded to the signed-in Studio Run Debug workspace on 2026-09-01. The direct no-write schema call then passed for the isolated probe (`check(url: string) -> int`). The first Run Debug control reported “You need at least one validator before you can deploy or interact with a contract”; after cooldown and switching to the recorded account, the Validators page showed 20 validators, but the next Run Debug schema refresh hit `Rate limit exceeded: 30 requests per minute`. The hosted no-write `gen_call` deploy control, tested with both the isolated probe and a minimal constructor/view contract, returned `Contract 0x0000000000000000000000000000000000000000 not found`; it did not execute the method. Studio logs identify GenVM `v0.2.16-x86_64-linux-release`. No simulation, deploy, signature, or write was sent. The disputed field therefore remains unverified in hosted Studio and blocks PRE_DEPLOY.

After two 55-second cooldowns, the same signed-in Studio session was switched to the recorded account `0x34b92E6553eaCA11A00A9d86d75d8a7881779D78`; the Validators page then showed `Validators 20` at 2026-09-01 09:12 +07:00. The isolated no-write `gen_call` deploy was retried with the installed `genlayer_py` encoder and the exact probe source:

```powershell
$source = [Text.Encoding]::UTF8.GetBytes((Get-Content .\probe_status_code_contract.py -Raw -Encoding utf8))
$codeHex = '0x' + (($source | ForEach-Object { $_.ToString('x2') }) -join '')
$data = @'
from genlayer_py.abi import calldata
from genlayer_py.abi.transactions import serialize
from genlayer_py.contracts.utils import make_calldata_object
import sys
code = bytes.fromhex(sys.argv[1][2:])
print(serialize([code, calldata.encode(make_calldata_object(method=None, args=None, kwargs=None)), False]))
'@ | py -3.13 - $codeHex
$request = @{ jsonrpc = '2.0'; id = 31; method = 'gen_call'; params = @(@{ type = 'deploy'; data = $data.Trim(); from = '0x34b92E6553eaCA11A00A9d86d75d8a7881779D78'; to = '0x0000000000000000000000000000000000000000'; status = 'finalized' }) } | ConvertTo-Json -Depth 8 -Compress
Invoke-RestMethod -Uri 'https://studio.genlayer.com/api' -Method Post -ContentType 'application/json' -Body $request
# {"jsonrpc":"2.0","error":{"code":-32001,"message":"Contract 0x0000000000000000000000000000000000000000 not found","data":{"contract_address":"0x0000000000000000000000000000000000000000}},"id":31}
```

The payload is accepted far enough to return the hosted resource-not-found response, but the deploy probe method is not executed. Retrying the same no-write deploy payload with `leader_only=True` (request id `33`) returned the same `-32001` zero-address not-found response. This remains a hosted Studio control failure, not a runtime verdict for `status_code` versus `status`. The source-side compatibility correction removes the need to choose one field at build time, but it does not substitute for the required hosted execution evidence.

Cooldown recheck on 2026-09-01 at 09:44 +07:00: the signed-in Studio Validators page again showed `Validators 20` for the recorded account. Opening Run Debug and selecting the isolated probe still rendered `You need at least one validator before you can deploy or interact with a contract`, so no method form or execution control was available. A single additional official-shaped no-write `gen_call` deploy request with the optional `status` omitted (request id `51`) returned the exact same response:

```json
{"jsonrpc":"2.0","error":{"code":-32001,"message":"Contract 0x0000000000000000000000000000000000000000 not found","data":{"contract_address":"0x0000000000000000000000000000000000000000"}},"id":51}
```

This confirms the hosted route still rejects the zero-address no-write deploy before executing the probe method, even after the validator count recovers. No transaction hash or contract address was produced.

Route-shape control on 2026-09-01 at 09:45 +07:00: the same no-write deploy payload with `to` omitted (request id `61`) returned `{"jsonrpc":"2.0","error":{"code":-32603,"message":"'to'"},"id":61`, confirming that the hosted endpoint requires the documented `to` field and still does not expose an alternate deploy route. The official Node API documentation says deploy `gen_call` must use the zero address and that deploy bypasses contract-state validation; the observed `-32001` therefore remains a hosted implementation/routing failure before GenVM execution.

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

The cached Direct Mode runner is `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` and exposes `Response.status`; the current online web-access documentation uses `status_code` in its example. The production source now accepts either documented shape and fails closed when neither exists, while the dated Studio control remains blocked before probe-method execution. No live contract evidence is inferred from local green tests or the schema-only RPC call. PRE_DEPLOY remains blocked until the targeted hosted no-write probe executes or the governing runtime source/dependency is otherwise confirmed.
