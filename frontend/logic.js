export const PENDING_STORAGE_KEY = "school-closure-notice-arbiter.pending-transaction";
export const FINAL_STATUS = "FINALIZED";
export const SUCCESSFUL_CONSENSUS = "MAJORITY_AGREE";
export const SUCCESSFUL_EXECUTION = "FINISHED_WITH_RETURN";
export const MIN_SPENDABLE_WEI = 10_000_000_000_000_000n;

const METHODS = new Set(["create_case", "freeze_case", "assess", "retry_unresolved"]);
const FINAL_STATUS_CODES = { 7: FINAL_STATUS };
const CONSENSUS_RESULT_NAMES = { 6: SUCCESSFUL_CONSENSUS };
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

export function isEvmAddress(value) { return typeof value === "string" && ADDRESS.test(value); }
export function isTransactionHash(value) { return typeof value === "string" && HASH.test(value); }

function validPending(pending) {
  return Boolean(
    pending && typeof pending === "object" &&
    isTransactionHash(pending.hash) && isEvmAddress(pending.contractAddress) &&
    isEvmAddress(pending.account) && typeof pending.walletKey === "string" && pending.walletKey &&
    typeof pending.caseId === "string" && pending.caseId && METHODS.has(pending.functionName) &&
    Array.isArray(pending.args),
  );
}

export function inspectPending(storage) {
  try {
    const raw = storage?.getItem(PENDING_STORAGE_KEY);
    if (!raw) return { status: "ABSENT", pending: null };
    const pending = JSON.parse(raw);
    return validPending(pending) ? { status: "VALID", pending } : { status: "INVALID", pending: null };
  } catch {
    return { status: "INVALID", pending: null };
  }
}

export function readPending(storage) {
  const inspected = inspectPending(storage);
  return inspected.status === "VALID" ? inspected.pending : null;
}

export function preflightStorage(storage) {
  const key = `${PENDING_STORAGE_KEY}.preflight`;
  try {
    storage.setItem(key, "ok");
    if (storage.getItem(key) !== "ok") throw new Error("storage readback failed");
    storage.removeItem(key);
  } catch {
    throw new Error("Local transaction recovery storage is unavailable; no transaction was submitted.");
  }
}

export function writePending(storage, pending) {
  if (!validPending(pending)) throw new Error("Refusing to persist an incomplete transaction record.");
  storage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pending));
  if (readPending(storage)?.hash !== pending.hash) throw new Error("Pending transaction persistence readback failed.");
}

export function clearPending(storage) { storage.removeItem(PENDING_STORAGE_KEY); }

export function transactionProof(receipt, transaction) {
  const statusValue = transaction?.statusName ?? transaction?.status_name ?? receipt?.statusName ?? receipt?.status_name ?? FINAL_STATUS_CODES[transaction?.status];
  const status = String(statusValue ?? "").toUpperCase();
  const consensusValue = transaction?.resultName ?? transaction?.result_name ?? transaction?.consensusResult ?? transaction?.consensus_result ?? CONSENSUS_RESULT_NAMES[transaction?.result];
  const consensus = String(consensusValue ?? "").toUpperCase();
  const leaderReceipt = transaction?.consensus_data?.leader_receipt?.find((entry) => entry?.result?.status === "return" || entry?.execution_result === "SUCCESS");
  const executionValue = transaction?.txExecutionResultName ?? transaction?.tx_execution_result_name ?? receipt?.txExecutionResultName ?? receipt?.tx_execution_result_name ?? (leaderReceipt?.result?.status === "return" ? SUCCESSFUL_EXECUTION : "");
  const execution = String(executionValue).toUpperCase();
  if (status !== FINAL_STATUS) throw new Error("Transaction is not finalized by the GenLayer network.");
  if (consensus !== SUCCESSFUL_CONSENSUS) throw new Error("Transaction did not reach MAJORITY_AGREE consensus.");
  if (execution !== SUCCESSFUL_EXECUTION) throw new Error("The finalized transaction did not complete successfully.");
  return { status, consensus, execution };
}

export function expectedState(functionName, state) {
  const allowed = {
    create_case: ["DRAFT"],
    freeze_case: ["FROZEN"],
    assess: ["RETRYABLE", "ASSESSED"],
    retry_unresolved: ["RETRYABLE", "ASSESSED"],
  }[functionName];
  return Boolean(allowed?.includes(String(state)));
}

export function assertReadback(result, pending) {
  if (!result || typeof result !== "object" || !expectedState(pending.functionName, result.state)) {
    throw new Error("Authoritative contract readback did not match the submitted method.");
  }
  if (pending.schoolId && result.school_id !== pending.schoolId) {
    throw new Error("Authoritative contract readback returned a different school.");
  }
  return result;
}

function assertSessionBinding(pending, account, walletKey) {
  if (!isEvmAddress(account) || account.toLowerCase() !== pending.account.toLowerCase() || walletKey !== pending.walletKey) {
    throw new Error("Pending transaction belongs to a different wallet session; reconnect the recorded account and provider.");
  }
}

export async function runTransaction({ state, storage, client, pending, validateWalletSession, preflight, readback, onPending }) {
  if (state.busy || state.pending) return { started: false };
  state.busy = true;
  try {
    preflightStorage(storage);
    await preflight?.();
    await validateWalletSession();
    const hash = await client.writeContract({ address: pending.contractAddress, functionName: pending.functionName, args: pending.args, value: BigInt(0) });
    if (!isTransactionHash(hash)) throw new Error("The wallet returned an invalid transaction hash.");
    const saved = { ...pending, hash, createdAt: new Date().toISOString() };
    try {
      writePending(storage, saved);
    } catch {
      state.pending = { ...saved, volatile: true };
      onPending?.(state.pending);
      throw new Error(`Transaction ${hash} was submitted, but recovery storage failed. Keep this tab open; the transaction remains locked.`);
    }
    state.pending = saved;
    onPending?.(saved);
    const receipt = await client.waitForTransactionReceipt({ hash, status: FINAL_STATUS, interval: 5000, retries: 10, fullTransaction: true });
    const transaction = await client.getTransaction({ hash });
    transactionProof(receipt, transaction);
    const result = await readback(saved);
    assertReadback(result, saved);
    clearPending(storage);
    state.pending = null;
    return { started: true, hash, result };
  } finally {
    if (!state.pending) state.busy = false;
  }
}

export async function reconcilePending({ state, storage, client, account, walletKey, validateWalletSession, readback }) {
  const inspected = inspectPending(storage);
  const pending = state.pending?.invalid ? null : state.pending || (inspected.status === "VALID" ? inspected.pending : null);
  if (!pending) {
    if (state.pending?.invalid || inspected.status === "INVALID") {
      state.pending = { invalid: true, status: "INVALID" };
      state.busy = true;
      throw new Error("Pending transaction recovery metadata is invalid; writes are locked until it is safely remediated.");
    }
    state.pending = null;
    state.busy = false;
    return null;
  }
  state.pending = pending;
  state.busy = true;
  try {
    assertSessionBinding(pending, account, walletKey);
    await validateWalletSession();
    const receipt = await client.waitForTransactionReceipt({ hash: pending.hash, status: FINAL_STATUS, interval: 5000, retries: 10, fullTransaction: true });
    const transaction = await client.getTransaction({ hash: pending.hash });
    transactionProof(receipt, transaction);
    const result = await readback(pending);
    assertReadback(result, pending);
    clearPending(storage);
    state.pending = null;
    return { hash: pending.hash, result };
  } finally {
    if (!state.pending) state.busy = false;
  }
}

export async function connectWallet(provider, switchNetwork) {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!isEvmAddress(accounts?.[0])) throw new Error("The wallet returned no valid EVM account.");
  await switchNetwork(provider);
  return accounts[0];
}

export function attachSessionListeners(provider, handlers) {
  const entries = [["accountsChanged", handlers.accountsChanged], ["chainChanged", handlers.chainChanged], ["disconnect", handlers.disconnect]];
  entries.forEach(([event, handler]) => provider.on?.(event, handler));
  return () => entries.forEach(([event, handler]) => provider.removeListener?.(event, handler));
}

export function focusTrap(elements, active, backwards = false) {
  if (!elements.length) return active;
  const index = elements.indexOf(active);
  if (index < 0) return elements[0];
  return elements[(index + (backwards ? -1 : 1) + elements.length) % elements.length];
}
