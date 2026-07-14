// ============================================================================
//  chart.js — Biểu đồ đường realtime (Chart.js v4, CDN global `Chart`).
//  1 biểu đồ, 2 dataset: Nhiệt độ (°C, trục trái) + Độ ẩm (%RH, trục phải).
//  Buffer cuộn ~60 điểm gần nhất (theo CONTRACT mục 9: 30–60 điểm).
//
//  Lưu ý: Chart.js được nạp qua <script> CDN trong index.html nên có sẵn ở
//  biến toàn cục `window.Chart`. File này là ESM nhưng vẫn dùng global đó.
// ============================================================================

const MAX_POINTS = 60; // số điểm tối đa giữ lại trên biểu đồ (buffer cuộn)

let chart = null;

// ---------------------------------------------------------------------------
//  Vùng Deadband vẽ đè lên biểu đồ (2026-07-14): 2 đường ngang Min/Max (%RH,
//  trục yHum) + tô nhạt vùng giữa — nhìn vào thấy ngay thuật toán hoạt động:
//  độ ẩm chạm Min -> bật phun, vượt Max -> tắt. Giá trị do app.js#renderConfig
//  đẩy vào qua setDeadbandBand() mỗi khi /config đổi.
//  Chart.js v4 không có sẵn annotation (plugin rời) nên tự vẽ bằng inline plugin
//  — nhẹ hơn kéo thêm CDN chartjs-plugin-annotation.
// ---------------------------------------------------------------------------
const g_band = { min: null, max: null };

/** app.js gọi khi /config đổi. Truyền null để ẩn vùng. */
export function setDeadbandBand(min, max) {
  g_band.min = Number.isFinite(min) ? min : null;
  g_band.max = Number.isFinite(max) ? max : null;
  if (chart) chart.update();
}

// ---------------------------------------------------------------------------
//  Dải "máy phun ĐANG BẬT" (2026-07-14): tô nhạt các cột thời gian có mist=true
//  — nhìn biểu đồ thấy ngay chuỗi nhân-quả của Deadband: độ ẩm tụt dưới Min ->
//  dải phun xuất hiện -> đường độ ẩm ngóc lên -> chạm Max thì dải kết thúc.
//  g_mistFlags chạy song song với labels (push/shift cùng nhịp trong pushPoint).
// ---------------------------------------------------------------------------
const g_mistFlags = [];

const mistBandsPlugin = {
  id: "mistBands",
  beforeDatasetsDraw(c) {
    const x = c.scales.x;
    const area = c.chartArea;
    const n = c.data.labels.length;
    if (!x || !area || n < 1) return;

    const ctx = c.ctx;
    // Nửa khoảng cách giữa 2 điểm — để dải phủ trọn "cột" của mỗi điểm.
    const half = n > 1 ? (x.getPixelForValue(1) - x.getPixelForValue(0)) / 2 : (area.right - area.left) / 2;

    ctx.save();
    ctx.fillStyle = "rgba(56, 189, 248, 0.10)";
    let i = 0;
    while (i < n) {
      if (g_mistFlags[i] === true) {
        let j = i;
        while (j + 1 < n && g_mistFlags[j + 1] === true) j++; // gộp chuỗi liên tiếp thành 1 dải
        const x0 = Math.max(x.getPixelForValue(i) - half, area.left);
        const x1 = Math.min(x.getPixelForValue(j) + half, area.right);
        ctx.fillRect(x0, area.top, x1 - x0, area.bottom - area.top);
        i = j + 1;
      } else {
        i++;
      }
    }
    ctx.restore();
  }
};

const deadbandPlugin = {
  id: "deadbandBand",
  beforeDatasetsDraw(c) {
    const yHum = c.scales.yHum;
    const area = c.chartArea;
    if (!yHum || !area || g_band.min === null || g_band.max === null) return;

    const ctx = c.ctx;
    // Đổi giá trị %RH -> toạ độ pixel, kẹp trong vùng vẽ (band có thể tràn khi zoom trục).
    const yMaxPx = Math.max(yHum.getPixelForValue(g_band.max), area.top);
    const yMinPx = Math.min(yHum.getPixelForValue(g_band.min), area.bottom);
    if (yMinPx <= yMaxPx) return; // vùng nằm ngoài khung nhìn

    ctx.save();

    // Tô nhạt vùng ổn định (giữa Min và Max)
    ctx.fillStyle = "rgba(56, 189, 248, 0.07)";
    ctx.fillRect(area.left, yMaxPx, area.right - area.left, yMinPx - yMaxPx);

    // 2 đường nét đứt: Max (TẮT phun — xanh dương, khớp ô derivedMax) ở trên,
    // Min (BẬT phun — xanh lá, khớp ô derivedMin) ở dưới.
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;

    const drawLine = (yPx, color) => {
      if (yPx < area.top || yPx > area.bottom) return; // đường ngoài khung thì bỏ
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(area.left, yPx);
      ctx.lineTo(area.right, yPx);
      ctx.stroke();
    };
    drawLine(yHum.getPixelForValue(g_band.max), "rgba(56, 189, 248, 0.85)");
    drawLine(yHum.getPixelForValue(g_band.min), "rgba(52, 211, 153, 0.85)");

    // Nhãn nhỏ sát mép phải. Max đặt TRÊN đường Max, Min đặt DƯỚI đường Min — khi
    // Deadband mỏng (2 đường sát nhau) 2 nhãn vẫn tách về 2 phía, không đè lên nhau.
    // strokeText viền tối trước, fillText màu sau (halo) để đọc rõ trên nền lưới/dữ liệu.
    ctx.setLineDash([]);
    ctx.font = "600 11px Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(2, 6, 23, 0.85)";
    ctx.lineJoin = "round";
    const drawLabel = (yPx, text, color, above) => {
      // trên đường: chữ kết thúc 5px phía trên; dưới đường: baseline 13px phía dưới
      const yText = above ? yPx - 5 : yPx + 13;
      if (yText < area.top + 11 || yText > area.bottom - 2) return; // tràn khung thì bỏ
      ctx.strokeText(text, area.right - 6, yText);
      ctx.fillStyle = color;
      ctx.fillText(text, area.right - 6, yText);
    };
    drawLabel(yHum.getPixelForValue(g_band.max), "Max " + g_band.max + "% — tắt phun", "rgba(125, 211, 252, 0.95)", true);
    drawLabel(yHum.getPixelForValue(g_band.min), "Min " + g_band.min + "% — bật phun", "rgba(110, 231, 183, 0.95)", false);

    ctx.restore();
  }
};

/**
 * Khởi tạo biểu đồ trên <canvas id=...>.
 * @param {HTMLCanvasElement} canvasEl
 */
export function initChart(canvasEl) {
  const Chart = window.Chart;
  if (!Chart) {
    console.error("[chart] Chart.js chưa được nạp (kiểm tra <script> CDN).");
    return null;
  }

  const ctx = canvasEl.getContext("2d");

  chart = new Chart(ctx, {
    type: "line",
    plugins: [deadbandPlugin, mistBandsPlugin], // vùng Deadband + dải "đang phun" (xem khối trên)
    data: {
      labels: [], // nhãn thời gian (HH:MM:SS)
      datasets: [
        {
          label: "Nhiệt độ (°C)",
          data: [],
          yAxisID: "yTemp",
          borderColor: "#fb923c",                 // cam
          backgroundColor: "rgba(251, 146, 60, 0.15)",
          borderWidth: 2,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true
        },
        {
          label: "Độ ẩm (%RH)",
          data: [],
          yAxisID: "yHum",
          borderColor: "#38bdf8",                 // xanh dương
          backgroundColor: "rgba(56, 189, 248, 0.15)",
          borderWidth: 2,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true
        },
        {
          // Dataset "giả" KHÔNG có dữ liệu — chỉ để legend có ô chú thích cho dải
          // "máy phun BẬT" (mistBandsPlugin vẽ tay, Chart.js không tự thêm legend).
          label: "Máy phun BẬT",
          data: [],
          pointStyle: "rect",
          borderColor: "rgba(56, 189, 248, 0.5)",
          backgroundColor: "rgba(56, 189, 248, 0.25)"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: { color: "#e2e8f0", usePointStyle: true, boxWidth: 8 }
        },
        tooltip: {
          backgroundColor: "rgba(15,23,42,0.95)",
          borderColor: "rgba(148,163,184,0.3)",
          borderWidth: 1
        }
      },
      scales: {
        x: {
          ticks: { color: "#94a3b8", maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
          grid: { color: "rgba(148,163,184,0.08)" }
        },
        yTemp: {
          type: "linear",
          position: "left",
          title: { display: true, text: "°C", color: "#fb923c" },
          ticks: { color: "#fb923c" },
          grid: { color: "rgba(148,163,184,0.08)" },
          suggestedMin: 0,
          suggestedMax: 50
        },
        yHum: {
          type: "linear",
          position: "right",
          title: { display: true, text: "%RH", color: "#38bdf8" },
          ticks: { color: "#38bdf8" },
          grid: { drawOnChartArea: false }, // tránh 2 lưới chồng nhau
          suggestedMin: 0,
          suggestedMax: 100
        }
      }
    }
  });

  return chart;
}

/**
 * Thêm 1 điểm dữ liệu mới và cuộn buffer.
 * @param {number} temperature  °C
 * @param {number} humidity     %RH
 * @param {number} [timestamp]  epoch giây (nếu 0/không có → dùng giờ hiện tại)
 * @param {boolean|null} [mist] máy phun đang BẬT tại thời điểm này (tô dải nền);
 *                              null/undefined = chưa biết (chưa nhận /status) → không tô
 */
export function pushPoint(temperature, humidity, timestamp, mist) {
  if (!chart) return;

  // Nhãn thời gian: ưu tiên timestamp của thiết bị; nếu 0 → dùng giờ máy client.
  const d = timestamp && timestamp > 0 ? new Date(timestamp * 1000) : new Date();
  const p = (n) => String(n).padStart(2, "0");
  const label = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;

  chart.data.labels.push(label);
  chart.data.datasets[0].data.push(typeof temperature === "number" ? temperature : null);
  chart.data.datasets[1].data.push(typeof humidity === "number" ? humidity : null);
  g_mistFlags.push(mist === true); // chạy song song với labels (mistBandsPlugin đọc)

  // Cuộn: bỏ điểm cũ khi vượt MAX_POINTS.
  while (chart.data.labels.length > MAX_POINTS) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
    chart.data.datasets[1].data.shift();
    g_mistFlags.shift();
  }

  chart.update();
}

/** Xoá toàn bộ buffer (vd khi đăng xuất). */
export function clearChart() {
  if (!chart) return;
  chart.data.labels = [];
  chart.data.datasets[0].data = [];
  chart.data.datasets[1].data = [];
  g_mistFlags.length = 0;
  chart.update();
}
