import assert from "node:assert/strict";
import test from "node:test";
import {
  PENDING_STORAGE_KEY,
  attachSessionListeners,
  connectWallet,
  focusTrap,
  inspectPending,
  MIN_SPENDABLE_WEI,
  readPending,
  reconcilePending,
  runTransaction,
  transactionProof,
} from "./logic.js";

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function transactionClient({ readbackState = "DRAFT" } = {}) {
  const calls = [];
  return {
    calls,
    async writeContract(args) { calls.push(["write", args]); return "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; },
    async waitForTransactionReceipt(args) { calls.push(["wait", args]); return { txExecutionResultName: "FINISHED_WITH_RETURN" }; },
    async getTransaction(args) { calls.push(["get", args]); return { statusName: "FINALIZED", resultName: "MAJORITY_AGREE", txExecutionResultName: "FINISHED_WITH_RETURN" }; },
    async readContract() { calls.push(["read"]); return { school_id: "school-1", state: readbackState }; },
  };
}

test("single-flight lock is set before validation awaits", async () => {
  const store = storage();
  const client = transactionClient();
  let release;
  const validation = new Promise((resolve) => { release = resolve; });
  const state = { busy: false, pending: null };
  const pending = { contractAddress: "0x1111111111111111111111111111111111111111", account: "0x2222222222222222222222222222222222222222", walletKey: "io.metamask", caseId: "case-1", schoolId: "school-1", functionName: "create_case", args: [] };
  const first = runTransaction({ state, storage: store, client, pending, validateWalletSession: () => validation, readback: async () => ({ school_id: "school-1", state: "DRAFT" }) });
  assert.equal(state.busy, true);
  const second = await runTransaction({ state, storage: store, client, pending, validateWalletSession: async () => {}, readback: async () => ({ school_id: "school-1", state: "DRAFT" }) });
  assert.deepEqual(second, { started: false });
  assert.equal(client.calls.filter(([name]) => name === "write").length, 0);
  release();
  await first;
  assert.equal(client.calls.filter(([name]) => name === "write").length, 1);
  assert.equal(readPending(store), null);
});

test("pending hash survives readback failure and reconciles after restart", async () => {
  const store = storage();
  const client = transactionClient();
  const pending = { contractAddress: "0x1111111111111111111111111111111111111111", account: "0x2222222222222222222222222222222222222222", walletKey: "io.metamask", caseId: "case-1", schoolId: "school-1", functionName: "create_case", args: [] };
  const state = { busy: false, pending: null };
  await assert.rejects(
    runTransaction({ state, storage: store, client, pending, validateWalletSession: async () => {}, readback: async () => { throw new Error("temporary readback failure"); } }),
    /temporary readback failure/
  );
  assert.equal(state.busy, true);
  assert.equal(readPending(store).hash, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  const restarted = { busy: true, pending: null };
  const recovered = await reconcilePending({ state: restarted, storage: store, client, account: pending.account, walletKey: pending.walletKey, validateWalletSession: async () => {}, readback: async () => ({ school_id: "school-1", state: "DRAFT" }) });
  assert.equal(recovered.hash, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(restarted.busy, false);
  assert.equal(readPending(store), null);
});

test("consensus, finality, and execution are all required", () => {
  assert.deepEqual(transactionProof({}, { statusName: "FINALIZED", resultName: "MAJORITY_AGREE", txExecutionResultName: "FINISHED_WITH_RETURN" }), {
    status: "FINALIZED", consensus: "MAJORITY_AGREE", execution: "FINISHED_WITH_RETURN",
  });
  assert.throws(() => transactionProof({}, { statusName: "FINALIZED", resultName: "MAJORITY_DISAGREE", txExecutionResultName: "FINISHED_WITH_RETURN" }), /MAJORITY_AGREE/);
  assert.throws(() => transactionProof({}, { statusName: "FINALIZED", resultName: "AGREE", txExecutionResultName: "FINISHED_WITH_RETURN" }), /MAJORITY_AGREE/);
  assert.throws(() => transactionProof({}, { statusName: "FINALIZED", resultName: "SUCCESS", txExecutionResultName: "FINISHED_WITH_RETURN" }), /MAJORITY_AGREE/);
  assert.throws(() => transactionProof({}, { statusName: "ACCEPTED", resultName: "MAJORITY_AGREE", txExecutionResultName: "FINISHED_WITH_RETURN" }), /not finalized/);
  assert.throws(() => transactionProof({}, { statusName: "FINALIZED", resultName: "MAJORITY_AGREE", txExecutionResultName: "FINISHED_WITH_ERROR" }), /did not complete/);
});

test("selected provider is used only after account approval and chain switching", async () => {
  const calls = [];
  const provider = { request: async ({ method }) => { calls.push(method); return method === "eth_requestAccounts" ? ["0x3333333333333333333333333333333333333333"] : undefined; } };
  const account = await connectWallet(provider, async (selected) => { assert.equal(selected, provider); calls.push("switch"); });
  assert.equal(account, "0x3333333333333333333333333333333333333333");
  assert.deepEqual(calls, ["eth_requestAccounts", "switch"]);
  await assert.rejects(connectWallet({ request: async () => { throw new Error("rejected"); } }, async () => { throw new Error("must not switch"); }), /rejected/);
  await assert.rejects(connectWallet({ request: async () => ["0xabc"] }, async () => { throw new Error("must not switch"); }), /valid EVM account/);
});

test("storage and balance preflight block writes, and storage failure keeps the submitted hash locked", async () => {
  const pending = { contractAddress: "0x1111111111111111111111111111111111111111", account: "0x2222222222222222222222222222222222222222", walletKey: "io.metamask", caseId: "case-1", functionName: "create_case", args: [] };
  const lowBalance = storage();
  const blocked = { busy: false, pending: null };
  let writes = 0;
  await assert.rejects(runTransaction({ state: blocked, storage: lowBalance, client: { writeContract: async () => { writes++; } }, preflight: async () => { throw new Error("insufficient balance"); }, validateWalletSession: async () => {}, readback: async () => ({ state: "DRAFT" }) }), /insufficient balance/);
  assert.equal(writes, 0);
  assert.equal(blocked.busy, false);
  assert.equal(MIN_SPENDABLE_WEI, 10000000000000000n);

  const failingStorage = { setItem(key, value) { if (key === PENDING_STORAGE_KEY) throw new Error("quota"); this.value = value; }, getItem(key) { return key === `${PENDING_STORAGE_KEY}.preflight` ? "ok" : null; }, removeItem() {} };
  const locked = { busy: false, pending: null };
  await assert.rejects(runTransaction({ state: locked, storage: failingStorage, client: transactionClient(), pending, validateWalletSession: async () => {}, readback: async () => ({ state: "DRAFT" }), onPending: () => {} }), /submitted, but recovery storage failed/);
  assert.equal(locked.pending.volatile, true);
  assert.equal(locked.busy, true);
});

test("pending recovery requires the same account and provider", async () => {
  const store = storage();
  const pending = { hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", contractAddress: "0x1111111111111111111111111111111111111111", account: "0x2222222222222222222222222222222222222222", walletKey: "io.metamask", caseId: "case-1", functionName: "create_case", args: [] };
  store.setItem(PENDING_STORAGE_KEY, JSON.stringify(pending));
  const state = { busy: false, pending: null };
  let waited = false;
  await assert.rejects(reconcilePending({ state, storage: store, client: { waitForTransactionReceipt: async () => { waited = true; } }, account: "0x3333333333333333333333333333333333333333", walletKey: "io.metamask", validateWalletSession: async () => {}, readback: async () => ({ state: "DRAFT" }) }), /different wallet session/);
  assert.equal(waited, false);
  assert.equal(state.busy, true);
});

test("malformed pending storage is invalid, retained, and fail-closed", async () => {
  const store = storage();
  store.setItem(PENDING_STORAGE_KEY, "{malformed");
  assert.deepEqual(inspectPending(store), { status: "INVALID", pending: null });
  const state = { busy: false, pending: null };
  await assert.rejects(reconcilePending({ state, storage: store, client: {}, account: "0x3333333333333333333333333333333333333333", walletKey: "io.metamask", validateWalletSession: async () => {}, readback: async () => ({ state: "DRAFT" }) }), /invalid; writes are locked/);
  assert.equal(state.busy, true);
  assert.equal(store.getItem(PENDING_STORAGE_KEY), "{malformed");
  const blocked = await runTransaction({ state, storage: store, client: { writeContract: async () => { throw new Error("must not write"); } }, pending: {}, validateWalletSession: async () => {}, readback: async () => ({ state: "DRAFT" }) });
  assert.deepEqual(blocked, { started: false });
});

test("session listeners clean up and focus trap wraps both directions", () => {
  const attached = [];
  const removed = [];
  const provider = {
    on: (event, handler) => attached.push([event, handler]),
    removeListener: (event, handler) => removed.push([event, handler]),
  };
  const handlers = { accountsChanged() {}, chainChanged() {}, disconnect() {} };
  const cleanup = attachSessionListeners(provider, handlers);
  cleanup();
  assert.deepEqual(attached.map(([event]) => event), ["accountsChanged", "chainChanged", "disconnect"]);
  assert.equal(removed.length, 3);
  const elements = ["first", "last"];
  assert.equal(focusTrap(elements, "last"), "first");
  assert.equal(focusTrap(elements, "first", true), "last");
  assert.equal(PENDING_STORAGE_KEY, "school-closure-notice-arbiter.pending-transaction");
});
