// Cấu hình Supabase cho Auth + BXH online.
// Publishable key là key CÔNG KHAI theo thiết kế (nhúng trong frontend được),
// bảo mật thật nằm ở RLS + CHECK constraint phía server.
//
// Mọi request auth/BXH đi qua authFetch() trong src/auth.js để tự gắn
// Bearer access_token của user và refresh khi hết hạn.
export const SUPABASE_URL = "https://mofssarusctfracdmgsx.supabase.co";
export const SUPABASE_KEY = "sb_publishable_NRc3U8AHzp2wL-MJy1bu2g_Uy1R4y8J";

// Phân biệt môi trường KHÔNG cần file config tay (tránh deploy đè nhầm):
// localhost/127.0.0.1 + file:// => dev (bảng scores_dev),
// domain thật => prod (bảng scores).
// Override khi cần: ?env=dev | ?env=prod, hoặc localStorage "game3_env".
function detectEnv() {
  try {
    const q = new URLSearchParams(location.search).get("env");
    if (q === "dev" || q === "prod") return q;
    const forced = localStorage.getItem("game3_env");
    if (forced === "dev" || forced === "prod") return forced;
    const h = location.hostname;
    if (h === "localhost" || h === "127.0.0.1" || h === "" || location.protocol === "file:") return "dev";
    return "prod";
  } catch {
    return "prod";
  }
}

export const APP_ENV = detectEnv();
export const SCORE_TABLE = APP_ENV === "prod" ? "scores" : "scores_dev";
