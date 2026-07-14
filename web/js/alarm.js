// ============================================================================
//  alarm.js — Cảnh báo cạn nước (theo CONTRACT mục 2 & yêu cầu nâng cao).
//  /status/tank là SỐ 0-3 (số đầu dò trong 3 đầu dò M2/M3/M4 đang ngập nước).
//  Khi tank === 0 (rất thấp/cạn hẳn):
//    - Hiện hộp đỏ NHẤP NHÁY (toggle class .alarm-active trên #alarmBox).
//    - Phát tiếng bíp lặp lại bằng Web Audio API.
//  Khi tank > 0 (1/2/3) → ẩn hộp + tắt bíp. Mức 1 ("thấp") chỉ hiện badge vàng nhẹ
//  trên panel trạng thái (xem app.js#renderStatus), KHÔNG kích hoạt hộp cảnh báo này.
//
//  Lưu ý trình duyệt: AudioContext chỉ chạy sau khi người dùng tương tác
//  (click). app.js gọi armAudio() trong sự kiện click đầu tiên để "mở khoá".
// ============================================================================

let audioCtx = null;       // AudioContext dùng chung
let beepTimer = null;      // setInterval lặp tiếng bíp
let alarmOn = false;       // trạng thái cảnh báo hiện tại
let alarmBoxEl = null;     // phần tử hộp cảnh báo

/**
 * Gắn phần tử hộp cảnh báo (gọi 1 lần lúc init).
 * @param {HTMLElement} boxEl
 */
export function initAlarm(boxEl) {
  alarmBoxEl = boxEl;
  if (alarmBoxEl) alarmBoxEl.hidden = true;
}

/**
 * "Mở khoá" âm thanh — gọi trong 1 sự kiện click của người dùng (autoplay policy).
 * Tạo/đánh thức AudioContext để sau này bíp được ngay.
 */
export function armAudio() {
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume();
    }
  } catch (e) {
    console.warn("[alarm] Không khởi tạo được AudioContext:", e);
  }
}

/** Phát 1 tiếng bíp ngắn (~0.18s) bằng oscillator. */
function beepOnce() {
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "square";
    osc.frequency.value = 880;                 // nốt cao, dễ nghe
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.18);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
  } catch (e) {
    // Bỏ qua lỗi âm thanh (vd context bị suspend); phần hiển thị vẫn hoạt động.
  }
}

/** Bật cảnh báo: hiện hộp nhấp nháy + bíp lặp. */
function startAlarm() {
  if (alarmOn) return;
  alarmOn = true;

  if (alarmBoxEl) {
    alarmBoxEl.hidden = false;
    alarmBoxEl.classList.add("alarm-active");
  }

  // Bíp ngay + lặp mỗi 0.9s.
  beepOnce();
  beepTimer = setInterval(beepOnce, 900);
}

/** Tắt cảnh báo: ẩn hộp + dừng bíp. */
function stopAlarm() {
  if (!alarmOn) return;
  alarmOn = false;

  if (alarmBoxEl) {
    alarmBoxEl.classList.remove("alarm-active");
    alarmBoxEl.hidden = true;
  }

  if (beepTimer) {
    clearInterval(beepTimer);
    beepTimer = null;
  }
}

/**
 * Cập nhật cảnh báo theo mức nước bồn chứa.
 * Gọi mỗi khi /status thay đổi.
 * @param {number|undefined} tank  0 (rất thấp) .. 3 (đầy) — xem CONTRACT mục 2
 */
export function updateAlarm(tank) {
  if (tank === 0) startAlarm();
  else stopAlarm();
}

/** Dọn dẹp khi đăng xuất. */
export function disposeAlarm() {
  stopAlarm();
}
