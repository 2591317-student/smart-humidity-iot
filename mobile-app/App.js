// ============================================================================
//  App.js — App native (Expo/Android) cấu hình mạng cho ESP, port lại từ
//  mobile/js/app.js (PWA) vì PWA HTTPS bị trình duyệt chặn (mixed-content) khi
//  gọi ESP HTTP — app native không bị chặn kiểu này (xem docs/CONTRACT.md).
//
//  Cùng 1 hợp đồng REST với ESP (docs/CONTRACT.md mục 5):
//    POST /provision {ssid?, password?, peerMac?} -> {ok, message, mac}
//    GET  /provision -> {id, role, mac, fw, ssid, hasPassword, peerMac, provisioned}
//    POST /reboot {action:true} -> {ok, message}
//  Tin theo HTTP status (2xx) là thành công chính, không bắt buộc đúng JSON
//  (board thật có thể trả JSON lệch chuẩn — xem "code phân kỳ" trong CONTRACT.md).
// ============================================================================

import { useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  TextInput,
  Switch,
  Pressable,
  Modal,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard"; // copy JSON chi tiết (RN core đã bỏ Clipboard)

const DEFAULT_IP = "192.168.4.1"; // IP SoftAP mặc định của ESP (CONTRACT mục 5)

// ----------------------------------------------------------------------------
// Hộp JSON/chi tiết kỹ thuật:
//  - Text luôn `selectable` -> long-press cho popup chọn/copy native của hệ
//    điều hành (Android/iOS), không chỉ copy nguyên khối qua nút bấm.
//  - Nếu parse được JSON object, tách từng field ra 1 dòng riêng kèm nút
//    copy riêng cho field đó; nếu không (vd. text lỗi) thì hiện nguyên khối.
//  - Nút "Sao chép tất cả" luôn có để copy nguyên văn cả khối trong 1 chạm.
// ----------------------------------------------------------------------------
function RawJsonBox({ text }) {
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedKey, setCopiedKey] = useState(null);

  async function copy(value, key) {
    try {
      await Clipboard.setStringAsync(String(value));
      if (key === undefined) {
        setCopiedAll(true);
        setTimeout(() => setCopiedAll(false), 1600);
      } else {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1600);
      }
    } catch (_) {
      // clipboard lỗi (hiếm) — im lặng, người dùng bấm lại được
    }
  }

  let fields = null;
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      fields = Object.entries(obj);
    }
  } catch (_) {
    // không phải JSON object hợp lệ -> giữ fields = null, hiện nguyên khối bên dưới
  }

  return (
    <View style={styles.rawBox}>
      <Pressable onPress={() => copy(text)} style={[styles.copyBtn, copiedAll && styles.copyBtnDone]} hitSlop={8}>
        <Text style={[styles.copyBtnText, copiedAll && styles.copyBtnTextDone]}>
          {copiedAll ? "✓ Đã chép" : "⧉ Sao chép tất cả"}
        </Text>
      </Pressable>
      {fields ? (
        fields.map(([key, value]) => {
          const valueText = typeof value === "string" ? value : JSON.stringify(value);
          const isCopied = copiedKey === key;
          return (
            <View key={key} style={styles.rawFieldRow}>
              <Text style={styles.rawFieldText} selectable>
                <Text style={styles.rawFieldKey}>{key}: </Text>
                {valueText}
              </Text>
              <Pressable onPress={() => copy(valueText, key)} style={styles.rawFieldCopyBtn} hitSlop={8}>
                <Text style={[styles.rawFieldCopyText, isCopied && styles.textOk]}>{isCopied ? "✓" : "⧉"}</Text>
              </Pressable>
            </View>
          );
        })
      ) : (
        <Text style={styles.rawText} selectable>
          {text}
        </Text>
      )}
    </View>
  );
}

// ----------------------------------------------------------------------------
// Banner thông báo thân thiện — icon tròn + tóm tắt dễ đọc, chi tiết kỹ thuật
// (JSON thô) gấp lại mặc định, bấm mới xem — đỡ trông như log debug.
// ----------------------------------------------------------------------------
function StatusBanner({ ok, summary, raw }) {
  const [showRaw, setShowRaw] = useState(false);
  return (
    <View style={[styles.banner, ok ? styles.bannerOk : styles.bannerErr]}>
      <View style={styles.bannerRow}>
        <View style={[styles.bannerIcon, ok ? styles.bgOk : styles.bgErr]}>
          <Text style={[styles.bannerIconText, ok ? styles.textOk : styles.textErr]}>
            {ok ? "✓" : "✕"}
          </Text>
        </View>
        <Text style={styles.bannerText}>{summary}</Text>
      </View>
      {raw ? (
        <Pressable onPress={() => setShowRaw((v) => !v)} style={styles.bannerToggleRow}>
          <Text style={styles.bannerToggle}>{showRaw ? "▲ Ẩn chi tiết kỹ thuật" : "▼ Xem chi tiết kỹ thuật"}</Text>
        </Pressable>
      ) : null}
      {raw && showRaw ? <RawJsonBox text={raw} /> : null}
    </View>
  );
}

export default function App() {
  // ---- Form state ----
  const [sendWifi, setSendWifi] = useState(true);
  const [sendMac, setSendMac] = useState(true);
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [peerMac, setPeerMac] = useState("");

  // ---- Đích gửi (ESP thật hoặc mock-esp-server để test) ----
  const [testMode, setTestMode] = useState(false);
  const [ip, setIp] = useState(DEFAULT_IP);
  const [mockUrl, setMockUrl] = useState("http://172.16.6.153:8080"); // IP LAN laptop đang chạy mock-esp-server — đổi nếu chạy trên máy khác

  // ---- Quét QR ----
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanHandled, setScanHandled] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  // ---- Trạng thái gửi / kết quả ----
  const [submitting, setSubmitting] = useState(false);
  const [rebooting, setRebooting] = useState(false);
  const [rebootResult, setRebootResult] = useState(null); // {ok, summary, raw}
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null); // {ok, summary, raw}
  const [result, setResult] = useState(null); // {ok, title, message, raw}

  function getTargetBase() {
    if (testMode) return mockUrl.trim().replace(/\/+$/, "");
    return "http://" + (ip.trim() || DEFAULT_IP);
  }

  // --------------------------------------------------------------------
  // Quét QR — payload theo CONTRACT mục 6: {"id","role","ap","ip","mac"}.
  // Chỉ lấy field "mac", giống hệt qr.js bên PWA.
  // --------------------------------------------------------------------
  function openScanner() {
    if (!permission?.granted) {
      requestPermission();
    }
    setScanHandled(false);
    setScannerOpen(true);
  }

  function onBarcodeScanned({ data }) {
    if (scanHandled) return; // tránh xử lý nhiều lần cho cùng 1 lần quét
    setScanHandled(true);

    let mac = "";
    try {
      const obj = JSON.parse(String(data).trim());
      if (obj && obj.mac) mac = String(obj.mac).toUpperCase();
    } catch (_) {
      // QR không phải JSON hợp lệ — bỏ qua, để người dùng tự gõ tay.
    }

    setScannerOpen(false);
    if (mac) {
      setPeerMac(mac);
      Alert.alert("Đã quét QR", "Đã điền MAC: " + mac);
    } else {
      Alert.alert("QR không hợp lệ", "QR không chứa MAC — vui lòng nhập tay.");
    }
  }

  // --------------------------------------------------------------------
  // Gửi cấu hình — POST /provision (partial update theo 2 switch WiFi/MAC).
  // --------------------------------------------------------------------
  async function onSubmitProvision() {
    if (!sendWifi && !sendMac) {
      Alert.alert("Chưa chọn mục nào", "Hãy bật ít nhất một mục (WiFi hoặc MAC) để gửi.");
      return;
    }
    if (sendWifi && !ssid.trim()) {
      Alert.alert("Thiếu thông tin", "Đã bật gửi WiFi — vui lòng nhập tên WiFi (SSID).");
      return;
    }

    const payload = {};
    if (sendWifi) {
      payload.ssid = ssid.trim();
      payload.password = password; // không trim — mật khẩu có thể có khoảng trắng
    }
    if (sendMac && peerMac.trim()) payload.peerMac = peerMac.trim();

    const url = getTargetBase() + "/provision";
    setSubmitting(true);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let bodyJson = null;
      try {
        bodyJson = JSON.parse(await resp.text());
      } catch (_) {
        // body không phải JSON — không sao, tin theo HTTP status (xem dưới).
      }

      // Tin theo HTTP status (2xx) là tín hiệu thành công chính — board thật ngoài
      // hiện trường có thể trả JSON lệch chuẩn hoặc không có body hợp lệ dù đã
      // lưu thành công (xem docs/CONTRACT.md, "code phân kỳ").
      if (resp.ok) {
        const msg = (bodyJson && bodyJson.message) || "Đã lưu cấu hình. Thiết bị sẽ khởi động lại.";
        const macInfo = bodyJson && bodyJson.mac ? "\nMAC thiết bị: " + bodyJson.mac : "";
        setResult({ ok: true, title: "Cấu hình thành công!", message: msg + macInfo, raw: bodyJson });
      } else {
        const detail =
          (bodyJson && (bodyJson.message || bodyJson.error)) ||
          "HTTP " + resp.status + " " + resp.statusText;
        setResult({ ok: false, title: "Thiết bị từ chối cấu hình", message: detail, raw: bodyJson });
      }
    } catch (err) {
      setResult({
        ok: false,
        title: "Không gửi được tới thiết bị",
        message:
          "Lỗi: " + (err && err.message ? err.message : String(err)) +
          "\nĐích: " + url +
          "\n\nKiểm tra: điện thoại đã nối đúng WiFi của ESP chưa? IP đúng chưa (mặc định " +
          DEFAULT_IP + ")? Nếu test: mock-esp-server đã chạy và đúng IP LAN chưa?",
        raw: null,
      });
    } finally {
      setSubmitting(false);
    }
  }

  // --------------------------------------------------------------------
  // Khởi động lại — POST /reboot {action:true}. Hỏi xác nhận vì không hoàn tác.
  // --------------------------------------------------------------------
  function onPressReboot() {
    Alert.alert("Khởi động lại thiết bị", "Khởi động lại thiết bị ngay bây giờ?", [
      { text: "Huỷ", style: "cancel" },
      { text: "Khởi động lại", style: "destructive", onPress: doReboot },
    ]);
  }

  async function doReboot() {
    const url = getTargetBase() + "/reboot";
    setRebooting(true);
    setRebootResult(null);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: true }),
      });
      let bodyJson = null;
      try {
        bodyJson = JSON.parse(await resp.text());
      } catch (_) {}

      if (resp.ok) {
        setRebootResult({
          ok: true,
          summary: (bodyJson && bodyJson.message) || "Đang khởi động lại…",
          raw: bodyJson ? JSON.stringify(bodyJson, null, 2) : null,
        });
      } else {
        setRebootResult({
          ok: false,
          summary: (bodyJson && bodyJson.message) || "Thiết bị từ chối lệnh (HTTP " + resp.status + ").",
          raw: bodyJson ? JSON.stringify(bodyJson, null, 2) : null,
        });
      }
    } catch (err) {
      setRebootResult({
        ok: false,
        summary: "Không gửi được lệnh tới thiết bị.",
        raw: "Lỗi: " + (err && err.message ? err.message : String(err)) + "\nĐích: " + url,
      });
    } finally {
      setRebooting(false);
    }
  }

  // --------------------------------------------------------------------
  // Kiểm tra kết nối — GET /provision (danh tính + cấu hình đã lưu). Chính
  // tính năng này bị PWA HTTPS chặn (mixed-content) — app native gọi thẳng
  // được, không bị chặn (xem docs/CONTRACT.md).
  // --------------------------------------------------------------------
  async function onCheckConnection() {
    const url = getTargetBase() + "/provision";
    setChecking(true);
    setCheckResult(null);
    try {
      const resp = await fetch(url, { method: "GET" });
      const text = await resp.text();
      let pretty = text;
      let parsed = null;
      try {
        parsed = JSON.parse(text);
        pretty = JSON.stringify(parsed, null, 2);
      } catch (_) {
        // không phải JSON hợp lệ -> hiển thị thô trong phần chi tiết
      }
      const summary =
        resp.ok
          ? "Kết nối OK — ESP đã phản hồi" + (parsed && parsed.provisioned ? " (đã có cấu hình)." : ".")
          : "ESP phản hồi lỗi (HTTP " + resp.status + ").";
      setCheckResult({ ok: resp.ok, summary, raw: pretty });
    } catch (err) {
      setCheckResult({
        ok: false,
        summary: "Không tới được thiết bị.",
        raw:
          "Lỗi: " + (err && err.message ? err.message : String(err)) + "\nĐích: " + url +
          "\n\nKiểm tra: điện thoại đã nối đúng WiFi của ESP chưa? IP đúng chưa (mặc định " +
          DEFAULT_IP + ")?",
      });
    } finally {
      setChecking(false);
    }
  }

  function resetForm() {
    setResult(null);
  }

  // ======================================================================
  //  Render
  // ======================================================================
  if (result) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={[styles.card, styles.center, styles.elevated]}>
            <View style={[styles.resultIcon, result.ok ? styles.bgOk : styles.bgErr]}>
              <Text style={[styles.resultIconText, result.ok ? styles.textOk : styles.textErr]}>
                {result.ok ? "✓" : "✕"}
              </Text>
            </View>
            <Text style={[styles.resultTitle, result.ok ? styles.textOk : styles.textErr]}>
              {result.title}
            </Text>
            <Text style={styles.resultMessage}>{result.message}</Text>
            {result.raw ? <RawJsonBox text={JSON.stringify(result.raw, null, 2)} /> : null}
            <Pressable style={[styles.btnPrimary, { width: "100%" }]} onPress={resetForm}>
              <Text style={styles.btnPrimaryText}>{result.ok ? "OK" : "Thử lại"}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* ---- Header thương hiệu ---- */}
        <View style={styles.header}>
          <Text style={styles.h1}>Smart Humidity IoT</Text>
          <Text style={styles.sub}>Cấu hình thiết bị · App native</Text>
        </View>

        {/* ---- WiFi ---- */}
        <View style={[styles.card, styles.elevated]}>
          <View style={styles.rowBetween}>
            <Text style={styles.label}>Gửi WiFi</Text>
            <Switch value={sendWifi} onValueChange={setSendWifi} trackColor={styles.switchTrack} thumbColor="#fff" />
          </View>
          <View style={[!sendWifi && styles.disabledGroup]}>
            <Text style={styles.fieldLabel}>Tên WiFi (SSID) *</Text>
            <TextInput
              style={styles.input}
              value={ssid}
              onChangeText={setSsid}
              editable={sendWifi}
              placeholder="TenWiFiNha"
              placeholderTextColor="#475569"
              autoCapitalize="none"
            />
            <Text style={styles.fieldLabel}>Mật khẩu WiFi</Text>
            <View style={styles.rowBetween}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={password}
                onChangeText={setPassword}
                editable={sendWifi}
                secureTextEntry={!showPassword}
                placeholder="matkhauwifi"
                placeholderTextColor="#475569"
                autoCapitalize="none"
              />
              <Pressable style={styles.btnGhost} onPress={() => setShowPassword((v) => !v)}>
                <Text style={styles.btnGhostText}>{showPassword ? "Ẩn" : "Hiện"}</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* ---- MAC ---- */}
        <View style={[styles.card, styles.elevated]}>
          <View style={styles.rowBetween}>
            <Text style={styles.label}>Gửi MAC (ESP còn lại)</Text>
            <Switch value={sendMac} onValueChange={setSendMac} trackColor={styles.switchTrack} thumbColor="#fff" />
          </View>
          <View style={[!sendMac && styles.disabledGroup]}>
            <Text style={styles.fieldLabel}>MAC của ESP còn lại</Text>
            <View style={styles.rowBetween}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={peerMac}
                onChangeText={setPeerMac}
                editable={sendMac}
                placeholder="11:22:33:44:55:66"
                placeholderTextColor="#475569"
                autoCapitalize="characters"
              />
              <Pressable
                style={[styles.btnGhost, !sendMac && styles.btnDisabled]}
                disabled={!sendMac}
                onPress={openScanner}
              >
                <Text style={styles.btnGhostText}>Quét QR</Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>Để trống cũng được — ESP-NOW vẫn nhận broadcast.</Text>
          </View>
        </View>

        {/* ---- Đích gửi ---- */}
        <View style={[styles.card, styles.elevated]}>
          <View style={styles.rowBetween}>
            <Text style={styles.label}>Chế độ Test (mock-esp-server)</Text>
            <Switch value={testMode} onValueChange={setTestMode} trackColor={styles.switchTrack} thumbColor="#fff" />
          </View>
          {testMode ? (
            <>
              <Text style={styles.fieldLabel}>URL mock server (IP LAN máy chạy npm start)</Text>
              <TextInput
                style={styles.input}
                value={mockUrl}
                onChangeText={setMockUrl}
                placeholder="http://192.168.1.100:8080"
                placeholderTextColor="#475569"
                autoCapitalize="none"
              />
            </>
          ) : (
            <>
              <Text style={styles.fieldLabel}>IP của ESP (SoftAP)</Text>
              <TextInput
                style={styles.input}
                value={ip}
                onChangeText={setIp}
                placeholder={DEFAULT_IP}
                placeholderTextColor="#475569"
                autoCapitalize="none"
              />
            </>
          )}
          <Text style={styles.hint}>Đích: {getTargetBase()}/provision</Text>
        </View>

        {/* ---- Kiểm tra kết nối (GET /provision) — lý do chính có app native này ---- */}
        <Pressable
          style={[styles.btnGhostFull, checking && styles.btnDisabled]}
          onPress={onCheckConnection}
          disabled={checking}
        >
          {checking ? (
            <ActivityIndicator color="#e2e8f0" />
          ) : (
            <Text style={styles.btnGhostFullText}>Kiểm tra kết nối (GET /provision)</Text>
          )}
        </Pressable>
        {checkResult ? (
          <StatusBanner ok={checkResult.ok} summary={checkResult.summary} raw={checkResult.raw} />
        ) : null}

        {/* ---- Nút hành động ---- */}
        <Pressable
          style={[styles.btnPrimary, submitting && styles.btnDisabled]}
          onPress={onSubmitProvision}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnPrimaryText}>Gửi cấu hình</Text>
          )}
        </Pressable>

        <Pressable
          style={[styles.btnDanger, rebooting && styles.btnDisabled]}
          onPress={onPressReboot}
          disabled={rebooting}
        >
          {rebooting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnPrimaryText}>Khởi động lại (POST /reboot)</Text>
          )}
        </Pressable>
        {rebootResult ? (
          <StatusBanner ok={rebootResult.ok} summary={rebootResult.summary} raw={rebootResult.raw} />
        ) : null}

        <Text style={styles.footer}>
          Chỉ hoạt động khi ESP đang ở chế độ SoftAP và điện thoại đã nối vào WiFi của ESP.
        </Text>
      </ScrollView>

      {/* ---- Modal quét QR ---- */}
      <Modal visible={scannerOpen} animationType="slide">
        <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
          {permission?.granted ? (
            <CameraView
              style={{ flex: 1 }}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={onBarcodeScanned}
            />
          ) : (
            <View style={[styles.center, { flex: 1 }]}>
              <Text style={{ color: "#fff", marginBottom: 12 }}>
                Cần quyền camera để quét QR.
              </Text>
              <Pressable style={styles.btnPrimary} onPress={requestPermission}>
                <Text style={styles.btnPrimaryText}>Cấp quyền camera</Text>
              </Pressable>
            </View>
          )}
          <Pressable
            style={[styles.btnGhost, { margin: 16, alignSelf: "center" }]}
            onPress={() => setScannerOpen(false)}
          >
            <Text style={[styles.btnGhostText, { color: "#fff" }]}>Đóng</Text>
          </Pressable>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const TEAL = "#14b8a6";

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0b1120" },
  scroll: { padding: 20, paddingBottom: 40 },
  header: { marginBottom: 18 },
  h1: { fontSize: 19, fontWeight: "700", color: "#f1f5f9" },
  sub: { fontSize: 12.5, color: "#94a3b8", marginTop: 1 },
  card: {
    backgroundColor: "#161f32",
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#232f47",
  },
  elevated: {
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  center: { alignItems: "center", justifyContent: "center" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  label: { fontSize: 15, fontWeight: "600", color: "#e2e8f0" },
  fieldLabel: { fontSize: 13, color: "#94a3b8", marginTop: 12, marginBottom: 5, fontWeight: "500" },
  hint: { fontSize: 12, color: "#64748b", marginTop: 10 },
  switchTrack: { false: "#334155", true: TEAL },
  input: {
    borderWidth: 1,
    borderColor: "#2a3652",
    backgroundColor: "#0e1729",
    color: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 14,
  },
  disabledGroup: { opacity: 0.4 },
  btnPrimary: {
    backgroundColor: "#2563eb",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginBottom: 12,
    shadowColor: "#2563eb",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  btnPrimaryText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  btnDanger: {
    backgroundColor: "#dc2626",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginBottom: 12,
    shadowColor: "#dc2626",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  btnGhost: {
    borderWidth: 1,
    borderColor: "#2a3652",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#0e1729",
  },
  btnGhostText: { color: "#e2e8f0", fontSize: 13, fontWeight: "600" },
  btnGhostFull: {
    borderWidth: 1,
    borderColor: "#2a3652",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginBottom: 12,
    backgroundColor: "#161f32",
  },
  btnGhostFullText: { color: "#cbd5e1", fontSize: 14, fontWeight: "700" },
  btnDisabled: { opacity: 0.5 },
  footer: { fontSize: 12, color: "#64748b", textAlign: "center", marginTop: 4, lineHeight: 18 },

  // ---- Banner thông báo (thay cho hộp log thô) ----
  banner: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
  },
  bannerOk: { backgroundColor: "#0d2b22", borderColor: "#155e45" },
  bannerErr: { backgroundColor: "#2c1414", borderColor: "#6b1f1f" },
  bannerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  bannerText: { flex: 1, color: "#e2e8f0", fontSize: 13.5, lineHeight: 19 },
  bannerToggleRow: { marginTop: 8, marginLeft: 42 },
  bannerToggle: { color: "#7dd3c0", fontSize: 12, fontWeight: "600" },

  resultIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  resultIconText: { fontSize: 32, fontWeight: "700" },
  bgOk: { backgroundColor: "#0d2b22" },
  bgErr: { backgroundColor: "#2c1414" },
  textOk: { color: "#34d399" },
  textErr: { color: "#f87171" },
  resultTitle: { fontSize: 19, fontWeight: "700", marginBottom: 8, textAlign: "center" },
  resultMessage: { fontSize: 14, color: "#cbd5e1", textAlign: "center", marginBottom: 14, lineHeight: 20 },
  rawBox: {
    backgroundColor: "#0b1120",
    borderRadius: 10,
    padding: 12,
    width: "100%",
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#232f47",
  },
  rawText: { color: "#94a3b8", fontSize: 11, fontFamily: "monospace", lineHeight: 16 },
  rawFieldRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: "#1a2338",
  },
  rawFieldText: { flex: 1, color: "#94a3b8", fontSize: 11, fontFamily: "monospace", lineHeight: 16 },
  rawFieldKey: { color: "#7dd3c0", fontWeight: "700" },
  rawFieldCopyBtn: { paddingHorizontal: 6, paddingVertical: 2 },
  rawFieldCopyText: { color: "#64748b", fontSize: 14, fontWeight: "700" },
  // Nút "Sao chép" trong hộp JSON (RawJsonBox)
  copyBtn: {
    alignSelf: "flex-end",
    borderWidth: 1,
    borderColor: "#2a3652",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 8,
    backgroundColor: "#161f32",
  },
  copyBtnDone: { borderColor: "#155e45", backgroundColor: "#0d2b22" },
  copyBtnText: { color: "#94a3b8", fontSize: 12, fontWeight: "600" },
  copyBtnTextDone: { color: "#34d399" },
});
