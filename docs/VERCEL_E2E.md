# Vercel E2E Evidence

Status: critical journey completed on the public production alias; final anonymous `POST_GITHUB_VERCEL_FINAL` review remains the next gate.

## Exact scope

- Live app: https://school-closure-notice-arbiter.vercel.app/
- GitHub: https://github.com/ptc123456/school-closure-notice-arbiter
- Vercel target: `shingg/school-closure-notice-arbiter`
- Network: Studionet
- Contract: `0x03E832036EDBCF96AEa03D64AB41Bc79d63b9A6f`
- Contract source SHA-256: `BA62C92CACD85386D2356CAE88760FED167CC6075F563BEE099B3676DCE22B39`
- Browser wallet: separate OKX Wallet account `0x896Ef52d620eA3CCdA34B4E72a8E197974e4e39E`
- Functional Vercel release commit: `a4505b9d266b37a305bbaf8c47c9990bd314a827`
- Vercel deployment used for the completed journey: `dpl_55Cz78AE8LEDWXSB5wJHHM5wLmgm`
- Exact deployment URL: https://school-closure-notice-arbiter-mvlo61nty-shingg.vercel.app/
- Public evidence package revision reviewed before this documentation correction: `1c4e86126abb132fd779537e3b5233f484848480`
- Refreshed final GitHub HEAD for this correction package: `8717262dd5488531513aea0503672d2b22101a27`

## Judge-facing smoke

- Production root returned `200 OK` and rendered `School Closure Notice Arbiter`.
- Wallet control rendered in the upper-right corner.
- Fresh load began disconnected and used clear public language.
- Wallet chooser opened only after explicit selection; no internal provider, RPC, chain-ID, or debug copy was visible.
- OKX Wallet selection connected to Studionet and enabled the workflow.
- Reload preserved and reconciled a pending transaction hash without resubmission.

## Critical journey

Case: `vercel-e2e-unresolved-20260901-01`  
School ID: `VERCEL-E2E-SCHOOL`  
Source A: `https://example.com/vercel-e2e-missing-a-20260901`  
Source B: `https://example.com/vercel-e2e-missing-b-20260901`

| Step | Transaction | Terminal proof | Authoritative result |
| --- | --- | --- | --- |
| `create_case` | `0xb947e25d30facc5ad29cc70c1f403f16a34c8ab4249e6f6034ecd83384ffd320` | `FINALIZED / MAJORITY_AGREE / SUCCESS` | `DRAFT`, retry `0` |
| `freeze_case` | `0x4e5aa5a198dd88eac43f40c0d497d746f52c778276153b5615e9396637a3cd33` | `FINALIZED / MAJORITY_AGREE / SUCCESS` | `FROZEN` |
| `assess` | `0xed0adaef89b166a1d16bc441170e95fc51439802c34112e18f3c9afe23c473c3` | `FINALIZED / MAJORITY_AGREE / SUCCESS` | `RETRYABLE / UNRESOLVED`, both sources `MISSING` |
| `retry_unresolved` | `0xecec7a7d9f4ef1d15124d28a521f724bdf04b8a9cfb4cd83481eba722d99978c` | `FINALIZED / MAJORITY_AGREE / SUCCESS` | `RETRYABLE / UNRESOLVED`, retry `1` |

Final independent readback:

- `get_case`: `state=RETRYABLE`, `outcome=UNRESOLVED`, `retry_count=1`, digest `6e8982d3c10fb7075b2e3db8e5e79484d0086f18adc76b48b17d79a6e5cfa328`.
- `get_case_state`: `RETRYABLE`.
- Source URLs, school ID, owner, and digest agreed between the UI and the independent RPC read.

## Failure and repair ledger

The first Vercel `freeze_case` observation exposed a frontend compatibility defect: GenLayerJS returned numeric `status=7` and `result=6`, with the successful leader return nested in `consensus_data.leader_receipt`. The coordinator required only named fields and reported a false verification failure before readback. The repair added bounded current-SDK field normalization, regression coverage, and a versioned module import to avoid stale browser code. The same original hash was then reconciled successfully after reload; no replacement transaction was submitted.

Automated checks after the repair: frontend regression `9 passed`, JavaScript syntax checks passed, `git diff --check` passed, and the project governance audit passed.

The exact reproducible contract suite for the final source is `26 passed` (`py -3.13 -m pytest -q -p no:cacheprovider`).
