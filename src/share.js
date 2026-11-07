// Xuất ảnh "khoe điểm": vẽ BXH + tài sản của người chơi lên canvas
// rồi share native (mobile) hoặc tải PNG (desktop).
import { getTop, getLocalRank, getName } from "./leaderboard.js";

const W = 1080;
const H = 1080;
const DOMAIN = "taphoa.playcenter.dpdns.org";

function fmt(n) {
  return Math.floor(Number(n) || 0).toLocaleString("vi-VN");
}

function roundRect(ctx, x, y, w, h, r) {
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

// Vẽ thẻ điểm, trả về canvas. Không đụng DOM game nên test được độc lập.
export function makeScoreCard(worth, top, rank, name) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");

  // nền
  ctx.fillStyle = "#141414";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#a16207";
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, W - 28, H - 28);

  // tiêu đề
  ctx.textAlign = "center";
  ctx.fillStyle = "#fbbf24";
  ctx.font = "bold 72px system-ui, sans-serif";
  ctx.fillText("TIỆM TẠP HÓA IDLE", W / 2, 140);
  ctx.fillStyle = "#9ca3af";
  ctx.font = "36px system-ui, sans-serif";
  ctx.fillText("Bảng xếp hạng chủ tiệm", W / 2, 200);

  // khung người chơi
  ctx.fillStyle = "#3a2f10";
  roundRect(ctx, 90, 250, W - 180, 210, 28);
  ctx.fill();
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 4;
  roundRect(ctx, 90, 250, W - 180, 210, 28);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 56px system-ui, sans-serif";
  ctx.fillText(String(name || "Chủ tiệm").slice(0, 20), W / 2, 335);
  ctx.fillStyle = "#fbbf24";
  ctx.font = "bold 64px system-ui, sans-serif";
  ctx.fillText(fmt(worth) + " đ", W / 2, 415);

  // top 5
  ctx.textAlign = "left";
  const rows = (top || []).slice(0, 5);
  rows.forEach((s, i) => {
    const y = 530 + i * 84;
    const me = s.name === name;
    ctx.fillStyle = me ? "#3a2f10" : "#1e1e1e";
    roundRect(ctx, 90, y, W - 180, 68, 14);
    ctx.fill();
    ctx.fillStyle = me ? "#fbbf24" : "#9ca3af";
    ctx.font = "bold 40px system-ui, sans-serif";
    ctx.fillText("#" + (i + 1), 120, y + 47);
    ctx.fillStyle = "#ffffff";
    ctx.font = "40px system-ui, sans-serif";
    let label = String(s.name || "?");
    if (label.length > 14) label = label.slice(0, 13) + "…";
    ctx.fillText(label, 230, y + 47);
    ctx.fillStyle = "#fbbf24";
    ctx.font = "bold 40px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(fmt(s.netWorth) + " đ", W - 120, y + 47);
    ctx.textAlign = "left";
  });

  // chân thẻ
  ctx.textAlign = "center";
  ctx.fillStyle = "#9ca3af";
  ctx.font = "34px system-ui, sans-serif";
  const rankTxt = rank && rank > 0 ? "Hạng của tôi: #" + rank + "  •  " : "";
  ctx.fillText(rankTxt + "Chơi miễn phí tại", W / 2, 990);
  ctx.fillStyle = "#93c5fd";
  ctx.font = "bold 38px system-ui, sans-serif";
  ctx.fillText(DOMAIN, W / 2, 1035);

  return c;
}

export async function shareScore(worth) {
  const name = getName();
  const rank = getLocalRank(Math.floor(worth));
  const top = getTop(5);
  const canvas = makeScoreCard(Math.floor(worth), top, rank, name);
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("Không tạo được ảnh. Thử lại.");
  const file = new File([blob], "taphoa-bxh.png", { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({
      files: [file],
      title: "Tiệm Tạp Hóa Idle",
      text: "Tài sản của tôi: " + fmt(worth) + " đ. Vào chơi chung đi!",
    });
    return "shared";
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "taphoa-bxh.png";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return "downloaded";
}
