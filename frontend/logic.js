export const PENDING_STORAGE_KEY = "school-closure-notice-arbiter.pending-transaction";
export const FINAL_STATUS = "FINALIZED";
export const SUCCESSFUL_CONSENSUS = new Set(["AGREE", "MAJORITY_AGREE", "SUCCESS", "ACCEPTED"]);
export const SUCCESSFUL_EXECUTION = "FINISHED_WITH_RETURN";

export function readPending(storage) {
  try {
    const raw = storage?.getItem(PENDING_STORAGE_KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw);
    if (!pending || typeof pending !== "object" || typeof pending.hash !== "string" || !pending.hash) return null;
    if (typeof pending.contractAddress !== "string" || typeof pending.caseId !== "string" || typeof pending.functionName !== "string") return null;
    return pending;
  } catch {
    return null;
  }
}

export function writePending(storage, pending) {
  storage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pending));
}

export function clearPending(storage) {
  storage.removeItem(PENDING_STORAGE_KEY);
}

export function transactionProof(receipt, transaction) {
  const status = String(transaction?.statusName ?? transaction?.status_name ?? receipt?.statusName ?? receipt?.status_name ?? "").toUpperCase();
  const consensus = String(transaction?.resultName ?? transaction?.result_name ?? transaction?.consensusResult ?? transaction?.consensus_result ?? "").toUpperCase();
  const execution = String(transaction?.txExecutionResultName ?? transaction?.tx_execution_result_name ?? receipt?.txExecutionResultName ?? receipt?.tx_execution_result_name ?? "").toUpperCase();
  if (status !== FINAL_STATUS) throw new Error("Transaction is not finalized by the GenLayer network.");
  if (!SUCCESSFUL_CONSENSUS.has(consensus)) throw new Error("Transaction did not reach an accepted consensus result.");
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

export async function runTransaction({ state, storage, client, pending, validateWalletSession, readback, onPending }) {
  if (state.busy || state.pending) return { started: false };
  state.busy = true;
  try {
    await validateWalletSession();
    const hash = await client.writeContract({ address: pending.contractAddress, functionName: pending.functionName, args: pending.args, value: BigInt(0) });
    const saved = { ...pending, hash, createdAt: new Date().toISOString() };
    writePending(storage, saved);
    state.pending = saved;
    onPending?.(saved);
    const receipt = await client.waitForTransactionReceipt({ hash, status: "FINALIZED", interval: 5000, retries: 10, fullTransaction: true });
    const transaction = await client.getTransaction({ hash });
    transactionProof(receipt, transaction);
    const result = await readback(saved);
    assertReadback(result, saved);
    clearPending(storage);
    state.pending = null;
    return { started: true, hash, result };
  } catch (error) {
    throw error;
  } finally {
    if (!state.pending) state.busy = false;
  }
}

export async function reconcilePending({ state, storage, client, validateWalletSession, readback }) {
  const pending = readPending(storage);
  if (!pending) {
    state.pending = null;
    state.busy = false;
    return null;
  }
  state.pending = pending;
  state.busy = true;
  try {
    await validateWalletSession();
    const receipt = await client.waitForTransactionReceipt({ hash: pending.hash, status: "FINALIZED", interval: 5000, retries: 10, fullTransaction: true });
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
  if (!accounts?.[0]) throw new Error("The wallet returned no account.");
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


