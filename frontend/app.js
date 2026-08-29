import { createClient } from "https://esm.sh/genlayer-js@1.1.8?bundle";
import { studionet } from "https://esm.sh/genlayer-js@1.1.8/chains?bundle";
import { ExecutionResult, TransactionStatus } from "https://esm.sh/genlayer-js@1.1.8/types?bundle";

const $ = (id) => document.getElementById(id);
const state = { providers: new Map(), provider: null, address: null, client: null, busy: false, listeners: [] };

function setActivity(message, error = false) {
  $("activity-text").textContent = message;
  $("activity").classList.toggle("error", error);
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
    list.textContent = "No EIP-6963 wallet announced itself in this browser.";
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
  const chainId = `0x${studionet.id.toString(16)}`;
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
    $("chooser").close();
    await switchToStudionet(detail.provider);
    const accounts = await detail.provider.request({ method: "eth_requestAccounts" });
    if (!accounts?.[0]) throw new Error("The wallet returned no account.");
    state.provider = detail.provider;
    state.address = accounts[0];
    state.client = createClient({ chain: studionet, account: state.address, provider: state.provider });
    $("wallet-status").textContent = `${detail.info.name}: ${state.address.slice(0, 6)}…${state.address.slice(-4)}`;
    setActivity(`Connected to ${detail.info.name} on Studionet.`);
    setButtons();
    const onAccountsChanged = () => disconnect("Account changed. Connect again.");
    const onChainChanged = () => disconnect("Network changed. Connect again.");
    detail.provider.on?.("accountsChanged", onAccountsChanged);
    detail.provider.on?.("chainChanged", onChainChanged);
    state.listeners = [[detail.provider, "accountsChanged", onAccountsChanged], [detail.provider, "chainChanged", onChainChanged]];
  } catch (error) { setActivity(error.message || String(error), true); }
}

function disconnect(message = "Disconnected after reload") {
  for (const [provider, event, handler] of state.listeners) provider.removeListener?.(event, handler);
  state.listeners = [];
  state.provider = null; state.address = null; state.client = null;
  $("wallet-status").textContent = message; setActivity(message); setButtons();
}

async function readCase() {
  const address = requireConnected();
  const result = await state.client.readContract({ address, functionName: "get_case", args: [$("case-id").value.trim()] });
  $("readback").classList.remove("empty");
  const pre = document.createElement("pre"); pre.textContent = JSON.stringify(result, null, 2);
  $("readback").replaceChildren(pre);
  return result;
}

async function transact(functionName, args) {
  const address = requireConnected();
  if (state.busy) return;
  state.busy = true; setButtons();
  try {
    setActivity(`Signing ${functionName}…`);
    const hash = await state.client.writeContract({ address, functionName, args, value: BigInt(0) });
    setActivity(`Submitted ${hash}. Waiting for FINALIZED…`);
    const receipt = await state.client.waitForTransactionReceipt({ hash, status: TransactionStatus.FINALIZED, interval: 5000, retries: 10 });
    if (receipt.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) throw new Error(`Finalized transaction did not execute successfully: ${receipt.txExecutionResultName}`);
    setActivity(`${functionName} finalized with semantic execution success. Reading back…`);
    await readCase();
    setActivity(`${functionName} finalized and authoritative readback completed.`);
  } catch (error) { setActivity(error.message || String(error), true); }
  finally { state.busy = false; setButtons(); }
}

$("connect").addEventListener("click", () => { renderProviders(); $("chooser").showModal(); });
$("create").addEventListener("click", () => transact("create_case", [$("case-id").value.trim(), $("school-id").value.trim(), $("url-a").value.trim(), $("url-b").value.trim()]));
$("freeze").addEventListener("click", () => transact("freeze_case", [$("case-id").value.trim()]));
$("assess").addEventListener("click", () => transact("assess", [$("case-id").value.trim()]));
$("retry").addEventListener("click", () => transact("retry_unresolved", [$("case-id").value.trim()]));
$("read").addEventListener("click", async () => { try { await readCase(); setActivity("Authoritative readback completed."); } catch (error) { setActivity(error.message || String(error), true); } });

window.addEventListener("eip6963:announceProvider", (event) => {
  const detail = event.detail;
  if (detail?.info?.uuid && detail.provider) { state.providers.set(detail.info.uuid, detail); renderProviders(); }
});
window.dispatchEvent(new Event("eip6963:requestProvider"));
setButtons();
