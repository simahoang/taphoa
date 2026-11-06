// BXH: local (luôn chạy) + online Supabase (chỉ khi đã đăng nhập).
// Mỗi user có đúng 1 dòng scores (unique user_id); chưa login thì chỉ lưu local.
import { authFetch, getSession, getUser } from "./auth.js";
import { SCORE_TABLE } from "./supabase.js";

const KEY = "game3_leaderboard_v3"; // reset theo kinh tế v4 (giữ game3_row_id để ghi đè dòng online cũ)
const DEFAULT_NAME = "Chủ tiệm";
const MAX_SCORES = 50;
const TOP_SHOW = 5;
const SUBMIT_MIN_GAP = 30000; // tối đa 1 lần submit online / 30s (chống spam)

let cache = null;
let onlineTop = []; // top kéo từ Supabase, merge khi hiển thị
let lastSubmitAt = 0;

function read() {
  if (cache) return cache;
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "{}");
    cache = {
      name: typeof d.name === "string" && d.name.trim() ? d.name : DEFAULT_NAME,
      nameEdited: d.nameEdited === true,
      scores: Array.isArray(d.scores)
        ? d.scores.filter((s) => s && typeof s.netWorth === "number" && s.name)
        : [],
    };
    return cache;
  } catch {
    cache = { name: DEFAULT_NAME, nameEdited: false, scores: [] };
    return cache;
  }
}

function write(data) {
  cache = data;
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
}

export function getName() {
  return read().name;
}

// Tên mặc định = phần trước @ của email; không cho sửa tay để mỗi user 1 tên 1 dòng.
export function nameFromEmail(email) {
  const local = String(email || "").split("@")[0].trim();
  return (local || DEFAULT_NAME).slice(0, 20);
}

// Gọi sau khi login: chỉ đặt tên từ email khi người chơi chưa tự sửa tên.
export function initNameFromEmail(email) {
  const d = read();
  if (d.nameEdited) return d.name;
  const clean = nameFromEmail(email);
  if (clean && clean !== d.name) {
    d.name = clean;
    write(d);
  }
  return d.name;
}

// gộp local + online, mỗi tên giữ điểm cao nhất (điểm = tài sản ròng)
export function getTop(n = TOP_SHOW) {
  const best = new Map();
  for (const s of read().scores) {
    const cur = best.get(s.name);
    if (!cur || s.netWorth > cur.netWorth) best.set(s.name, s);
  }
  for (const s of onlineTop) {
    const cur = best.get(s.name);
    if (!cur || s.netWorth > cur.netWorth) best.set(s.name, s);
  }
  return [...best.values()].sort((a, b) => b.netWorth - a.netWorth).slice(0, n);
}

// hạng của điểm hiện tại trong bảng gộp (1-based, null nếu chưa có điểm)
export function getLocalRank(netWorth) {
  const score = Number(netWorth);
  if (!Number.isFinite(score)) return null;
  const list = getTop(MAX_SCORES);
  if (!list.length) return 1;
  return list.filter((s) => s.netWorth > score).length + 1;
}

function saveLocal(score, clean) {
  const d = read();
  const old = d.scores.find((s) => s.name === clean);
  if (!old || score > old.netWorth) {
    d.scores = d.scores.filter((s) => s.name !== clean);
    d.scores.push({ name: clean, netWorth: score, at: Date.now() });
    d.scores.sort((a, b) => b.netWorth - a.netWorth);
    d.scores = d.scores.slice(0, MAX_SCORES);
    write(d);
  }
}

// Chưa đăng nhập -> bỏ qua êm thấm (không log lỗi, không chặn game).
function currentUserId() {
  const s = getSession();
  return (s && s.user && s.user.id) || "";
}

// kéo top online về cache (lỗi mạng / chưa login thì bỏ qua, giữ local)
export async function refreshOnlineTop() {
  try {
    const rows = await authFetch(
      "/rest/v1/" + SCORE_TABLE + "?select=player_name,total_earned&order=total_earned.desc&limit=50"
    );
    if (Array.isArray(rows)) {
      onlineTop = rows
        .filter((r) => r && typeof r.total_earned === "number" && r.player_name)
        .map((r) => ({ name: String(r.player_name), netWorth: Math.floor(r.total_earned) }));
    }
  } catch (e) {
    console.info("[leaderboard] online top unavailable, using local", String((e && e.message) || e));
  }
  return getTop();
}

export async function submitScore(worth, name = getName()) {
  const score = Math.floor(Number(worth) || 0);
  const clean = String(name || "").trim().slice(0, 20) || getName();
  saveLocal(score, clean);

  const done = () => ({ name: clean, totalEarned: score, rank: getLocalRank(score), scores: getTop() });

  // Chưa login (hoặc session đã bị xóa) -> chỉ local.
  const session = getSession();
  if (!session || !session.access_token) return done();

  // throttle online: chỉ submit khi quá 30s kể từ lần trước
  const now = Date.now();
  if (now - lastSubmitAt < SUBMIT_MIN_GAP) return done();
  lastSubmitAt = now;

  try {
    let uid = currentUserId();
    if (!uid) {
      // Session cũ thiếu user (hiếm) -> lấy lại từ /auth/v1/user.
      try { await getUser(); } catch {}
      uid = currentUserId();
    }
    if (!uid) throw new Error("missing user id");

    const body = {
      player_name: clean,
      total_earned: score,
      updated_at: new Date().toISOString(),
      user_id: uid,
    };

    // Mỗi user 1 dòng: tìm theo user_id, có thì PATCH, chưa có thì POST.
    const found = await authFetch(
      "/rest/v1/" + SCORE_TABLE + "?select=id,total_earned&user_id=eq." + encodeURIComponent(uid) + "&limit=1"
    );
    if (Array.isArray(found) && found[0] && found[0].id) {
      await authFetch(
        "/rest/v1/" + SCORE_TABLE + "?id=eq." + encodeURIComponent(found[0].id) +
          "&select=id,player_name,total_earned",
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(body),
        }
      );
    } else {
      await authFetch("/rest/v1/" + SCORE_TABLE + "?select=id,player_name,total_earned", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(body),
      });
    }
  } catch (e) {
    console.info("[leaderboard] submit online failed, kept local", String((e && e.message) || e));
  }

  await refreshOnlineTop();
  return done();
}
