// ============================================================================
//  Kiểm thử Security Rules (firebase/database.rules.json) bằng Firebase emulator.
//  Chạy:  npm test     (cần Java JDK 11+ cho emulator; firebase-tools + Node 18+)
//  Tương đương: firebase emulators:exec --only database --project demo-smart-humidity "node --test"
//
//  Bao phủ các use-case bảo mật trong đề bài (PDF mục 5.1) + bản fix audit:
//   - Người lạ (chưa đăng nhập) bị chặn đọc.
//   - Người đăng nhập (non-admin) chỉ XEM, không ghi /config.
//   - Chỉ admin ghi được /config (+ validate biên hset/deadband).
//   - Chỉ tài khoản thiết bị ghi được /sensor, /status.
//   - Không liệt kê được danh sách /admins; chỉ đọc được UID của chính mình.
// ============================================================================
import { test, before, after } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { ref, get, set } from "firebase/database";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES = readFileSync(join(__dirname, "../../firebase/database.rules.json"), "utf8");

const ADMIN = "admin-uid";
const DEVICE = "device-uid";
const RANDO = "rando-uid"; // đăng nhập nhưng không admin, không device

const validConfig = { hset: 65, deadband: 4, lastUpdate: "2026-06-25 10:00:00", updatedBy: "admin@x" };
const validSensor = { temperature: 26.1, humidity: 61.2, timestamp: 1700000100 };

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-smart-humidity",
    database: { rules: RULES, host: "127.0.0.1", port: 9000 },
  });
  // Seed dữ liệu nền, bỏ qua rules.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    await set(ref(db, "admins/" + ADMIN), true);
    await set(ref(db, "devices/" + DEVICE), true);
    await set(ref(db, "sensor"), { temperature: 25, humidity: 60, timestamp: 1700000000 });
    await set(ref(db, "status"), {
      mist: false, tank: 3, pump: false, esp1Online: true, gateway: "esp1", lastSeen: 1700000000,
    });
    await set(ref(db, "config"), { hset: 70, deadband: 5, lastUpdate: "init", updatedBy: "seed" });
  });
});

after(async () => {
  await env.cleanup();
});

test("Người lạ (chưa đăng nhập) KHÔNG đọc được /sensor", async () => {
  const db = env.unauthenticatedContext().database();
  await assertFails(get(ref(db, "sensor")));
});

test("Người đăng nhập (non-admin) ĐỌC được /sensor", async () => {
  const db = env.authenticatedContext(RANDO).database();
  await assertSucceeds(get(ref(db, "sensor")));
});

test("Non-admin KHÔNG ghi được /config", async () => {
  const db = env.authenticatedContext(RANDO).database();
  await assertFails(set(ref(db, "config"), validConfig));
});

test("Admin GHI được /config", async () => {
  const db = env.authenticatedContext(ADMIN).database();
  await assertSucceeds(set(ref(db, "config"), validConfig));
});

test("Admin ghi /config với hset ngoài [0,100] bị từ chối (validate)", async () => {
  const db = env.authenticatedContext(ADMIN).database();
  await assertFails(set(ref(db, "config"), { ...validConfig, hset: 150 }));
});

test("Tài khoản thiết bị GHI được /sensor", async () => {
  const db = env.authenticatedContext(DEVICE).database();
  await assertSucceeds(set(ref(db, "sensor"), validSensor));
});

test("Non-device KHÔNG ghi được /sensor", async () => {
  const db = env.authenticatedContext(RANDO).database();
  await assertFails(set(ref(db, "sensor"), validSensor));
});

test("Thiết bị KHÔNG ghi được /config", async () => {
  const db = env.authenticatedContext(DEVICE).database();
  await assertFails(set(ref(db, "config"), validConfig));
});

test("Non-admin KHÔNG liệt kê được toàn bộ /admins", async () => {
  const db = env.authenticatedContext(RANDO).database();
  await assertFails(get(ref(db, "admins")));
});

test("Đọc /admins/<UID của chính mình> được phép", async () => {
  const db = env.authenticatedContext(ADMIN).database();
  await assertSucceeds(get(ref(db, "admins/" + ADMIN)));
});

test("KHÔNG đọc được /admins/<UID người khác>", async () => {
  const db = env.authenticatedContext(RANDO).database();
  await assertFails(get(ref(db, "admins/" + ADMIN)));
});
