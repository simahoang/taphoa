import { SHOPS, STAFF_UPGRADES, OWNER_SERVE_TIME, START_MONEY, SAVE_KEY } from "./balance.js";

// ---------- state ----------

function emptyMap(value) {
  const out = {};
  for (const sh of SHOPS) out[sh.id] = value;
  return out;
}

// stock: số đơn vị còn trong kho. unlocked: quầy đã mở chưa. staff: cấp NV (0..5).
export function createState() {
  return {
    money: START_MONEY,
    totalEarned: 0, // tổng đã kiếm, dùng cho BXH
    stock: emptyMap(0),
    unlocked: emptyMap(false),
    staff: 0,
    lastSeen: Date.now(),
  };
}

export function findShop(id) {
  return SHOPS.find((sh) => sh.id === id) || null;
}

export function isUnlocked(state, id) {
  return !!(state && state.unlocked && state.unlocked[id]);
}

export function stockOf(state, id) {
  const n = Math.floor(Number(state && state.stock && state.stock[id]) || 0);
  return Math.max(0, n);
}

export function restockCost(sh) {
  return sh.batchCost;
}

export function canRestock(state, id) {
  const sh = findShop(id);
  if (!sh || !isUnlocked(state, id)) return false;
  return state.money >= restockCost(sh);
}

// Cấp NV hiện tại: 0 = chủ quán, 1..5 = nhân viên. Kẹp lại để save cũ/hack không phá UI.
export function staffLevel(state) {
  const raw = Math.floor(Number(state && state.staff) || 0);
  return Math.max(0, Math.min(STAFF_UPGRADES.length, raw));
}

export function serveTimeOf(state) {
  const lv = staffLevel(state);
  return lv === 0 ? OWNER_SERVE_TIME : STAFF_UPGRADES[lv - 1].serveTime;
}

export function nextStaffUpgrade(state) {
  const lv = staffLevel(state);
  if (lv >= STAFF_UPGRADES.length) return null;
  return { from: lv, to: lv + 1, ...STAFF_UPGRADES[lv] };
}

// Lãi của 1 đơn vị khi khách mua xong (không còn nhân count).
export function saleProfit(sh) {
  return sh.unitProfit;
}

// DOANH THU 1 đơn vị = thu hồi vốn + lãi. Đây mới là tiền khách trả:
// pin 22.000 + 6.000 = 28.000đ/vỉ, khăn giấy 11.000 + 3.000 = 14.000đ/bịch...
// (Spec cũ chỉ cộng lãi nên bán cả lô vẫn lỗ — đã sửa.)
export function unitRevenue(sh) {
  return sh.batchCost / sh.batchSize + sh.unitProfit;
}

// Tổng lãi nếu mỗi quầy đang có hàng bán đúng 1 đơn vị (HUD "lãi tối đa/lượt").
export function potentialProfit(state) {
  return SHOPS.reduce(
    (s, sh) => s + (isUnlocked(state, sh.id) && stockOf(state, sh.id) > 0 ? saleProfit(sh) : 0),
    0
  );
}

// Giá trị hàng tồn theo giá vốn (không tính lãi chưa bán được).
export function stockValue(state) {
  return SHOPS.reduce((s, sh) => s + stockOf(state, sh.id) * (sh.batchCost / sh.batchSize), 0);
}

// Giá trị quầy theo giá thanh lý (50% giá mở) — mở quầy là chi phí chìm một nửa.
export function fixtureValue(state) {
  return SHOPS.reduce((s, sh) => s + (isUnlocked(state, sh.id) ? sh.unlockCost / 2 : 0), 0);
}

// TÀI SẢN RÒNG = tiền mặt + hàng tồn (giá vốn) + quầy (giá thanh lý).
// Chỉ số BXH: nhập-bán liên tục chỉ cộng đúng phần lãi, không farm được.
export function netWorth(state) {
  return state.money + stockValue(state) + fixtureValue(state);
}

// mọi nguồn thu đều đi qua đây để totalEarned luôn khớp
export function addMoney(state, amount) {
  state.money += amount;
  state.totalEarned += amount;
}

// ---------- mua / nhập hàng ----------

export function unlockShop(state, id) {
  const sh = findShop(id);
  if (!sh || isUnlocked(state, id) || state.money < sh.unlockCost) return false;
  state.money -= sh.unlockCost;
  state.unlocked[id] = true;
  return true;
}

// Nhập 1 lô: trừ batchCost, cộng batchSize đơn vị. Trả về true nếu thành công.
export function addStock(state, id) {
  const sh = findShop(id);
  if (!sh || !isUnlocked(state, id) || state.money < restockCost(sh)) return false;
  state.money -= restockCost(sh);
  state.stock[id] = stockOf(state, id) + sh.batchSize;
  return true;
}

// Thanh lý quầy TRỐNG: chỉ khi đã mở và hết hàng. Thu hồi 50% giá mở quầy
// (làm tròn xuống). Quầy về trạng thái chưa mở, mua lại được bất cứ lúc nào.
// Hoàn vốn KHÔNG tính vào totalEarned (không phải doanh thu).
export function liquidateRefund(sh) {
  return Math.floor(sh.unlockCost / 2);
}
export function canLiquidate(state, id) {
  return isUnlocked(state, id) && stockOf(state, id) <= 0;
}
export function liquidateShop(state, id) {
  const sh = findShop(id);
  if (!sh || !canLiquidate(state, id)) return 0;
  state.unlocked[id] = false;
  const refund = liquidateRefund(sh);
  state.money += refund;
  return refund;
}

// Bán 1 đơn vị: chỉ trừ khi còn hàng. Trả về false nếu đã hết (race lúc đang phục vụ).
export function consumeStock(state, id) {
  const have = stockOf(state, id);
  if (have <= 0) return false;
  state.stock[id] = have - 1;
  return true;
}

// ---------- save / load ----------

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return withOffline(createState());
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return withOffline(createState());
    const st = createState();
    st.money = Math.max(0, num(parsed.money, START_MONEY));
    st.totalEarned = Math.max(0, num(parsed.totalEarned, 0));
    st.staff = Math.max(0, Math.min(STAFF_UPGRADES.length, Math.floor(num(parsed.staff, 0))));
    st.lastSeen = num(parsed.lastSeen, Date.now());
    for (const sh of SHOPS) {
      st.stock[sh.id] = Math.max(0, Math.floor(num(parsed.stock && parsed.stock[sh.id], 0)));
      st.unlocked[sh.id] = !!(parsed.unlocked && parsed.unlocked[sh.id]);
    }
    return withOffline(st);
  } catch {
    return createState();
  }
}

// Offline: mỗi quầy đã mở tự bán tối đa floor(dt/serveTime) đơn vị (không quá tồn),
// cộng 50% lãi và TRỪ tồn tương ứng. Cap 8h để không bán sạch kho sau 1 đêm dài.
function withOffline(st) {
  const now = Date.now();
  const dt = Math.min(8 * 3600, Math.max(0, (now - (st.lastSeen || now)) / 1000));
  const serveTime = serveTimeOf(st);
  const maxOrders = Math.floor(dt / serveTime);
  let gain = 0;
  let units = 0;

  for (const sh of SHOPS) {
    if (!isUnlocked(st, sh.id)) continue;
    const sell = Math.min(stockOf(st, sh.id), maxOrders);
    if (sell <= 0) continue;
    st.stock[sh.id] = stockOf(st, sh.id) - sell;
    gain += unitRevenue(sh) * sell * 0.5;
    units += sell;
  }

  if (gain > 0) addMoney(st, gain);
  st._offlineGain = gain;
  st._offlineUnits = units;
  st.lastSeen = now;
  return st;
}

export function save(state) {
  state.lastSeen = Date.now();
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}
