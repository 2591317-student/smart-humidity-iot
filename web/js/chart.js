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
 */
export function pushPoint(temperature, humidity, timestamp) {
  if (!chart) return;

  // Nhãn thời gian: ưu tiên timestamp của thiết bị; nếu 0 → dùng giờ máy client.
  const d = timestamp && timestamp > 0 ? new Date(timestamp * 1000) : new Date();
  const p = (n) => String(n).padStart(2, "0");
  const label = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;

  chart.data.labels.push(label);
  chart.data.datasets[0].data.push(typeof temperature === "number" ? temperature : null);
  chart.data.datasets[1].data.push(typeof humidity === "number" ? humidity : null);

  // Cuộn: bỏ điểm cũ khi vượt MAX_POINTS.
  while (chart.data.labels.length > MAX_POINTS) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
    chart.data.datasets[1].data.shift();
  }

  chart.update();
}

/** Xoá toàn bộ buffer (vd khi đăng xuất). */
export function clearChart() {
  if (!chart) return;
  chart.data.labels = [];
  chart.data.datasets[0].data = [];
  chart.data.datasets[1].data = [];
  chart.update();
}
