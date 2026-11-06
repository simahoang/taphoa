// Mô phỏng vòng kinh tế Game3 bằng đúng số liệu src/balance.js + logic game.js.
// Chính sách auto: mở quầy rẻ nhất khi đủ tiền (mở + 1 lô), nhập lại quầy hết hàng (rẻ trước).
// Khách vô hạn, NV phục vụ FIFO mỗi serveTime giây, chọn quầy lãi cao nhất đang còn hàng.
import { SHOPS, START_MONEY, OWNER_SERVE_TIME } from "./src/balance.js";
import { createState, unlockShop, addStock, consumeStock, unitRevenue } from "./src/game.js";

const SIM_SECONDS = 3 * 3600;
const byId = Object.fromEntries(SHOPS.map((s) => [s.id, s]));
const order = [...SHOPS].sort((a, b) => a.unlockCost - b.unlockCost);

const st = createState();
let t = 0;
let nextServe = OWNER_SERVE_TIME;
const log = [];
let serves = 0;

function autoManage() {
  for (const s of order) {
    if (!st.unlocked[s.id] && st.money >= s.unlockCost + s.batchCost) {
      unlockShop(st, s.id);
      addStock(st, s.id);
      log.push(`t=${Math.floor(t / 60)}p: MỞ ${s.name} (tiền còn ${Math.floor(st.money)})`);
    }
  }
  for (const s of order) {
    if (st.unlocked[s.id] && (st.stock[s.id] || 0) === 0 && st.money >= s.batchCost) {
      addStock(st, s.id);
    }
  }
}

while (t < SIM_SECONDS) {
  t = nextServe;
  nextServe += OWNER_SERVE_TIME;
  autoManage();
  const avail = order.filter((s) => st.unlocked[s.id] && (st.stock[s.id] || 0) > 0);
  if (!avail.length) continue;
  avail.sort((a, b) => b.unitProfit - a.unitProfit);
  const pick = avail[0];
  if (consumeStock(st, pick.id)) {
    const rev = byId[pick.id].batchCost / byId[pick.id].batchSize + byId[pick.id].unitProfit;
    st.money += rev;
    st.totalEarned += rev;
    serves++;
  }
}

console.log("von dau: " + START_MONEY);
for (const l of log) console.log(l);
console.log("sau 3h: tien=" + Math.floor(st.money) + " tong kiem=" + Math.floor(st.totalEarned) + " luot phuc vu=" + serves);
console.log("ton kho: " + order.map((s) => s.id + "=" + (st.stock[s.id] || 0)).join(" "));
