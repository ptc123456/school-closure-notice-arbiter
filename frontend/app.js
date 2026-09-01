import { createClient } from "https://esm.sh/genlayer-js@1.1.8?bundle";
import { studionet } from "https://esm.sh/genlayer-js@1.1.8/chains?bundle";
import { MIN_SPENDABLE_WEI, attachSessionListeners, connectWallet, focusTrap, inspectPending, reconcilePending, runTransaction } from "./logic.js?v=edbec0a";

const $ = (id) => document.getElementById(id);
const WALLET_SPECS = [
  { label: "MetaMask", rdns: ["io.metamask"], flags: ["isMetaMask"] },
  { label: "OKX Wallet", rdns: ["com.okex.wallet", "com.okx.wallet"], flags: ["isOkxWallet", "isOKExWallet"] },
  { label: "Rabby", rdns: ["io.rabby"], flags: ["isRabby"] },
];
const LEGACY_UUID = "legacy-supported-wallet";
const storedPending = inspectPending(window.localStorage);
const state = {
  providers: new Map(),
  providerUuids: new WeakMap(),
  provider: null,
  walletKey: null,
  address: null,
  client: null,
  balance: null,
  balanceReady: false,
  busy: false,
  pending: storedPending.status === "VALID" ? storedPending.pending : storedPending.status === "INVALID" ? { invalid: true, status: "INVALID" } : null,
  listeners: [],
};

function isProvider(value) {
  return Boolean(value && typeof value === "object" && typeof value.request === "function");
}

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
  if (!state.client || !state.address) throw new Error("Connect a wallet to begin.");
  const address = $("contract").value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("Enter a valid contract address.");
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
    list.textContent = "No supported wallet is available. Choose MetaMask, OKX Wallet, or Rabby.";
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
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId,
        chainName: studionet.name,
        rpcUrls: [...studionet.rpcUrls.default.http],
        nativeCurrency: studionet.nativeCurrency,
        blockExplorerUrls: studionet.blockExplorers ? [studionet.blockExplorers.default.url] : [],
      }],
    });
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

    const shortAddr = state.address.slice(0, 6) + "…" + state.address.slice(-4);
    const connectBtn = $("connect");
    connectBtn.textContent = detail.info.name + " · " + shortAddr;
    connectBtn.classList.add("is-connected");
    connectBtn.setAttribute("aria-label", `Connected: ${detail.info.name} (${state.address}). Click to switch wallet.`);

    $("wallet-status").textContent = "Connected to Studionet";
    setActivity("Connected to " + detail.info.name + " on Studionet.");

    const onAccountsChanged = () => disconnect("Wallet account changed. Connect a wallet to continue.");
    const onChainChanged = () => disconnect("Your wallet is on the wrong network. Switch to Studionet to continue.");
    const onDisconnect = () => disconnect("Wallet disconnected. Connect a wallet to begin.");
    const cleanup = attachSessionListeners(detail.provider, { accountsChanged: onAccountsChanged, chainChanged: onChainChanged, disconnect: onDisconnect });
    state.listeners = [[cleanup]];

    $("chooser").close();
    setButtons();
    await refreshBalance();
    if (state.pending) await reconcileSavedTransaction();
  } catch (error) {
    console.error("Wallet connection error:", error);
    const msg = String(error?.message || "").toLowerCase();
    const code = error?.code;
    let userMsg = "The wallet could not connect.";
    if (code === 4001 || msg.includes("rejected") || msg.includes("cancelled") || msg.includes("denied")) {
      userMsg = "Connection was cancelled. Choose a wallet to try again.";
    } else if (msg.includes("wrong network") || msg.includes("chain")) {
      userMsg = "Your wallet is on the wrong network. Switch to Studionet to continue.";
    }
    setWalletError(userMsg);
  }
}

function disconnect(message = "Not connected · connect a wallet to begin") {
  for (const [cleanup] of state.listeners) cleanup();
  state.listeners = [];
  state.provider = null;
  state.walletKey = null;
  state.address = null;
  state.client = null;
  state.balance = null;
  state.balanceReady = false;

  const connectBtn = $("connect");
  connectBtn.textContent = "Connect wallet";
  connectBtn.classList.remove("is-connected");
  connectBtn.setAttribute("aria-label", "Connect wallet");

  $("wallet-status").textContent = message;
  setActivity(message);
  setButtons();
}

async function refreshBalance() {
  state.balanceReady = false;
  setButtons();
  if (!state.client || !state.address) return false;
  try {
    state.balance = BigInt(await state.client.getBalance({ address: state.address }));
    if (state.balance < MIN_SPENDABLE_WEI) {
      setActivity("Wallet balance is too low to submit transactions on Studionet.", true);
      return false;
    }
    state.balanceReady = true;
    return true;
  } catch {
    setActivity("Could not verify spendable balance. Transaction actions remain disabled.", true);
    return false;
  } finally {
    setButtons();
  }
}

async function ensureSpendableBalance() {
  if (!(await refreshBalance())) throw new Error("Wallet balance is too low or unverifiable. No transaction was submitted.");
}

async function validateWalletSession() {
  if (!state.provider || !state.address) throw new Error("Connect a wallet to continue.");
  const [accounts, chainId] = await Promise.all([
    state.provider.request({ method: "eth_accounts" }),
    state.provider.request({ method: "eth_chainId" }),
  ]);
  if (!Array.isArray(accounts) || String(accounts[0] || "").toLowerCase() !== state.address.toLowerCase()) {
    disconnect("Wallet account changed. Connect a wallet to continue.");
    throw new Error("Wallet account changed. Connect a wallet to continue.");
  }
  const expected = "0x" + studionet.id.toString(16);
  if (String(chainId).toLowerCase() !== expected.toLowerCase()) {
    disconnect("Your wallet is on the wrong network. Switch to Studionet to continue.");
    throw new Error("Your wallet is on the wrong network. Switch to Studionet to continue.");
  }
}

function renderReadback(result) {
  const target = $("readback");
  target.classList.remove("empty");

  if (!result || typeof result !== "object") {
    const fallback = document.createElement("p");
    fallback.className = "empty-state-desc";
    fallback.textContent = "No case record loaded.";
    target.replaceChildren(fallback);
    return result;
  }

  const container = document.createElement("div");
  container.className = "evidence-card";

  const header = document.createElement("div");
  header.className = "evidence-header";

  const caseIdSpan = document.createElement("span");
  caseIdSpan.className = "evidence-case-id";
  caseIdSpan.textContent = "Case: " + ($("case-id").value.trim() || result.school_id || "Active Record");

  const badges = document.createElement("div");
  badges.className = "evidence-badges";

  const stateMap = {
    DRAFT: "Draft",
    FROZEN: "Frozen",
    ASSESSED: "Assessed",
    RETRYABLE: "Retryable",
  };
  const rawState = String(result.state || "").toUpperCase();
  const stateLabel = stateMap[rawState] || "Status unavailable";
  const stateBadge = document.createElement("span");
  stateBadge.className = "badge badge--state-" + (stateMap[rawState] ? rawState.toLowerCase() : "unknown");
  stateBadge.textContent = stateLabel;
  badges.append(stateBadge);

  if (result.outcome !== undefined && result.outcome !== null && String(result.outcome).trim() !== "") {
    const outcomeMap = {
      MATCH: "Notices Agree (Match)",
      ONE_SOURCE_OLDER: "Superseded Notice Detected",
      CONFLICTING_DATES: "Conflicting Dates",
      INSUFFICIENT_NOTICE: "Incomplete Notice",
      UNRESOLVED: "Unresolved",
    };
    const outcomeClassMap = {
      MATCH: "match",
      ONE_SOURCE_OLDER: "older",
      CONFLICTING_DATES: "conflict",
      INSUFFICIENT_NOTICE: "insufficient",
      UNRESOLVED: "unresolved",
    };
    const rawOutcome = String(result.outcome).toUpperCase();
    const outcomeLabel = outcomeMap[rawOutcome] || "Review needed";
    const outcomeClass = outcomeClassMap[rawOutcome] || "unresolved";
    const outcomeBadge = document.createElement("span");
    outcomeBadge.className = "badge badge--outcome-" + outcomeClass;
    outcomeBadge.textContent = outcomeLabel;
    badges.append(outcomeBadge);
  }

  header.append(caseIdSpan, badges);
  container.append(header);

  const scheduleTitle = document.createElement("div");
  scheduleTitle.className = "evidence-section-title";
  scheduleTitle.textContent = "Reopening Schedule";
  container.append(scheduleTitle);

  const grid = document.createElement("div");
  grid.className = "evidence-grid";

  const closureBox = document.createElement("div");
  closureBox.className = "evidence-stat-box";
  const closureLabel = document.createElement("div");
  closureLabel.className = "evidence-stat-label";
  closureLabel.textContent = "Closure Date";
  const closureVal = document.createElement("div");
  closureVal.className = "evidence-stat-value";
  closureVal.textContent = result.closure_date || "Not provided";
  closureBox.append(closureLabel, closureVal);

  const reopenBox = document.createElement("div");
  reopenBox.className = "evidence-stat-box";
  const reopenLabel = document.createElement("div");
  reopenLabel.className = "evidence-stat-label";
  reopenLabel.textContent = "Expected Reopen Date";
  const reopenVal = document.createElement("div");
  reopenVal.className = "evidence-stat-value evidence-stat-value--accent";
  reopenVal.textContent = result.reopen_date || "Not provided";
  reopenBox.append(reopenLabel, reopenVal);

  const schoolBox = document.createElement("div");
  schoolBox.className = "evidence-stat-box";
  const schoolLabel = document.createElement("div");
  schoolLabel.className = "evidence-stat-label";
  schoolLabel.textContent = "District School ID";
  const schoolVal = document.createElement("div");
  schoolVal.className = "evidence-stat-value";
  schoolVal.textContent = result.school_id || "Not provided";
  schoolBox.append(schoolLabel, schoolVal);

  const retryBox = document.createElement("div");
  retryBox.className = "evidence-stat-box";
  const retryLabel = document.createElement("div");
  retryLabel.className = "evidence-stat-label";
  retryLabel.textContent = "Assessment Retries";
  const retryVal = document.createElement("div");
  retryVal.className = "evidence-stat-value";
  retryVal.textContent = String(result.retry_count ?? "0");
  retryBox.append(retryLabel, retryVal);

  grid.append(closureBox, reopenBox, schoolBox, retryBox);
  container.append(grid);

  const sourcesTitle = document.createElement("div");
  sourcesTitle.className = "evidence-section-title";
  sourcesTitle.textContent = "Notice Sources & Revisions";
  container.append(sourcesTitle);

  const sourcesList = document.createElement("div");
  sourcesList.className = "evidence-sources";

  const srcABox = document.createElement("div");
  srcABox.className = "source-item";
  const srcAHead = document.createElement("div");
  srcAHead.className = "source-item-header";
  const srcATag = document.createElement("span");
  srcATag.className = "source-tag";
  srcATag.textContent = "Source A";
  const srcARev = document.createElement("span");
  srcARev.className = "source-rev";
  srcARev.textContent = result.notice_revision_a ? "Revision: " + result.notice_revision_a : "Revision: Not recorded";
  srcAHead.append(srcATag, srcARev);
  const srcAUrl = document.createElement("div");
  srcAUrl.className = "source-url";
  srcAUrl.textContent = result.url_a || $("url-a").value.trim() || "Not provided";
  srcABox.append(srcAHead, srcAUrl);

  const srcBBox = document.createElement("div");
  srcBBox.className = "source-item";
  const srcBHead = document.createElement("div");
  srcBHead.className = "source-item-header";
  const srcBTag = document.createElement("span");
  srcBTag.className = "source-tag";
  srcBTag.textContent = "Source B";
  const srcBRev = document.createElement("span");
  srcBRev.className = "source-rev";
  srcBRev.textContent = result.notice_revision_b ? "Revision: " + result.notice_revision_b : "Revision: Not recorded";
  srcBHead.append(srcBTag, srcBRev);
  const srcBUrl = document.createElement("div");
  srcBUrl.className = "source-url";
  srcBUrl.textContent = result.url_b || $("url-b").value.trim() || "Not provided";
  srcBBox.append(srcBHead, srcBUrl);

  sourcesList.append(srcABox, srcBBox);
  container.append(sourcesList);

  if (result.evidence_digest || result.owner) {
    const digestBox = document.createElement("div");
    digestBox.className = "digest-box";
    if (result.evidence_digest) {
      const dLabel = document.createElement("span");
      dLabel.className = "digest-label";
      dLabel.textContent = "Evidence Digest";
      const dVal = document.createElement("code");
      dVal.className = "digest-value";
      dVal.textContent = result.evidence_digest;
      digestBox.append(dLabel, dVal);
    }
    if (result.owner) {
      const oLabel = document.createElement("span");
      oLabel.className = "digest-label";
      oLabel.textContent = "Case Owner";
      const oVal = document.createElement("code");
      oVal.className = "digest-value";
      oVal.textContent = result.owner;
      digestBox.append(oLabel, oVal);
    }
    container.append(digestBox);
  }

  target.replaceChildren(container);
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
  $("tx-hash").textContent = hash.slice(0, 10) + "…" + hash.slice(-8);
  $("tx-hash").title = hash;
  $("explorer-link").href = "https://explorer-studio.genlayer.com/tx/" + hash;
  $("copy-tx").onclick = async () => {
    await navigator.clipboard.writeText(hash);
    setActivity("Transaction ID copied to clipboard.");
  };
  $("resume").hidden = true;
}

function showPending(pending) {
  if (pending.invalid) {
    $("tx-details").hidden = true;
    $("resume").hidden = true;
    setActivity("Invalid transaction recovery record detected. Actions are locked until safely resolved.", true);
    setButtons();
    return;
  }
  showTransaction(pending.hash);
  $("resume").hidden = false;
  $("resume").textContent = "Check transaction status";
  const suffix = pending.volatile ? " Local storage failed; keep this window open." : "";
  setActivity("A previous action is still being checked (" + pending.hash.slice(0, 8) + "…). Do not submit another action." + suffix, true);
  setButtons();
}

async function reconcileSavedTransaction() {
  if (!state.pending) return;
  showPending(state.pending);
  try {
    setActivity("Checking transaction status on Studionet…");
    const recovered = await reconcilePending({
      state,
      storage: window.localStorage,
      client: state.client,
      account: state.address,
      walletKey: state.walletKey,
      validateWalletSession,
      readback: (pending) => readCase(pending.contractAddress, pending.caseId, false),
    });
    showTransaction(recovered.hash);
    setActivity("Case updated and verified on Studionet.");
    setButtons();
  } catch (error) {
    console.error("Reconciliation error:", error);
    const msg = String(error?.message || "").toLowerCase();
    let userMsg = "This action is still being checked. Keep this window open and try again later.";
    if (msg.includes("wrong network") || msg.includes("chain")) {
      userMsg = "Your wallet is on the wrong network. Switch to Studionet to continue.";
    }
    setActivity(userMsg, true);
    setButtons();
  }
}

async function transact(functionName, args) {
  if (state.busy || state.pending) return;
  let address;
  try {
    address = requireConnected();
  } catch (error) {
    const msg = String(error?.message || "").toLowerCase();
    if (msg.includes("wrong network") || msg.includes("chain")) {
      setActivity("Your wallet is on the wrong network. Switch to Studionet to continue.", true);
    } else {
      setActivity("This action could not be verified. No case change was applied.", true);
    }
    return;
  }
  const pending = {
    contractAddress: address,
    account: state.address,
    walletKey: state.walletKey,
    caseId: $("case-id").value.trim(),
    schoolId: $("school-id").value.trim(),
    functionName,
    args,
  };
  setActivity("Confirm the transaction in your wallet…");
  try {
    const completed = await runTransaction({
      state,
      storage: window.localStorage,
      client: state.client,
      pending,
      validateWalletSession,
      preflight: ensureSpendableBalance,
      onPending: showPending,
      readback: (saved) => readCase(saved.contractAddress, saved.caseId, false),
    });
    showTransaction(completed.hash);
    setActivity("Case updated and verified on Studionet.");
  } catch (error) {
    console.error("Transaction error:", error);
    const msg = String(error?.message || "").toLowerCase();
    const code = error?.code;
    let userMsg = "This action could not be verified. No case change was applied.";
    if (code === 4001 || msg.includes("rejected") || msg.includes("cancelled") || msg.includes("denied")) {
      userMsg = "Transaction was cancelled in your wallet.";
    } else if (msg.includes("wrong network") || msg.includes("chain")) {
      userMsg = "Your wallet is on the wrong network. Switch to Studionet to continue.";
    }
    setActivity(userMsg, true);
  }
  setButtons();
}

const chooser = $("chooser");
const main = document.querySelector("main");

$("connect").addEventListener("click", () => {
  setWalletError("");
  renderProviders();
  main.inert = true;
  chooser.showModal();
  setTimeout(() => $("providers").querySelector("button")?.focus() || $("chooser").querySelector(".close-btn")?.focus(), 0);
});

chooser.addEventListener("close", () => {
  main.inert = false;
  $("connect").focus();
});

chooser.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  const focusable = [...chooser.querySelectorAll("button:not([disabled])")];
  if (!focusable.length) return;
  const next = focusTrap(focusable, document.activeElement, event.shiftKey);
  if ((event.shiftKey && document.activeElement === focusable[0]) || (!event.shiftKey && document.activeElement === focusable.at(-1))) {
    event.preventDefault();
    next.focus();
  }
});

$("create").addEventListener("click", () => transact("create_case", [$("case-id").value.trim(), $("school-id").value.trim(), $("url-a").value.trim(), $("url-b").value.trim()]));
$("freeze").addEventListener("click", () => transact("freeze_case", [$("case-id").value.trim()]));
$("assess").addEventListener("click", () => transact("assess", [$("case-id").value.trim()]));
$("retry").addEventListener("click", () => transact("retry_unresolved", [$("case-id").value.trim()]));
$("read").addEventListener("click", async () => {
  try {
    setActivity("Checking case record on Studionet…");
    await readCase();
    setActivity("Case record verified on Studionet.");
  } catch (error) {
    console.error("Read record error:", error);
    const msg = String(error?.message || "").toLowerCase();
    if (msg.includes("wrong network") || msg.includes("chain")) {
      setActivity("Your wallet is on the wrong network. Switch to Studionet to continue.", true);
    } else {
      setActivity("Could not verify the case record. Check the contract address and try again.", true);
    }
  }
});
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
  acceptProvider({
    legacy: true,
    info: {
      uuid: LEGACY_UUID,
      name: spec.label,
      icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
      rdns: spec.rdns[0],
    },
    provider: window.ethereum,
  });
});

setButtons();
if (state.pending) showPending(state.pending);
