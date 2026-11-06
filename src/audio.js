// Âm thanh nhỏ bằng WebAudio (Oscillator), không dùng file ngoài.
// AudioContext chỉ tạo ở lần chạm đầu để không bị chặn trên mobile.
const MUTE_KEY = "game3_muted";
let ctx = null;
let muted = readMuted();

function readMuted() {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}

function ac() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq, dur, { type = "sine", vol = 0.06, delay = 0, to = 0 } = {}) {
  if (muted) return;
  const c = ac();
  if (!c) return;
  const t = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

// tiếng click khi tap / mua quầy
export function playClick() {
  tone(420, 0.05, { type: "square", vol: 0.035, to: 620 });
}

// tiếng "ting" khi khách mua xong
export function playSale() {
  tone(880, 0.09, { vol: 0.06 });
  tone(1320, 0.16, { vol: 0.05, delay: 0.07 });
}

export function isMuted() { return muted; }

export function toggleMuted() {
  muted = !muted;
  try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch {}
  if (!muted) tone(660, 0.08, { vol: 0.04 }); // nghe thử khi bật lại
  return muted;
}
