import { createClient } from "https://esm.sh/genlayer-js@1.1.8?bundle";
import { studionet } from "https://esm.sh/genlayer-js@1.1.8/chains?bundle";
import { MIN_SPENDABLE_WEI, attachSessionListeners, connectWallet, focusTrap, readPending, reconcilePending, runTransaction } from "./logic.js";

const $ = (id) => document.getElementById(id);
const WALLET_SPECS = [
  { label: "MetaMask", rdns: ["io.metamask"], flags: ["isMetaMask"] },
  { label: "OKX Wallet", rdns: ["com.okex.wallet", "com.okx.wallet"], flags: ["isOkxWallet", "isOKExWallet"] },
  { label: "Rabby", rdns: ["io.rabby"], flags: ["isRabby"] },
];
const LEGACY_UUID = "legacy-supported-wallet";
const state = { providers: new Map(), providerUuids: new WeakMap(), provider: null, walletKey: null, address: null, client: null, balance: null, balanceReady: false, busy: false, pending: readPending(window.localStorage), listeners: [] };

function isProvider(value) { return Boolean(value && typeof value === "object" && typeof value.request === "function"); }

function walletSpec(info, provider) {
  if (!isProvider(provider)) return null;
  const name = String(info?.name || "").trim().toLowerCase();
  const rdns = String(info?.rdns || "").trim().toLowerCase();
  return WALLET_SPECS.find((spec) => spec.rdns.includes(rdns) || spec.label.toLowerCase() === name || (!info && spec.flags.some((flag) => provider[flag] === true))) || null;
}

function validAnnouncement(detail) {
  return Boolean(detail?.info?.uuid && detail.info.uuid.length && typeof detail.info.icon === "string" && detail.info.icon.startsWith("data:") && isProvider(detail.provider));
}

function supportedDetail(detail) {
  if (!validAnnouncement(detail)) return null;
  const spec = walletSpec(detail.info, detail.provider);
  return spec ? { ...detail, info: { ...detail.info, name: spec.label } } : null;
}

function acceptProvider(detail) {
  const provider = detail.provider;
  const previousUuid = state.providerUuids.get(provider);
  const previous = state.providers.get(detail.info.uuid);
  if (previousUuid && previousUuid !== detail.info.uuid) return;
  if (previous && previous.provider !== provider) return;
  state.providers.delete(LEGACY_UUID);
  state.providerUuids.set(provider, detail.info.uuid);
  state.providers.set(detail.info.uuid, detail);
  renderProviders();
}

function setActivity(message, error = false) {
  $("activity-text").textContent = message;
  $("activity").classList.toggle("error", error);
}

function setWalletError(message = "") {
  const target = $("wallet-error");
  target.textContent = message;
  target.hidden = !message;
}

function requireConnected() {
  if (!state.client || !state.address) throw new Error("Connect a wallet first.");
  const address = $("contract").value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("Enter a deployed contract address.");
  return address;
}

function setButtons() {
  const connected = Boolean(state.client && state.address);
  const writesBlocked = !connected || state.busy || Boolean(state.pending) || !state.balanceReady;
  for (const id of ["create", "freeze", "assess", "retry"]) $(id).disabled = writesBlocked;
  $("read").disabled = !connected || state.busy || Boolean(state.pending);
  $("resume").disabled = !connected || !state.pending;
}

function renderProviders() {
  const list = $("providers");
  list.replaceChildren();
  const providers = [...state.providers.values()].sort((a, b) => a.info.name.localeCompare(b.info.name));
  if (!providers.length) {
    list.textContent = "No supported wallet is available. Use MetaMask, OKX Wallet, or Rabby.";
    return;
  }
  for (const detail of providers) {
    const button = document.createElement("button");
    button.className = "provider";
    button.type = "button";
    const icon = document.createElement("img");
    icon.src = detail.info.icon;
    icon.alt = "";
    const name = document.createElement("span");
    name.textContent = detail.info.name;
    button.append(icon, name);
    button.addEventListener("click", () => connect(detail));
    list.append(button);
  }
}

async function switchToStudionet(provider) {
  const chainId = "0x" + studionet.id.toString(16);
  const current = await provider.request({ method: "eth_chainId" });
  if (current === chainId) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (error) {
    if (error?.code !== 4902) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [{
      chainId, chainName: studionet.name, rpcUrls: [...studionet.rpcUrls.default.http],
      nativeCurrency: studionet.nativeCurrency,
      blockExplorerUrls: studionet.blockExplorers ? [studionet.blockExplorers.default.url] : [],
    }] });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  }
}

async function connect(detail) {
  try {
    setWalletError("");
    const account = await connectWallet(detail.provider, switchToStudionet);
    disconnect("Switching wallet session…");
    state.provider = detail.provider;
    state.walletKey = String(detail.info.rdns || detail.info.uuid || detail.info.name || "").trim().toLowerCase();
    state.address = account;
    state.client = createClient({ chain: studionet, account: state.address, provider: state.provider });
    state.balance = null;
    state.balanceReady = false;
    $("wallet-status").textContent = detail.info.name + ": " + state.address.slice(0, 6) + "…" + state.address.slice(-4);
    setActivity("Connected to " + detail.info.name + " on Studionet.");
    const onAccountsChanged = () => disconnect("Account changed. Connect again.");
    const onChainChanged = () => disconnect("Network changed. Connect again.");
    const onDisconnect = () => disconnect("Wallet disconnected. Connect again.");
    const cleanup = attachSessionListeners(detail.provider, { accountsChanged: onAccountsChanged, chainChanged: onChainChanged, disconnect: onDisconnect });
    state.listeners = [[cleanup]];
    $("chooser").close();
    setButtons();
    await refreshBalance();
    if (state.pending) await reconcileSavedTransaction();
  } catch (error) { setWalletError(error.message || "The wallet could not connect."); }
}

function disconnect(message = "Disconnected after reload") {
  for (const [cleanup] of state.listeners) cleanup();
  state.listeners = [];
  state.provider = null; state.walletKey = null; state.address = null; state.client = null; state.balance = null; state.balanceReady = false;
  $("wallet-status").textContent = message; setActivity(message); setButtons();
}

async function refreshBalance() {
  state.balanceReady = false;
  setButtons();
  if (!state.client || !state.address) return false;
  try {
    state.balance = BigInt(await state.client.getBalance({ address: state.address }));
    if (state.balance < MIN_SPENDABLE_WEI) {
      setActivity("Insufficient spendable GEN for a safe transaction preflight.", true);
      return false;
    }
    state.balanceReady = true;
    return true;
  } catch {
    setActivity("Could not verify spendable GEN balance; writes remain disabled.", true);
    return false;
  } finally { setButtons(); }
}

async function ensureSpendableBalance() {
  if (!(await refreshBalance())) throw new Error("Insufficient or unverifiable spendable GEN balance; no transaction was submitted.");
}

async function validateWalletSession() {
  if (!state.provider || !state.address) throw new Error("Connect a wallet first.");
  const [accounts, chainId] = await Promise.all([
    state.provider.request({ method: "eth_accounts" }),
    state.provider.request({ method: "eth_chainId" }),
  ]);
  if (!Array.isArray(accounts) || String(accounts[0] || "").toLowerCase() !== state.address.toLowerCase()) {
    disconnect("Wallet account changed. Connect again.");
    throw new Error("Wallet account changed. Connect again.");
  }
  const expected = "0x" + studionet.id.toString(16);
  if (String(chainId).toLowerCase() !== expected.toLowerCase()) {
    disconnect("Wallet network changed. Connect again.");
    throw new Error("Wallet network changed. Connect again.");
  }
}

function renderReadback(result) {
  $("readback").classList.remove("empty");
  const pre = document.createElement("pre"); pre.textContent = JSON.stringify(result, null, 2);
  $("readback").replaceChildren(pre);
  return result;
}

async function readCase(addressOverride, caseIdOverride, validate = true) {
  const address = addressOverride || requireConnected();
  const caseId = caseIdOverride || $("case-id").value.trim();
  if (validate) await validateWalletSession();
  const result = await state.client.readContract({ address, functionName: "get_case", args: [caseId] });
  return renderReadback(result);
}

function showTransaction(hash) {
  $("tx-details").hidden = false;
  $("tx-hash").textContent = hash;
  $("explorer-link").href = "https://explorer-studio.genlayer.com/tx/" + hash;
  $("copy-tx").onclick = async () => { await navigator.clipboard.writeText(hash); setActivity("Transaction ID copied."); };
  $("resume").hidden = true;
}

function showPending(pending) {
  showTransaction(pending.hash);
  $("resume").hidden = false;
  const suffix = pending.volatile ? " Recovery storage failed; keep this tab open." : "";
  setActivity("Transaction " + pending.hash.slice(0, 10) + "… is pending reconciliation. Do not submit another transaction." + suffix, true);
  setButtons();
}

async function reconcileSavedTransaction() {
  if (!state.pending) return;
  showPending(state.pending);
  try {
    const recovered = await reconcilePending({ state, storage: window.localStorage, client: state.client, account: state.address, walletKey: state.walletKey, validateWalletSession, readback: (pending) => readCase(pending.contractAddress, pending.caseId, false) });
    showTransaction(recovered.hash);
    setActivity("Recovered transaction finalized and verified from the contract.");
    setButtons();
  } catch (error) {
    setActivity(error.message || "Pending transaction still needs reconciliation.", true);
    setButtons();
  }
}

async function transact(functionName, args) {
  if (state.busy || state.pending) return;
  const address = requireConnected();
  const pending = { contractAddress: address, account: state.address, walletKey: state.walletKey, caseId: $("case-id").value.trim(), schoolId: $("school-id").value.trim(), functionName, args };
  setActivity("Confirm the transaction in your wallet…");
  try {
    const completed = await runTransaction({ state, storage: window.localStorage, client: state.client, pending, validateWalletSession, preflight: ensureSpendableBalance, onPending: showPending, readback: (saved) => readCase(saved.contractAddress, saved.caseId, false) });
    showTransaction(completed.hash);
    setActivity("Transaction confirmed. Checking the saved case…");
    setActivity("Case updated and verified from the contract.");
  } catch (error) { setActivity(error.message || String(error), true); }
  setButtons();
}

const chooser = $("chooser");
const main = document.querySelector("main");
$("connect").addEventListener("click", () => { setWalletError(""); renderProviders(); main.inert = true; chooser.showModal(); setTimeout(() => $("providers").querySelector("button")?.focus() || $("chooser").querySelector(".close")?.focus(), 0); });
chooser.addEventListener("close", () => { main.inert = false; $("connect").focus(); });
chooser.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  const focusable = [...chooser.querySelectorAll("button:not([disabled])")];
  if (!focusable.length) return;
  const next = focusTrap(focusable, document.activeElement, event.shiftKey);
  if ((event.shiftKey && document.activeElement === focusable[0]) || (!event.shiftKey && document.activeElement === focusable.at(-1))) { event.preventDefault(); next.focus(); }
});
$("create").addEventListener("click", () => transact("create_case", [$("case-id").value.trim(), $("school-id").value.trim(), $("url-a").value.trim(), $("url-b").value.trim()]));
$("freeze").addEventListener("click", () => transact("freeze_case", [$("case-id").value.trim()]));
$("assess").addEventListener("click", () => transact("assess", [$("case-id").value.trim()]));
$("retry").addEventListener("click", () => transact("retry_unresolved", [$("case-id").value.trim()]));
$("read").addEventListener("click", async () => { try { await readCase(); setActivity("Authoritative readback completed."); } catch (error) { setActivity(error.message || String(error), true); } });
$("resume").addEventListener("click", reconcileSavedTransaction);

window.addEventListener("eip6963:announceProvider", (event) => {
  const detail = supportedDetail(event.detail);
  if (detail) acceptProvider(detail);
});
window.dispatchEvent(new Event("eip6963:requestProvider"));
queueMicrotask(() => {
  if (state.providers.size || !isProvider(window.ethereum)) return;
  const spec = walletSpec(null, window.ethereum);
  if (!spec) return;
  acceptProvider({ legacy: true, info: { uuid: LEGACY_UUID, name: spec.label, icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E", rdns: spec.rdns[0] }, provider: window.ethereum });
});
setButtons();
if (state.pending) showPending(state.pending);
