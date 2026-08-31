import { createClient } from "https://esm.sh/genlayer-js@1.1.8?bundle";
import { studionet } from "https://esm.sh/genlayer-js@1.1.8/chains?bundle";
import { ExecutionResult, TransactionStatus } from "https://esm.sh/genlayer-js@1.1.8/types?bundle";

const $ = (id) => document.getElementById(id);
const WALLET_SPECS = [
  { label: "MetaMask", rdns: ["io.metamask"], flags: ["isMetaMask"] },
  { label: "OKX Wallet", rdns: ["com.okex.wallet", "com.okx.wallet"], flags: ["isOkxWallet", "isOKExWallet"] },
  { label: "Rabby", rdns: ["io.rabby"], flags: ["isRabby"] },
];
const LEGACY_UUID = "legacy-supported-wallet";
const state = { providers: new Map(), providerUuids: new WeakMap(), provider: null, address: null, client: null, busy: false, listeners: [] };

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
  for (const id of ["create", "freeze", "assess", "retry", "read"]) $(id).disabled = !connected || state.busy;
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
    const accounts = await detail.provider.request({ method: "eth_requestAccounts" });
    if (!accounts?.[0]) throw new Error("The wallet returned no account.");
    await switchToStudionet(detail.provider);
    disconnect("Switching wallet session…");
    state.provider = detail.provider;
    state.address = accounts[0];
    state.client = createClient({ chain: studionet, account: state.address, provider: state.provider });
    $("wallet-status").textContent = detail.info.name + ": " + state.address.slice(0, 6) + "…" + state.address.slice(-4);
    setActivity("Connected to " + detail.info.name + " on Studionet.");
    const onAccountsChanged = () => disconnect("Account changed. Connect again.");
    const onChainChanged = () => disconnect("Network changed. Connect again.");
    const onDisconnect = () => disconnect("Wallet disconnected. Connect again.");
    detail.provider.on?.("accountsChanged", onAccountsChanged);
    detail.provider.on?.("chainChanged", onChainChanged);
    detail.provider.on?.("disconnect", onDisconnect);
    state.listeners = [[detail.provider, "accountsChanged", onAccountsChanged], [detail.provider, "chainChanged", onChainChanged], [detail.provider, "disconnect", onDisconnect]];
    $("chooser").close();
  } catch (error) { setWalletError(error.message || "The wallet could not connect."); }
}

function disconnect(message = "Disconnected after reload") {
  for (const [provider, event, handler] of state.listeners) provider.removeListener?.(event, handler);
  state.listeners = [];
  state.provider = null; state.address = null; state.client = null;
  $("wallet-status").textContent = message; setActivity(message); setButtons();
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

async function readCase() {
  const address = requireConnected();
  await validateWalletSession();
  const result = await state.client.readContract({ address, functionName: "get_case", args: [$("case-id").value.trim()] });
  $("readback").classList.remove("empty");
  const pre = document.createElement("pre"); pre.textContent = JSON.stringify(result, null, 2);
  $("readback").replaceChildren(pre);
  return result;
}

function showTransaction(hash) {
  $("tx-details").hidden = false;
  $("tx-hash").textContent = hash;
  $("explorer-link").href = "https://explorer-studio.genlayer.com/tx/" + hash;
  $("copy-tx").onclick = async () => { await navigator.clipboard.writeText(hash); setActivity("Transaction ID copied."); };
}

async function transact(functionName, args) {
  const address = requireConnected();
  if (state.busy) return;
  await validateWalletSession();
  state.busy = true; setButtons();
  try {
    setActivity("Confirm the transaction in your wallet…");
    const hash = await state.client.writeContract({ address, functionName, args, value: BigInt(0) });
    setActivity("Transaction submitted. Waiting for network confirmation…");
    const receipt = await state.client.waitForTransactionReceipt({ hash, status: TransactionStatus.FINALIZED, interval: 5000, retries: 10 });
    showTransaction(hash);
    if (receipt.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) throw new Error("The transaction was confirmed but the contract did not complete successfully.");
    setActivity("Transaction confirmed. Checking the saved case…");
    await readCase();
    setActivity("Case updated and verified from the contract.");
  } catch (error) { setActivity(error.message || String(error), true); }
  finally { state.busy = false; setButtons(); }
}

const chooser = $("chooser");
const main = document.querySelector("main");
$("connect").addEventListener("click", () => { setWalletError(""); renderProviders(); main.inert = true; chooser.showModal(); setTimeout(() => $("providers").querySelector("button")?.focus() || $("chooser").querySelector(".close")?.focus(), 0); });
chooser.addEventListener("close", () => { main.inert = false; $("connect").focus(); });
chooser.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  const focusable = [...chooser.querySelectorAll("button:not([disabled])")];
  if (!focusable.length) return;
  const first = focusable[0]; const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
$("create").addEventListener("click", () => transact("create_case", [$("case-id").value.trim(), $("school-id").value.trim(), $("url-a").value.trim(), $("url-b").value.trim()]));
$("freeze").addEventListener("click", () => transact("freeze_case", [$("case-id").value.trim()]));
$("assess").addEventListener("click", () => transact("assess", [$("case-id").value.trim()]));
$("retry").addEventListener("click", () => transact("retry_unresolved", [$("case-id").value.trim()]));
$("read").addEventListener("click", async () => { try { await readCase(); setActivity("Authoritative readback completed."); } catch (error) { setActivity(error.message || String(error), true); } });

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
