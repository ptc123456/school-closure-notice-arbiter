# Frontend

This is a dependency-free static browser surface. It loads the pinned GenLayerJS `1.1.8` ESM build at runtime, so no local npm package was installed without approval.

It implements:

- EIP-6963 provider discovery and explicit chooser selection;
- selected-provider-only account, chain-switch, signing, and event handling;
- disconnected initial state after reload;
- Studionet chain setup;
- `FINALIZED` receipt polling, explicit consensus/execution proof, and contract readback;
- a synchronous single-flight transaction guard;
- one restart-safe pending hash with reconciliation before another write is enabled.

The transaction coordinator never clears its pending record after a receipt alone. It requires final status, an accepted consensus result, `FINISHED_WITH_RETURN`, and a method-specific `get_case` readback. A reload or readback failure keeps the same hash visible and blocks duplicate submission.

Enter the deployed contract address after PRE_DEPLOY and deployment. The static page has not been presented as live evidence; browser/E2E verification is a later checkpoint.
