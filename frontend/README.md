# Frontend

This is a dependency-free static browser surface. It loads the pinned GenLayerJS `1.1.8` ESM build at runtime, so no local npm package was installed without approval.

It implements:

- EIP-6963 provider discovery and explicit chooser selection;
- selected-provider-only account, chain-switch, signing, and event handling;
- disconnected initial state after reload;
- Studionet chain setup;
- `FINALIZED` receipt polling, semantic execution-success checking, and contract readback;
- a single in-flight transaction guard.

Enter the deployed contract address after PRE_DEPLOY and deployment. The static page has not been presented as live evidence; browser/E2E verification is a later checkpoint.

