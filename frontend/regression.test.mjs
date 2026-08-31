import assert from "node:assert/strict";
import test from "node:test";
import {
  PENDING_STORAGE_KEY,
  attachSessionListeners,
  connectWallet,
  focusTrap,
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
    async writeContract(args) { calls.push(["write", args]); return "0xabc"; },
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
  const pending = { contractAddress: "0x1111111111111111111111111111111111111111", caseId: "case-1", schoolId: "school-1", functionName: "create_case", args: [] };
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
  const pending = { contractAddress: "0x1111111111111111111111111111111111111111", caseId: "case-1", schoolId: "school-1", functionName: "create_case", args: [] };
  const state = { busy: false, pending: null };
  await assert.rejects(
    runTransaction({ state, storage: store, client, pending, validateWalletSession: async () => {}, readback: async () => { throw new Error("temporary readback failure"); } }),
    /temporary readback failure/
  );
  assert.equal(state.busy, true);
  assert.equal(readPending(store).hash, "0xabc");
  const restarted = { busy: true, pending: null };
  const recovered = await reconcilePending({ state: restarted, storage: store, client, validateWalletSession: async () => {}, readback: async () => ({ school_id: "school-1", state: "DRAFT" }) });
  assert.equal(recovered.hash, "0xabc");
  assert.equal(restarted.busy, false);
  assert.equal(readPending(store), null);
});

test("consensus, finality, and execution are all required", () => {
  assert.deepEqual(transactionProof({}, { statusName: "FINALIZED", resultName: "MAJORITY_AGREE", txExecutionResultName: "FINISHED_WITH_RETURN" }), {
    status: "FINALIZED", consensus: "MAJORITY_AGREE", execution: "FINISHED_WITH_RETURN",
  });
  assert.throws(() => transactionProof({}, { statusName: "FINALIZED", resultName: "MAJORITY_DISAGREE", txExecutionResultName: "FINISHED_WITH_RETURN" }), /accepted consensus/);
  assert.throws(() => transactionProof({}, { statusName: "ACCEPTED", resultName: "MAJORITY_AGREE", txExecutionResultName: "FINISHED_WITH_RETURN" }), /not finalized/);
  assert.throws(() => transactionProof({}, { statusName: "FINALIZED", resultName: "MAJORITY_AGREE", txExecutionResultName: "FINISHED_WITH_ERROR" }), /did not complete/);
});

test("selected provider is used only after account approval and chain switching", async () => {
  const calls = [];
  const provider = { request: async ({ method }) => { calls.push(method); return method === "eth_requestAccounts" ? ["0xabc"] : undefined; } };
  const account = await connectWallet(provider, async (selected) => { assert.equal(selected, provider); calls.push("switch"); });
  assert.equal(account, "0xabc");
  assert.deepEqual(calls, ["eth_requestAccounts", "switch"]);
  await assert.rejects(connectWallet({ request: async () => { throw new Error("rejected"); } }, async () => { throw new Error("must not switch"); }), /rejected/);
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
