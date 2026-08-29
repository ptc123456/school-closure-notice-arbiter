# School Closure Notice Arbiter

GenLayer Intelligent Contract that compares two independently published school-closure notices.

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

The browser frontend is not included yet because the project has no approved local JavaScript dependency installation. The frontend must use GenLayerJS and implement EIP-6963 wallet selection, exact provider routing, transaction finality/execution checks, and authoritative readback before any deployment gate.

