// Supabase Auth REST thuần (không SDK): OTP email + Google OAuth + refresh token.
// Session lưu ở localStorage "game3_session":
//   { access_token, refresh_token, user, expires_at }
import { SUPABASE_URL, SUPABASE_KEY } from "./supabase.js";

const SESSION_KEY = "game3_session";
const AUTH_BASE = SUPABASE_URL + "/auth/v1";
const TIMEOUT_MS = 12000;

let refreshPromise = null;

// ---------- session storage ----------

function readRaw() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s !== "object" || !s.access_token) return null;
    return s;
  } catch {
    return null;
  }
}

function writeSession(session) {
  const now = Date.now();
  const expiresIn = Number(session.expires_in) || 3600;
  const out = {
    access_token: String(session.access_token || ""),
    refresh_token: String(session.refresh_token || session.refreshToken || ""),
    user: session.user || null,
    expires_at: Number(session.expires_at) || now + expiresIn * 1000,
  };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(out)); } catch {}
  return out;
}

export function getSession() {
  return readRaw();
}

// Token còn hạn (trừ hao 30s) và có access_token.
export function isLoggedIn() {
  const s = readRaw();
  return !!(s && s.access_token && Number(s.expires_at) > Date.now() + 30000);
}

// ---------- helpers ----------

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function friendly(msg, status) {
  const m = String(msg || "").toLowerCase();
  if (status === 429) return "Bạn thao tác quá nhanh. Chờ khoảng 1 phút rồi thử lại.";
  if (m.includes("rate limit") || m.includes("too many")) return "Quá nhiều lần thử. Chờ ít phút rồi thử lại.";
  if (m.includes("expired")) return "Mã đã hết hạn. Bấm \"Gửi mã\" để nhận mã mới.";
  if (m.includes("invalid") && (m.includes("token") || m.includes("otp") || m.includes("email"))) {
    return "Mã OTP không đúng hoặc đã hết hạn.";
  }
  if (m.includes("signup") && (m.includes("disabled") || m.includes("not allowed"))) {
    return "Đăng ký bằng email đang bị tắt trên Supabase.";
  }
  if (m.includes("provider") && (m.includes("not enabled") || m.includes("unsupported"))) {
    return "Google chưa được bật trên Supabase.";
  }
  if (m.includes("email address") && m.includes("invalid")) return "Email không hợp lệ.";
  return String(msg || ("Lỗi máy chủ (" + status + ")"));
}

async function fetchJson(url, opt = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { ...opt, signal: ctl.signal });
  } catch (e) {
    const err = new Error("Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.");
    err.network = true;
    err.cause = e;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!res.ok) {
    const raw =
      (data && (data.msg || data.error_description || data.message || data.error)) ||
      ("Lỗi máy chủ (" + res.status + ")");
    const err = new Error(friendly(raw, res.status));
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

// Gọi endpoint auth (luôn kèm apikey, không kèm Bearer cũ).
function authReq(path, opt = {}) {
  return fetchJson(AUTH_BASE + path, {
    ...opt,
    headers: {
      apikey: SUPABASE_KEY,
      "Content-Type": "application/json",
      ...(opt.headers || {}),
    },
  });
}

// ---------- OTP email ----------

export async function sendOtp(email) {
  const clean = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error("Email chưa hợp lệ.");
  return authReq("/otp", {
    method: "POST",
    body: JSON.stringify({ email: clean, create_user: true }),
  });
}

export async function verifyOtp(email, code) {
  const clean = normalizeEmail(email);
  const token = String(code || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error("Email chưa hợp lệ.");
  if (!token) throw new Error("Nhập mã OTP trong email.");
  const data = await authReq("/verify", {
    method: "POST",
    body: JSON.stringify({ email: clean, token, type: "email" }),
  });
  if (!data || !data.access_token) throw new Error("Không nhận được phiên đăng nhập. Thử lại.");
  return writeSession(data);
}

// ---------- Google OAuth ----------

// Redirect sang Supabase; callback quay lại đúng URL game kèm #access_token=...
export function signInWithGoogle() {
  const redirectTo = location.origin + location.pathname;
  const url =
    AUTH_BASE +
    "/authorize?provider=google&redirect_to=" +
    encodeURIComponent(redirectTo);
  location.href = url;
}

function clearHash() {
  try {
    history.replaceState(null, "", location.pathname + location.search);
  } catch {
    // ignore
  }
}

// Parse #access_token=...&refresh_token=... sau redirect Google.
// Trả session hoặc null nếu URL không phải callback. Lỗi OAuth -> throw.
export async function handleAuthCallback() {
  const rawHash = String(location.hash || "").replace(/^#/, "");
  if (!rawHash) return null;

  const params = new URLSearchParams(rawHash);
  const hasAuth =
    params.has("access_token") ||
    params.has("error") ||
    params.has("error_description");
  if (!hasAuth) return null;

  clearHash();

  const oauthErr = params.get("error_description") || params.get("error");
  if (oauthErr) throw new Error(friendly(oauthErr, 400));

  const accessToken = params.get("access_token");
  if (!accessToken) return null;

  let session = writeSession({
    access_token: accessToken,
    refresh_token: params.get("refresh_token") || "",
    expires_in: Number(params.get("expires_in")) || 3600,
    user: null,
  });

  // Implicit flow chỉ trả token, chưa có user -> hỏi /auth/v1/user.
  try {
    const user = await getUser();
    if (user) {
      session.user = user;
      session = writeSession(session);
    }
  } catch (e) {
    if (e && e.status === 401) {
      await signOut();
      throw new Error("Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.");
    }
    // Lỗi mạng: giữ token, sẽ thử lại khi có mạng.
  }

  return session;
}

// ---------- refresh / user / logout ----------

async function doRefresh() {
  const current = readRaw();
  if (!current || !current.refresh_token) {
    throw new Error("Chưa có phiên đăng nhập để gia hạn.");
  }
  const data = await authReq("/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: current.refresh_token }),
  });
  if (!data || !data.access_token) throw new Error("Không gia hạn được phiên đăng nhập.");
  return writeSession({
    ...data,
    // Refresh token có thể được Supabase xoay vòng; giữ cái cũ nếu response thiếu.
    refresh_token: data.refresh_token || current.refresh_token,
    user: data.user || current.user,
  });
}

export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

function invalidSessionError() {
  const err = new Error("Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.");
  err.status = 401;
  return err;
}

export async function getUser() {
  try {
    const user = await authFetch("/auth/v1/user", { method: "GET" });
    const s = readRaw();
    if (s && user && user.id) {
      s.user = user;
      writeSession(s);
    }
    return user;
  } catch (e) {
    // GoTrue trả 403 (không phải 401) khi JWT sai/hết hạn.
    if (e && e.status === 403) {
      try {
        await refreshSession();
        const user = await authFetch("/auth/v1/user", { method: "GET" });
        const s = readRaw();
        if (s && user && user.id) {
          s.user = user;
          writeSession(s);
        }
        return user;
      } catch {
        signOut();
        throw invalidSessionError();
      }
    }
    if (e && e.status === 401) {
      signOut();
      throw invalidSessionError();
    }
    throw e;
  }
}

export async function signOut() {
  const s = readRaw();
  try { localStorage.removeItem(SESSION_KEY); } catch {}
  refreshPromise = null;
  if (!s || !s.access_token) return;
  try {
    await fetchJson(AUTH_BASE + "/logout", {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: "Bearer " + s.access_token,
      },
    });
  } catch {
    // Token có thể đã hết hạn: local đã xóa là đủ.
  }
}

// ---------- fetch có auth ----------

// path tính từ SUPABASE_URL, ví dụ "/rest/v1/scores?...".
// Chưa login -> dùng apikey (chỉ đọc BXH công khai). 401 -> refresh 1 lần rồi retry.
export async function authFetch(path, opt = {}) {
  const session = readRaw();
  const token = session && session.access_token ? session.access_token : SUPABASE_KEY;
  const url = /^https?:/i.test(path) ? path : SUPABASE_URL + path;

  const doFetch = (bearer) => {
    const headers = { apikey: SUPABASE_KEY, ...(opt.headers || {}) };
    if (bearer) headers.Authorization = "Bearer " + bearer;
    if (opt.body !== undefined && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    return fetchJson(url, { ...opt, headers });
  };

  try {
    return await doFetch(token);
  } catch (e) {
    if (!e || e.status !== 401 || !session || !session.access_token) throw e;

    let next;
    try {
      next = await refreshSession();
    } catch {
      signOut(); // xóa local ngay, không chờ gọi logout qua mạng
      const err = new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
      err.status = 401;
      throw err;
    }

    try {
      return await doFetch(next.access_token);
    } catch (e2) {
      if (e2 && e2.status === 401) {
        signOut();
        const err = new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
        err.status = 401;
        throw err;
      }
      throw e2;
    }
  }
}
