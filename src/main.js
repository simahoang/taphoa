import { SHOPS } from "./balance.js";
import {
  createState, load, save, addMoney, potentialProfit, netWorth,
  staffLevel, serveTimeOf, nextStaffUpgrade,
  isUnlocked, stockOf, restockCost, addStock, saleProfit, unitRevenue, unlockShop,
  liquidateRefund, liquidateShop,
} from "./game.js";
import { initScene } from "./scene.js";
import { playClick, playSale, isMuted, toggleMuted } from "./audio.js";
import { getName, getLocalRank, getTop, submitScore, refreshOnlineTop, initNameFromEmail } from "./leaderboard.js";
import { shareScore } from "./share.js";
import { APP_ENV, SCORE_TABLE } from "./supabase.js";
import {
  handleAuthCallback, getSession, isLoggedIn, refreshSession,
  getUser, signOut, sendOtp, verifyOtp, signInWithGoogle,
} from "./auth.js";

let state = load();
const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.floor(n).toLocaleString("vi-VN");

let shopKey = "";
let staffKey = "";
let pendingConfirm = null;
let scene = null;
let started = false;
let outOfStockWarned = false;

// ---------- render ----------

function shopCardHtml(sh) {
  const unlocked = isUnlocked(state, sh.id);
  const stock = stockOf(state, sh.id);
  const empty = unlocked && stock <= 0;
  const cost = unlocked ? restockCost(sh) : sh.unlockCost;
  const afford = state.money >= cost;
  const badge = !unlocked ? "Chưa mở" : empty ? "Trống" : `Tồn: ${stock} ${sh.unit}`;
  const buyLabel = !unlocked
    ? `Mở quầy · ${fmt(cost)}đ`
    : `Nhập ${sh.batchSize} ${sh.unit} · ${fmt(cost)}đ`;
  // Quầy trống: giữ nút nhập hàng (chính) + thêm nút thanh lý (phụ), không thay thế.
  const sellBtn = empty
    ? `<button type="button" class="sellBtn" data-sell="${sh.id}">Thanh lý +${fmt(liquidateRefund(sh))}đ</button>`
    : "";
  return `<div class="shop${unlocked ? "" : " locked"}" data-id="${sh.id}">
    <h3><span>${sh.icon || "📦"} ${sh.name}</span><span class="cnt">${badge}</span></h3>
    <div class="row">
      <span class="sub">Thu ${fmt(unitRevenue(sh))}đ · Lãi ${fmt(saleProfit(sh))}đ/${sh.unit}</span>
      <span class="actions"><button type="button" class="buyBtn" data-buy="${sh.id}" ${afford ? "" : "disabled"}>${buyLabel}</button>${sellBtn}</span>
    </div>
  </div>`;
}

// Key gồm mở quầy + tồn kho + affordability: chỉ render lại khi 1 trong 3 đổi.
function shopsKey() {
  return SHOPS.map((sh) => {
    const unlocked = isUnlocked(state, sh.id);
    const cost = unlocked ? restockCost(sh) : sh.unlockCost;
    return `${sh.id}:${unlocked ? 1 : 0}:${stockOf(state, sh.id)}:${state.money >= cost ? 1 : 0}`;
  }).join("|");
}

function renderShops(force = false) {
  const key = shopsKey();
  if (!force && key === shopKey) return;
  shopKey = key;
  $("shops").innerHTML = SHOPS.map(shopCardHtml).join("");
}

function staffRowHtml() {
  const lv = staffLevel(state);
  const cur = serveTimeOf(state);
  const up = nextStaffUpgrade(state);
  if (!up) {
    return `<div class="staffRow">
      <div class="staffInfo"><b>Nhân viên Lv.${lv}</b><div class="sub">Phục vụ ${cur}s/khách · Đã tối đa</div></div>
      <button type="button" class="upBtn" disabled>Tối đa</button>
    </div>`;
  }
  const afford = state.money >= up.cost;
  const label = lv === 0 ? `Thuê NV · ${fmt(up.cost)}đ` : `Nâng cấp · ${fmt(up.cost)}đ`;
  return `<div class="staffRow">
    <div class="staffInfo">
      <b>Nhân viên Lv.${up.from} <span class="arrow">→ Lv.${up.to}</span></b>
      <div class="sub">${lv === 0 ? "Chủ quán tự bán · " : ""}${cur}s/khách → ${up.serveTime}s/khách</div>
    </div>
    <button type="button" class="upBtn" data-up="${up.to}" ${afford ? "" : "disabled"}>${label}</button>
  </div>`;
}

function renderStaff(force = false) {
  const lv = staffLevel(state);
  const up = nextStaffUpgrade(state);
  const cost = up ? up.cost : 0;
  const key = `${lv}:${up ? 1 : 0}:${state.money >= cost ? 1 : 0}`;
  if (!force && key === staffKey) return;
  staffKey = key;
  $("staffBox").innerHTML = staffRowHtml();
}

function updateHud() {
  $("money").textContent = fmt(state.money);
  // potentialProfit() = tổng lãi nếu mỗi quầy đang có hàng bán 1 đơn vị.
  $("ips").textContent = fmt(potentialProfit(state));
  renderShops();
  renderStaff();
  checkOutOfStock();
}

// Hết hàng toàn quán (đã mở ít nhất 1 quầy mà mọi kho = 0) -> nhắc 1 lần mỗi lần rơi vào trạng thái.
const OUT_OF_STOCK_MSG = "Hết hàng! Nhập thêm hàng để bán";
function checkOutOfStock() {
  const anyUnlocked = SHOPS.some((sh) => isUnlocked(state, sh.id));
  const totalStock = SHOPS.reduce((s, sh) => s + stockOf(state, sh.id), 0);
  const out = anyUnlocked && totalStock === 0;
  if (out && !outOfStockWarned) {
    outOfStockWarned = true;
    toast(OUT_OF_STOCK_MSG);
  } else if (!out) {
    outOfStockWarned = false;
    if ($("offlineMsg").textContent === OUT_OF_STOCK_MSG) toast(""); // đã nhập hàng -> bỏ nhắc cũ
  }
}

let boardKey = "";

function renderBoard() {
  const SHOW = 50; // BXH hiện tối đa top 50
  const list = getTop(SHOW);
  const worth = Math.floor(netWorth(state));
  const rank = worth > 0 ? getLocalRank(worth) : null;
  const me = getName();
  const key = list.map((s) => `${s.name}|${Math.floor(s.netWorth)}`).join(",") + "#" + (rank || "") + "#" + worth;
  if (key === boardKey) return;
  boardKey = key;
  let html;
  if (!list.length) {
    html = `<li class="empty">Chưa có ai. Chơi đi!</li>`;
  } else {
    html = list.map((s, i) => `<li${s.name === me ? ' class="me"' : ""}><span class="r">#${i + 1}</span><span class="n">${escapeHtml(s.name)}</span><b>${fmt(s.netWorth)} đ</b></li>`).join("");
    // Ngoài top 50: thêm 1 dòng vị trí của mình để khỏi mò tìm.
    if (rank && rank > list.length) {
      html += `<li class="me"><span class="r">#${rank}</span><span class="n">${escapeHtml(me)} (bạn)</span><b>${fmt(worth)} đ</b></li>`;
    }
  }
  $("boardList").innerHTML = html;
  $("rankMsg").textContent = rank ? `Hạng của bạn: #${rank}` : "";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function toast(msg) {
  $("offlineMsg").textContent = msg;
}

function showOffline() {
  if (state._offlineGain > 1) {
    const units = Math.floor(Number(state._offlineUnits) || 0);
    toast(`Chào mừng trở lại! Offline bán ${fmt(units)} đơn vị · +${fmt(state._offlineGain)} đ`);
    state._offlineGain = 0;
    state._offlineUnits = 0;
  }
}

// ---------- modal confirm ----------

function openModal({ title, body, confirmLabel, onConfirm }) {
  $("modalTitle").textContent = title;
  $("modalBody").innerHTML = body;
  $("modalConfirm").textContent = confirmLabel;
  $("modalConfirm").disabled = false;
  pendingConfirm = onConfirm;
  $("modal").hidden = false;
  document.body.classList.add("modalOpen");
}

function closeModal() {
  pendingConfirm = null;
  $("modal").hidden = true;
  document.body.classList.remove("modalOpen");
}

$("modalCancel").addEventListener("click", closeModal);
$("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeModal(); });
$("modalConfirm").addEventListener("click", () => {
  const fn = pendingConfirm;
  if (typeof fn !== "function") { closeModal(); return; }
  closeModal(); // đóng trước để tránh double click
  fn();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("modal").hidden) closeModal();
});

function openShopConfirm(id) {
  const sh = SHOPS.find((s) => s.id === id);
  if (!sh) return;
  if (isUnlocked(state, id)) openRestockConfirm(sh);
  else openUnlockConfirm(sh);
}

function openUnlockConfirm(sh) {
  openModal({
    title: `${sh.icon || "📦"} ${sh.name}`,
    body: `
      <div class="mRow"><span>Giá mở quầy</span><b>${fmt(sh.unlockCost)} đ</b></div>
      <div class="mRow"><span>Giá bán mỗi ${sh.unit}</span><b>+${fmt(unitRevenue(sh))} đ/${sh.unit}</b></div>
      <div class="mRow"><span>Lãi mỗi ${sh.unit}</span><b>+${fmt(saleProfit(sh))} đ/${sh.unit}</b></div>
      <div class="mRow"><span>Đang có</span><b>${fmt(state.money)} đ</b></div>`,
    confirmLabel: `Mở quầy · ${fmt(sh.unlockCost)}đ`,
    onConfirm: () => {
      if (!unlockShop(state, sh.id)) { toast("Không đủ tiền"); return; }
      playClick();
      save(state); // mở quầy xong lưu luôn
      shopKey = "";
      updateHud();
    },
  });
}

function openSellConfirm(sh) {
  openModal({
    title: `${sh.icon || "📦"} Thanh lý ${sh.name}`,
    body: `
      <div class="mRow"><span>Quầy đang trống hàng</span><b>0 ${sh.unit}</b></div>
      <div class="mRow"><span>Thu hồi (50% giá mở)</span><b>+${fmt(liquidateRefund(sh))} đ</b></div>
      <div class="mRow"><span>Mua lại sau này</span><b>${fmt(sh.unlockCost)} đ</b></div>
      <div class="mRow"><span>Đang có</span><b>${fmt(state.money)} đ</b></div>`,
    confirmLabel: `Thanh lý +${fmt(liquidateRefund(sh))}đ`,
    onConfirm: () => {
      const refund = liquidateShop(state, sh.id);
      if (!refund) { toast("Quầy còn hàng, bán hết mới thanh lý được"); return; }
      playClick();
      save(state);
      shopKey = "";
      updateHud();
      toast(`Đã thanh lý +${fmt(refund)}đ`);
    },
  });
}

function openRestockConfirm(sh) {
  const stock = stockOf(state, sh.id);
  const cost = restockCost(sh);
  openModal({
    title: `${sh.icon || "📦"} ${sh.name}`,
    body: `
      <div class="mRow"><span>Số lượng nhập</span><b>${sh.batchSize} ${sh.unit}</b></div>
      <div class="mRow"><span>Tổng tiền</span><b>${fmt(cost)} đ</b></div>
      <div class="mRow"><span>Tồn hiện tại</span><b>${fmt(stock)} ${sh.unit}</b></div>
      <div class="mRow"><span>Tồn sau khi nhập</span><b>${fmt(stock + sh.batchSize)} ${sh.unit}</b></div>
      <div class="mRow"><span>Đang có</span><b>${fmt(state.money)} đ</b></div>`,
    confirmLabel: `Nhập hàng · ${fmt(cost)}đ`,
    onConfirm: () => {
      if (!addStock(state, sh.id)) { toast("Không đủ tiền"); return; }
      playClick();
      save(state); // nhập xong lưu luôn
      shopKey = "";
      updateHud();
    },
  });
}

function openStaffConfirm() {
  const up = nextStaffUpgrade(state);
  if (!up) return;
  const cur = serveTimeOf(state);
  const title = up.from === 0 ? "Thuê nhân viên" : `Nhân viên Lv.${up.from} → Lv.${up.to}`;
  openModal({
    title,
    body: `
      <div class="mRow"><span>Giá</span><b>${fmt(up.cost)} đ</b></div>
      <div class="mRow"><span>Tốc độ hiện tại</span><b>${cur}s/khách</b></div>
      <div class="mRow"><span>Sau khi nâng cấp</span><b>${up.serveTime}s/khách</b></div>
      <div class="mRow"><span>Đang có</span><b>${fmt(state.money)} đ</b></div>`,
    confirmLabel: up.from === 0 ? `Thuê · ${fmt(up.cost)}đ` : `Nâng cấp · ${fmt(up.cost)}đ`,
    onConfirm: () => {
      const nowUp = nextStaffUpgrade(state);
      if (!nowUp) return;
      if (state.money < nowUp.cost) { toast("Không đủ tiền"); return; }
      state.money -= nowUp.cost;
      state.staff = nowUp.to;
      playClick();
      save(state);
      staffKey = "";
      updateHud();
    },
  });
}

// Event delegation: nút không bị gắn lại mỗi tick nên bấm rất ổn định.
$("shops").addEventListener("click", (e) => {
  const sell = e.target.closest("button[data-sell]");
  if (sell) {
    const sh = SHOPS.find((s) => s.id === sell.dataset.sell);
    if (sh) openSellConfirm(sh);
    return;
  }
  const btn = e.target.closest("button[data-buy]");
  if (btn) openShopConfirm(btn.dataset.buy);
});
$("staffBox").addEventListener("click", (e) => {
  if (e.target.closest("button[data-up]")) openStaffConfirm();
});

// ---------- scene / âm thanh ----------

function syncMute() {
  $("muteBtn").textContent = isMuted() ? "🔇" : "🔊";
  $("muteBtn").classList.toggle("off", isMuted());
}
$("muteBtn").onclick = () => { toggleMuted(); playClick(); syncMute(); };
syncMute();

// 1 khách mua 1 đơn vị -> thu DOANH THU = vốn + lãi của quầy.
// Scene CHỈ gọi hàm này sau khi consumeStock thành công và thanh serveTime chạy xong;
// mọi nguồn thu đi qua addMoney().
function onCustomerSale(shopId) {
  const sh = SHOPS.find((s) => s.id === shopId);
  if (!sh) return 0;
  const gain = unitRevenue(sh);
  if (gain > 0) addMoney(state, gain);
  playSale();
  return gain;
}

// ---------- save / BXH ----------

let lastSubmitted = -1;
function doSave(msg) {
  save(state);
  const worth = Math.floor(netWorth(state));
  if (worth > 0 && worth > lastSubmitted) {
    lastSubmitted = worth;
    submitScore(worth).then(renderBoard);
  }
  if (msg) toast(msg);
}

$("saveBtn").onclick = () => doSave("Đã lưu");
$("shareBtn").onclick = async () => {
  const btn = $("shareBtn");
  btn.disabled = true;
  try {
    const how = await shareScore(Math.floor(netWorth(state)));
    toast(how === "shared" ? "Đã mở chia sẻ" : "Đã tải ảnh điểm, gửi cho bạn bè đi!");
  } catch (e) {
    toast(String((e && e.message) || e));
  } finally {
    btn.disabled = false;
  }
};
$("resetBtn").onclick = () => {
  if (!confirm("Chơi lại?")) return;
  if (Math.floor(netWorth(state)) > 0) submitScore(Math.floor(netWorth(state))).then(renderBoard);
  state = createState();
  lastSubmitted = -1;
  shopKey = "";
  staffKey = "";
  outOfStockWarned = false;
  if (scene) scene.reset(); // dọn khách/NV đang đứng ở quầy cũ
  save(state);
  updateHud();
  renderBoard();
  toast("");
};

// ---------- đăng nhập ----------

function authMsg(msg, ok = false) {
  const el = $("authErr");
  el.textContent = msg || "";
  el.classList.toggle("ok", !!ok);
}

function setUserBar(session) {
  const email = (session && session.user && session.user.email) || "";
  $("userEmail").textContent = email;
  $("userBar").hidden = !email;
}

function showAuth() {
  document.body.classList.add("authLocked");
  $("authOverlay").hidden = false;
  setUserBar(getSession());
}

function onLoggedIn() {
  const s = getSession();
  const email = (s && s.user && s.user.email) || $("authEmail").value.trim();
  if (email) initNameFromEmail(email);
  setUserBar(s);
  authMsg("");
  startGame();
}

function validEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
}

$("sendOtpBtn").addEventListener("click", async () => {
  const email = $("authEmail").value.trim();
  if (!validEmail(email)) { authMsg("Email chưa hợp lệ."); $("authEmail").focus(); return; }
  const btn = $("sendOtpBtn");
  btn.disabled = true;
  authMsg("Đang gửi mã...", true);
  try {
    await sendOtp(email);
    authMsg("Đã gửi mã. Kiểm tra email (cả mục Spam) rồi nhập mã bên dưới.", true);
    $("authOtp").focus();
  } catch (e) {
    authMsg((e && e.message) || "Gửi mã thất bại.");
  } finally {
    btn.disabled = false;
  }
});

$("verifyOtpBtn").addEventListener("click", async () => {
  const email = $("authEmail").value.trim();
  const code = $("authOtp").value.trim();
  if (!validEmail(email)) { authMsg("Email chưa hợp lệ."); $("authEmail").focus(); return; }
  if (!code) { authMsg("Nhập mã OTP trong email."); $("authOtp").focus(); return; }
  const btn = $("verifyOtpBtn");
  btn.disabled = true;
  authMsg("Đang xác nhận...", true);
  try {
    await verifyOtp(email, code);
    onLoggedIn();
  } catch (e) {
    authMsg((e && e.message) || "Xác nhận thất bại.");
  } finally {
    btn.disabled = false;
  }
});

$("googleBtn").addEventListener("click", () => {
  authMsg("Đang chuyển tới Google...", true);
  signInWithGoogle();
});

$("logoutBtn").addEventListener("click", () => {
  signOut(); // xóa local ngay, không chờ mạng
  location.reload();
});

$("authEmail").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); $("sendOtpBtn").click(); }
});
$("authOtp").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); $("verifyOtpBtn").click(); }
});

// ---------- vòng lặp chính ----------

// Chỉ chạy sau khi đã đăng nhập. Gọi 1 lần, các lần sau bỏ qua.
function startGame() {
  if (started) return;
  started = true;

  document.body.classList.remove("authLocked");
  $("authOverlay").hidden = true;
  $("myName").textContent = getName();

  scene = initScene($("scene"), () => state, onCustomerSale);

  // tick 10 lần/s: cập nhật HUD (tiền chỉ tăng khi NV phục vụ xong).
  setInterval(() => {
    updateHud();
  }, 500);

  setInterval(() => doSave(), 10000);
  setInterval(renderBoard, 2000);
  setInterval(() => { refreshOnlineTop().then(renderBoard); }, 60000);
  window.addEventListener("beforeunload", () => {
    save(state);
    if (Math.floor(netWorth(state)) > 0) submitScore(Math.floor(netWorth(state)));
  });

  renderBoard();
  refreshOnlineTop().then(renderBoard);
  updateHud();
  showOffline();
}

// ---------- khởi động ----------

async function boot() {
  document.body.classList.add("authLocked");

  // Huy hiệu môi trường: DEV = bảng scores_dev, prod = scores.
  if (APP_ENV !== "prod") {
    const b = $("envBadge");
    b.hidden = false;
    b.textContent = "DEV · " + SCORE_TABLE;
    b.style.cssText = "font-size:12px;background:#f59e0b;color:#000;border-radius:6px;padding:2px 8px;vertical-align:middle";
  }

  let callbackError = null;
  try {
    // Phải chạy trước: parse #access_token... sau redirect Google rồi xóa hash.
    await handleAuthCallback();
  } catch (e) {
    callbackError = e;
  }

  // Access token hết hạn nhưng còn refresh token -> gia hạn trước khi vào game.
  if (getSession() && !isLoggedIn()) {
    try { await refreshSession(); } catch {}
  }

  // Kiểm tra session còn hiệu lực thật (session giả/hết hạn sẽ bị đăng xuất).
  if (getSession()) {
    try {
      await getUser();
    } catch (e) {
      if (e && e.status === 401) await signOut();
    }
  }

  if (isLoggedIn()) {
    const s = getSession();
    if (s && s.user && s.user.email) initNameFromEmail(s.user.email);
    setUserBar(s);
    if (callbackError) console.info("[auth] callback:", String((callbackError && callbackError.message) || callbackError));
    startGame();
  } else {
    showAuth();
    if (callbackError) authMsg((callbackError && callbackError.message) || "Đăng nhập thất bại.");
  }
}

boot();
