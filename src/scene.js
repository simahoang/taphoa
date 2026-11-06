// Scene canvas 2D: LUÔN vẽ đủ 8 quầy + DUY NHẤT 1 nhân viên/chủ quán.
// Luồng mới (tồn kho thay cho "mua số lượng quầy"):
//  - Quầy chưa mở: xám + "Chưa mở". Quầy mở nhưng stock=0: nhợt + "Hết hàng".
//  - Khách chỉ chọn quầy ĐÃ MỞ và CÒN HÀNG, trọng số theo unitProfit (lãi cao hút hơn),
//    đi tới ĐỨNG CHỜ NGAY TRƯỚC QUẦY. Mỗi quầy tối đa SLOT_COUNT khách chờ.
//  - Quầy đầy -> chọn quầy khác còn chỗ; hết chỗ -> khách ghé nhìn rồi đi ra.
//  - NV phục vụ FIFO toàn quán: đi tới cạnh khách, chạy thanh serveTime, xong mới
//    consumeStock + gọi onSale(idQuầy). Tiền do main.js tính = doanh thu (vốn + lãi).
import { SHOPS } from "./balance.js";
import { staffLevel, serveTimeOf, isUnlocked, stockOf, saleProfit, consumeStock } from "./game.js";

const SHOP_ICON = {};
// Font co chua color emoji + VS16 ep hien mau thay vi outline don sac.
const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",serif';
const VS16 = "\uFE0F";
function em(str) {
  str = String(str || "");
  return str.indexOf(VS16) >= 0 ? str : str + VS16;
}
for (const sh of SHOPS) SHOP_ICON[sh.id] = sh.icon || "📦";

const CLOSED_SKIN = { body: "#9ca3af", roof: "#e5e7eb", stripe: "#d1d5db" };

const SLOT_COUNT = 3; // số khách tối đa đứng chờ trước mỗi quầy
const MAX_CLIENTS = 12; // trần khách trong scene (nhiều quầy vẫn đông vui)
const WALL_H = 44; // dải tường phía trên (treo bảng tên tiệm)

// 1 skin / quầy (không còn cấp quầy). 8 màu cho 8 món.
const PALETTES = {
  green: { body: "#15803d", roof: "#ecfdf5", stripe: "#86efac" },
  blue: { body: "#0369a1", roof: "#f0f9ff", stripe: "#bae6fd" },
  amber: { body: "#b45309", roof: "#fffbeb", stripe: "#fde68a" },
  pink: { body: "#be185d", roof: "#fdf2f8", stripe: "#fbcfe8" },
  orange: { body: "#c2410c", roof: "#fff7ed", stripe: "#fed7aa" },
  red: { body: "#b91c1c", roof: "#fef2f2", stripe: "#fecaca" },
  teal: { body: "#0f766e", roof: "#f0fdfa", stripe: "#99f6e4" },
  purple: { body: "#6d28d9", roof: "#f5f3ff", stripe: "#ddd6fe" },
};

export const SHOP_SKINS = {
  pin: PALETTES.teal,
  tissue: PALETTES.pink,
  snack: PALETTES.amber,
  water: PALETTES.blue,
  spice: PALETTES.red,
  school: PALETTES.purple,
  rice: PALETTES.green,
  claw: PALETTES.orange,
};

// Popup tiền: 6.000đ
function fmtGain(n) {
  return Math.round(Number(n) || 0).toLocaleString("vi-VN") + "đ";
}

export function initScene(canvas, getState, onSale) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const WALK_Y = H - 48; // làn đi lại của NV/chủ, tách hẳn khỏi hàng chờ
  const STAFF_HOME = W / 2;
  const STAFF_SPEED = 300; // px/s

  let clients = [];
  let popups = [];
  let spawnT = 1.2;
  let seq = 0;
  let waitSeq = 0; // thứ tự THỰC SỰ tới slot, dùng cho FIFO toàn quán
  const staff = {
    x: STAFF_HOME, y: WALK_Y, tx: STAFF_HOME, ty: WALK_Y,
    state: "idle", target: null, t: 0, serve: 0,
  };

  // LUÔN đủ 8 quầy, lưới 4x2 tự co. Mỗi quầy có sẵn SLOT_COUNT vị trí chờ.
  function buildCounters(state) {
    const list = SHOPS.map((sh) => ({
      id: sh.id,
      name: sh.name,
      unit: sh.unit,
      unlocked: isUnlocked(state, sh.id),
      stock: stockOf(state, sh.id),
      profit: saleProfit(sh),
    }));

    const n = list.length;
    const cols = 4;
    const rows = Math.ceil(n / cols);
    const gapX = 12;
    const gapY = 56; // chừa chỗ cho 1 hàng khách chờ + lối đi, không đè quầy dưới
    const availW = W - 36; // chừa lối đi bên phải cho cửa
    const w = Math.min(120, Math.floor((availW - 16 - (cols - 1) * gapX) / cols));
    const h = 40;
    const y0 = 54;
    list.forEach((c, idx) => {
      const row = Math.floor(idx / cols);
      const inRow = Math.min(cols, n - row * cols);
      const rowW = inRow * w + (inRow - 1) * gapX;
      const left = (availW - rowW) / 2;
      c.x = left + (idx % cols) * (w + gapX) + w / 2;
      c.y = y0 + row * (h + gapY);
      c.w = w;
      c.h = h;
      // 3 slot chờ trước quầy: trái / giữa / phải, cách chân quầy đủ xa.
      const slotGap = Math.min(34, Math.max(24, (w - 16) / 2));
      c.slots = [0, 1, 2].map((i) => ({
        x: c.x + (i - 1) * slotGap,
        y: c.y + h + 20,
      }));
    });
    return list;
  }

  // Slot đang bị giữ bởi 1 khách chưa rời đi (kể cả đang được phục vụ).
  function freeSlot(counterId) {
    for (let i = 0; i < SLOT_COUNT; i++) {
      let used = false;
      for (const cl of clients) {
        if (cl.phase !== "out" && cl.slot === i && cl.target === counterId) { used = true; break; }
      }
      if (!used) return i;
    }
    return -1;
  }

  // Màu áo phân biệt từng khách, vẽ vector nên nét trên mọi máy (không phụ thuộc font emoji).
  const SHIRTS = ["#e11d48", "#2563eb", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#ca8a04"];
  const SKIN = ["#fcd7b0", "#f0b98a", "#d99a63", "#a76b3f"];

  function makeClient(fields) {
    return {
      seq: seq++,
      shirt: SHIRTS[Math.floor(Math.random() * SHIRTS.length)],
      skin: SKIN[Math.floor(Math.random() * SKIN.length)],
      x: W + 12,
      y: WALK_Y,
      tx: W,
      ty: WALK_Y,
      target: null,
      slot: -1,
      phase: "in",
      t: 0,
      ...fields,
    };
  }

  // Người vector: đầu tròn + thân áo, viền đậm để nổi trên nền. Cao ~30px.
  function drawPerson(x, y, skin, shirt, hat) {
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(60,30,10,.85)";
    // thân áo
    ctx.fillStyle = shirt;
    roundRect(x - 8, y - 18, 16, 14, 5);
    ctx.fill();
    ctx.stroke();
    // đầu
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(x, y - 23, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (hat === "chef") {
      // mũ đầu bếp trắng
      ctx.fillStyle = "#ffffff";
      roundRect(x - 8, y - 36, 16, 8, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillRect(x - 9, y - 30, 18, 3);
    }
  }

  // Trả về true nếu có khách được thêm vào scene.
  function spawn(state, counters) {
    const inStock = counters.filter((c) => c.unlocked && c.stock > 0);
    const open = inStock.filter((c) => freeSlot(c.id) >= 0);

    if (open.length) {
      // Chọn quầy có trọng số theo unitProfit: quầy lãi cao hút khách hơn.
      let total = 0;
      for (const c of open) total += c.profit;
      let r = Math.random() * total;
      let pick = open[open.length - 1];
      for (const c of open) {
        r -= c.profit;
        if (r <= 0) { pick = c; break; }
      }
      const slot = freeSlot(pick.id);
      const pos = pick.slots[slot];
      clients.push(makeClient({ target: pick.id, slot, tx: pos.x, ty: pos.y }));
      return true;
    }

    if (inStock.length) {
      // Có quầy còn hàng nhưng mọi slot đều đầy: khách ghé vào nhìn rồi bỏ đi.
      // Chỉ thêm khi scene còn thoáng, tránh nhồi toàn khách đi bộ vu vơ.
      if (clients.length >= MAX_CLIENTS - 3) return false;
      clients.push(makeClient({ tx: W * 0.55, ty: WALK_Y - 12, noSlot: true }));
      return true;
    }

    // Mọi quầy đã mở đều hết hàng: khách ghé quầy trống nhìn rồi đi ("!").
    const empty = counters.filter((c) => c.unlocked);
    if (empty.length) {
      if (clients.length >= MAX_CLIENTS - 3) return false;
      const pick = empty[Math.floor(Math.random() * empty.length)];
      clients.push(makeClient({
        target: pick.id,
        tx: pick.x,
        ty: pick.y + pick.h + 14,
        phase: "browseIn",
      }));
      return true;
    }

    return false; // chưa mở quầy nào -> tiệm vắng
  }

  function moveTo(c, dt, speed) {
    const dx = c.tx - c.x;
    const dy = c.ty - c.y;
    const d = Math.hypot(dx, dy);
    const step = speed * dt;
    if (d <= step || d < 0.6) {
      c.x = c.tx;
      c.y = c.ty;
      return true;
    }
    c.x += (dx / d) * step;
    c.y += (dy / d) * step;
    return false;
  }

  function update(dt, state) {
    const counters = buildCounters(state);
    const byId = new Map(counters.map((c) => [c.id, c]));
    const serveTime = serveTimeOf(state);

    // --- khách vào theo nhịp, càng nhiều quầy đang có hàng càng đông ---
    const activeKinds = counters.filter((c) => c.unlocked && c.stock > 0).length;
    spawnT -= dt;
    if (spawnT <= 0) {
      if (clients.length < MAX_CLIENTS) spawn(state, counters);
      // ~1.2s với 1 quầy -> ~0.5s khi mở nhiều quầy, để slot chờ luôn có khách
      spawnT = Math.max(0.5, 1.3 - activeKinds * 0.1);
    }

    // Nhập hàng / đổi lưới: kéo khách đang chờ về đúng slot.
    for (const c of clients) {
      if (c.slot < 0 || (c.phase !== "wait" && c.phase !== "serving")) continue;
      const ctr = byId.get(c.target);
      const s = ctr && ctr.slots[c.slot];
      if (s) { c.tx = s.x; c.ty = s.y; }
    }

    // --- FIFO toàn quán: ai tới đứng chờ trước thì được phục vụ trước ---
    const waiting = clients
      .filter((c) => c.phase === "wait")
      .sort((a, b) => a.order - b.order);

    // --- NV: rảnh thì đón khách đầu hàng ---
    if (staff.state === "idle") {
      const next = waiting[0];
      if (next) {
        next.phase = "serving";
        staff.target = next;
        staff.tx = next.x + 34; // đứng cạnh khách, cách đủ xa để glyph không đè nhau
        staff.ty = next.y + 6;
        staff.state = "walk";
      } else if (Math.hypot(staff.x - STAFF_HOME, staff.y - WALK_Y) > 2) {
        staff.tx = STAFF_HOME;
        staff.ty = WALK_Y;
        staff.state = "return";
      }
    }

    // --- NV di chuyển ---
    if (staff.state === "walk" && staff.target) {
      // bám theo khách nếu lưới quầy vừa đổi vị trí
      staff.tx = staff.target.x + 34;
      staff.ty = staff.target.y + 6;
    }
    if (staff.state === "walk" || staff.state === "return") {
      const dx = staff.tx - staff.x;
      const dy = staff.ty - staff.y;
      const d = Math.hypot(dx, dy);
      const step = STAFF_SPEED * dt;
      if (d <= step || d < 0.5) {
        staff.x = staff.tx;
        staff.y = staff.ty;
        if (staff.state === "walk") {
          staff.state = "serve";
          staff.serve = Math.max(0.05, serveTime);
          staff.t = 0;
        } else {
          staff.state = "idle";
        }
      } else {
        staff.x += (dx / d) * step;
        staff.y += (dy / d) * step;
      }
    }

    // --- phục vụ xong: trừ tồn trước, hết hàng đúng lúc này thì khách bỏ đi ---
    if (staff.state === "serve" && staff.target) {
      staff.t += dt;
      const c = staff.target;
      if (staff.t >= staff.serve) {
        if (consumeStock(state, c.target)) {
          const gain = onSale(c.target);
          if (Number(gain) > 0) {
            popups.push({ x: c.x, y: c.y - 26, txt: `+${fmtGain(gain)}`, life: 1 });
          }
        } else {
          // race: vừa hết hàng trong lúc phục vụ -> không cộng tiền
          popups.push({ x: c.x, y: c.y - 26, txt: "!", life: 0.8 });
        }
        c.phase = "out";
        c.tx = W + 44;
        c.ty = WALK_Y;
        staff.target = null;
        staff.t = 0;
        staff.state = "idle"; // frame sau: đón khách kế tiếp, không có ai thì tự đi về
      }
    }

    // --- khách ---
    for (const c of clients) {
      if (c.phase === "out") {
        c.x += dt * 120;
        c.y += (WALK_Y - c.y) * Math.min(1, dt * 4);
        continue;
      }
      if (c.phase === "wait" || c.phase === "serving") {
        moveTo(c, dt, 150); // trượt nhẹ nếu lưới quầy vừa đổi vị trí
        continue;
      }
      if (c.phase === "browse") {
        c.t -= dt;
        if (c.t <= 0) {
          popups.push({ x: c.x, y: c.y - 26, txt: "!", life: 0.8 });
          c.phase = "out";
          c.tx = W + 44;
          c.ty = WALK_Y;
        }
        continue;
      }
      const arrived = moveTo(c, dt, 170);
      if (!arrived) continue;
      if (c.phase === "browseIn") {
        c.phase = "browse";
        c.t = 1.2;
      } else if (c.noSlot) {
        // hết slot: nhìn quanh 1 nhịp rồi đi ra
        c.phase = "browse";
        c.t = 0.8;
      } else {
        c.phase = "wait";
        c.order = waitSeq++; // xếp hàng theo đúng lúc tới slot
      }
    }
    clients = clients.filter((c) => c.phase !== "out" || c.x < W + 48);

    for (const p of popups) { p.y -= dt * 26; p.life -= dt; }
    popups = popups.filter((p) => p.life > 0);
  }

  function roundRect(x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  function drawCounter(c) {
    const soldOut = c.unlocked && c.stock <= 0;
    const skin = c.unlocked ? (SHOP_SKINS[c.id] || SHOP_SKINS.pin) : CLOSED_SKIN;
    const x = c.x - c.w / 2;
    const y = c.y;

    // Quầy chưa mở: xám mờ. Quầy hết hàng: màu nhợt. Có hàng: bình thường.
    ctx.globalAlpha = !c.unlocked ? 0.7 : soldOut ? 0.45 : 1;
    ctx.fillStyle = skin.body;
    ctx.fillRect(x, y, c.w, c.h);
    ctx.fillStyle = skin.roof;
    ctx.fillRect(x, y, c.w, 11);
    if (c.unlocked) {
      ctx.fillStyle = skin.stripe;
      const step = c.w / 6;
      for (let i = 0; i < 6; i += 2) ctx.fillRect(x + i * step, y + 11, step, 5);
    }

    ctx.font = `${18}px ${EMOJI_FONT}`;
    ctx.textAlign = "left";
    ctx.globalAlpha = c.unlocked ? 1 : 0.85;
    ctx.fillText(em(SHOP_ICON[c.id] || "📦"), x + 6, y + c.h - 9);

    const ink = c.unlocked ? "#fff" : "#4b5563";
    ctx.fillStyle = ink;
    ctx.font = "11px system-ui";
    let name = c.name;
    if (ctx.measureText(name).width > c.w - 40) name = name.slice(0, 10) + "…";
    ctx.fillText(name, x + 30, y + 18);

    ctx.font = "9px system-ui";
    ctx.globalAlpha = c.unlocked ? 0.9 : 0.75;
    const status = !c.unlocked ? "Chưa mở" : soldOut ? "Hết hàng" : `Tồn: ${c.stock}`;
    ctx.fillText(status, x + 30, y + 31);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = "rgba(0,0,0,.15)";
    ctx.strokeRect(x + 0.5, y + 0.5, c.w - 1, c.h - 1);
  }

  // Chấm mờ đánh dấu slot chờ trước mỗi quầy đang bán được (mở + còn hàng).
  function drawSlots(counters) {
    for (const c of counters) {
      if (!c.unlocked || c.stock <= 0) continue;
      for (const s of c.slots) {
        ctx.beginPath();
        ctx.ellipse(s.x, s.y + 3, 7, 3.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(60,40,20,.16)";
        ctx.fill();
      }
    }
  }

  // Chỉ 1 sprite NV (hoặc chủ quán khi Lv.0) + badge cấp. Vẽ vector, không dùng emoji.
  function drawStaff(state) {
    ctx.globalAlpha = 1;
    const lv = staffLevel(state);
    drawPerson(staff.x, staff.y, "#fcd7b0", lv > 0 ? "#1d4ed8" : "#57534e", "chef");

    const txt = lv > 0 ? `Lv.${lv}` : "Chủ";
    ctx.font = "bold 10px system-ui";
    const bw = ctx.measureText(txt).width + 10;
    // gần mép phải thì lật badge sang trái để không bị cắt
    const bx = staff.x + 10 + bw > W ? staff.x - bw - 10 : staff.x + 10;
    const by = staff.y - 50;
    ctx.fillStyle = lv > 0 ? "#1d4ed8" : "#6b7280";
    roundRect(bx, by, bw, 14, 7);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.fillText(txt, bx + 5, by + 10);
  }

  function draw(state) {
    // tường trên + sàn + cửa
    ctx.fillStyle = "#efe0c0";
    ctx.fillRect(0, 0, W, WALL_H);
    ctx.fillStyle = "#f5e6c8";
    ctx.fillRect(0, WALL_H, W, H - WALL_H);
    ctx.fillStyle = "#c89b6a";
    ctx.fillRect(0, WALL_H + 6, W, H - WALL_H - 6);
    ctx.fillStyle = "#8b5e3c";
    ctx.fillRect(W - 28, 62, 28, WALK_Y - 62);
    ctx.fillStyle = "#5b3a1e";
    ctx.fillRect(W - 28, 62, 2, WALK_Y - 62);
    ctx.fillStyle = "#fff";
    ctx.font = "10px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("CỬA", W - 14, 118);
    ctx.fillStyle = "#5b3a1e";
    ctx.font = "bold 16px system-ui";
    ctx.textAlign = "left";
    ctx.fillText("TIỆM TẠP HÓA", 14, 28);

    const counters = buildCounters(state);
    for (const c of counters) drawCounter(c);
    drawSlots(counters);

    // khách: vector nét, vẽ từ trên xuống để khách dưới đè lên khách trên
    const bobT = Math.sin(Date.now() / 120) * 2;
    const sorted = [...clients].sort((a, b) => a.y - b.y);
    for (const c of sorted) {
      const bob = c.phase === "serving" ? bobT : 0;
      drawPerson(c.x, c.y + bob, c.skin || "#fcd7b0", c.shirt || "#e11d48", null);
    }
    // NV vẽ sau cùng để không bị khách che khi đứng cạnh phục vụ
    drawStaff(state);

    // thanh tiến độ phục vụ: nổi phía trên đầu khách, không đè lên quầy
    if (staff.state === "serve" && staff.target) {
      const c = staff.target;
      const pct = Math.max(0, Math.min(1, staff.t / staff.serve));
      const bw = 44;
      const bh = 7;
      const bx = c.x - bw / 2;
      const by = c.y - 42;
      ctx.fillStyle = "rgba(0,0,0,.35)";
      roundRect(bx, by, bw, bh, 4);
      ctx.fill();
      ctx.fillStyle = "#22c55e";
      roundRect(bx, by, Math.max(2, bw * pct), bh, 4);
      ctx.fill();
    }

    // popup tiền
    ctx.font = "bold 15px system-ui";
    ctx.textAlign = "center";
    for (const p of popups) {
      ctx.fillStyle = p.txt === "!" ? "#8a8a8a" : "#15803d";
      ctx.fillText(p.txt, p.x, p.y);
    }
    ctx.textAlign = "left";
  }

  // Chơi lại: dọn scene để khách cũ không đứng ở quầy đã mất.
  function reset() {
    clients = [];
    popups = [];
    staff.target = null;
    staff.state = "idle";
    staff.x = STAFF_HOME;
    staff.y = WALK_Y;
    staff.tx = STAFF_HOME;
    staff.ty = WALK_Y;
    staff.t = 0;
    staff.serve = 0;
    spawnT = 1.2;
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const st = getState();
    update(dt, st);
    draw(st);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  return { reset };
}
