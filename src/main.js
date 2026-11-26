import {summarizeDailyMap} from "./activity-dedupe.js";
import {mountDailyQuickActions,openMealGroupAfterRender,mountActivityDedupeView} from "./daily-quick-actions.js";
import "./activity-compact.css";
import "./coach-deficit.css";
import { mountCoachDeficit } from "./coach-deficit.js";

import { renderAnalytics, initAnalytics } from "./analytics.js";
import { renderWeightInsights, renderReportInsights } from "./insights.js";
import "./insights.css";
import "./journey-next.css";
import { renderCoachGuidance, loadNutritionTrend } from "./journey-next.js";
import "./analytics.css";
import { createClient } from "@supabase/supabase-js";
import { calculateNutrition, renderNutritionBasis } from "./nutrition.js";
import { renderMealSuite, initMealSuite } from "./meal-suite.js";
import "./meal-suite.css";
import "./diary-quick-actions.css";
import { mountDiaryQuickActions } from "./diary-quick-actions.js";
import { mountSmartMeal } from "./smart-meal.js";
import "./smart-meal.css";
import "./style.css";
import "./ui-phase2.css";
import "./ui-phase3.css";
import "./ui-shortcut-sync.css";
import "./home-activity.css";
import "./home-overview-clean.css";
import { mountHomeDeficit } from "./deficit-insights.js";
import "./trend-charts.css";
import "./daily-quick-actions.css";
import { trendLineChart, goalProgress, mountWeightTrends } from "./trend-charts.js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const app = document.querySelector("#app");
let shortcutRefreshPending = false;
function refreshAfterShortcutReturn() {
  if (!window.__msjAwaitingShortcutReturn || shortcutRefreshPending || document.visibilityState === "hidden") return;
  window.__msjAwaitingShortcutReturn = false;
  shortcutRefreshPending = true;
  // The shortcut uploads independently; allow the user to refresh again if it is still running.
  Promise.resolve().then(() => showApp()).catch(console.error).finally(() => { shortcutRefreshPending = false; });
}
document.addEventListener("visibilitychange", refreshAfterShortcutReturn);
window.addEventListener("focus", refreshAfterShortcutReturn);

function selectChartPoint(node) {
  const graph=node.closest('.msj-trend-graph');
  const label=graph?.querySelector('.msj-trend-selected');
  if(!label)return;
  graph.querySelectorAll('[data-chart-point]').forEach(p=>p.setAttribute('aria-pressed',String(p===node)));
  label.textContent=node.getAttribute('data-chart-point')||'';
}
document.addEventListener('click',event=>{
  const node=event.target.closest?.('[data-chart-point]');
  if(node)selectChartPoint(node);
});
document.addEventListener('keydown',event=>{
  if(event.key!=='Enter'&&event.key!==' ')return;
  const node=event.target.closest?.('[data-chart-point]');
  if(node){event.preventDefault();selectChartPoint(node);}
});

let currentUser = null;
let appRenderGeneration = 0;
let settingsReturnTab = "home";
let passwordRecovery = false;
const appTabs = ["home", "meals", "activity", "weight", "reports", "coach", "settings"];
const savedTab = localStorage.getItem("msj-current-tab");
let currentTab = appTabs.includes(savedTab) ? savedTab : "home";
let diarySelection = null;
let mealDeepLink = null;
let activityDeepLink = null;
let coachDeepLinkDate = null;
let overviewDate = null;
let profile = null;
let stages = [];
let latestWeight = null;
let pendingFoodPhoto = null;
let pendingFoodMimeType = "image/jpeg";
let pendingFoodAnalysis = null;
let pendingHealthImport = null;

const today = () => {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000)
    .toISOString().slice(0, 10);
};

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char])
  );
}

function showMessage(message) {
  alert(message);
}

function renderSettingsNutritionPreview(goal) {
  return `<section class="card settings-goal-preview" id="settingsGoalPreview">
    <div class="settings-goal-heading"><div><p class="eyebrow">TODAY'S PLAN</p><h2>目前營養目標</h2></div>
      ${goal.ready ? `<span class="nutrition-goal-tag">${goal.manual ? "手動熱量" : "階段自動"}</span>` : ""}</div>
    ${goal.ready ? `<div class="settings-goal-stats">
      <div><span>每日熱量</span><b>${goal.calorieTarget.toLocaleString("zh-TW")} kcal</b></div>
      <div><span>蛋白質</span><b>${goal.protein} g</b></div>
      <div><span>碳水</span><b>${goal.carbs} g</b></div>
      <div><span>脂肪</span><b>${goal.fat} g</b></div>
    </div>
    <p class="muted">${goal.stageName ? `套用階段「${escapeHTML(goal.stageName)}」：${goal.targetWeight} kg · ${escapeHTML(goal.targetDate)}，剩 ${goal.daysRemaining} 天。` : "沒有進行中的階段，減脂模式會以維持熱量作為估算。"}</p>
    ${goal.manual ? '<p class="muted">目前自訂熱量會覆蓋階段自動熱量；清空「自訂熱量」並儲存即可恢復連動。</p>' : `<p class="muted">自動熱量參考 ${goal.automaticTarget} kcal；依個人資料、目前體重與近期體重趨勢估算。</p>`}
    ${goal.warnings.map(warning => `<p class="muted" role="status">${escapeHTML(warning)}</p>`).join("")}
    <details class="settings-goal-details"><summary>查看計算依據</summary>${renderNutritionBasis(goal)}</details>`
    : `<p class="muted">${escapeHTML(goal.reason || `補齊${goal.missing.map(escapeHTML).join("、")}後即可預覽目標。`)}</p>`}
  </section>`;
}

async function loadProfile() {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (error) throw error;
  profile = data;
}

async function loadStages() {
  const { data, error } = await supabase
    .from("goal_stages")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("sort_order", { ascending: true })
    .order("target_date", { ascending: true });

  if (error) throw error;
  stages = data || [];
}

async function loadAllUserRows(table, userId) {
  const rows = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from(table).select("*")
      .eq("user_id", userId).order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < pageSize) return rows;
  }
}

async function buildUserBackup(userId) {
  const [{ data: savedProfile, error: profileError }, stagesData, mealsData,
    mealItems, weights, activities, favorites] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    loadAllUserRows("goal_stages", userId),
    loadAllUserRows("meals", userId),
    loadAllUserRows("meal_items", userId),
    loadAllUserRows("weight_logs", userId),
    loadAllUserRows("activity_logs", userId),
    loadAllUserRows("user_favorite_foods", userId)
  ]);
  if (profileError) throw profileError;
  return {
    app: "My Slim Journey",
    exported_at: new Date().toISOString(),
    account_email: currentUser.email || null,
    data: {
      profile: savedProfile,
      goal_stages: stagesData,
      meals: mealsData,
      meal_items: mealItems,
      weight_logs: weights,
      activity_logs: activities,
      favorite_foods: favorites
    }
  };
}

function appleAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match?.[1] ?? "";
}

function parseAppleDate(value) {
  const normalized = String(value || "").replace(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/,
    "$1T$2$3:$4"
  );
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function appleWorkoutName(value) {
  const names = {
    Running: "跑步", Walking: "步行", Hiking: "健行", Cycling: "騎自行車",
    TraditionalStrengthTraining: "重量訓練", FunctionalStrengthTraining: "肌力訓練",
    Yoga: "瑜伽", Swimming: "游泳", Dance: "舞蹈", Elliptical: "橢圓機",
    Rowing: "划船機", Pilates: "皮拉提斯", Tennis: "網球",
    StairClimbing: "爬樓梯", CoreTraining: "核心訓練", MindAndBody: "身心運動"
  };
  const key = String(value || "").replace(/^HKWorkoutActivityType/, "");
  return names[key] || (key ? `Apple 健康運動（${key}）` : "Apple 健康運動");
}

async function parseAppleHealthXml(file, fromDate, toDate, onProgress = () => {}) {
  if (typeof file.stream !== "function") throw new Error("目前瀏覽器無法串流讀取 XML，請改用最新版 Safari。");
  const weights = new Map();
  const workouts = new Map();
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let loaded = 0;
  let chunks = 0;

  const keepRecord = startDate => {
    const localDay = String(startDate || "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(localDay) && localDay >= fromDate && localDay <= toDate;
  };

  const handleTag = tag => {
    if (tag.startsWith("<Record")) {
      if (appleAttribute(tag, "type") !== "HKQuantityTypeIdentifierBodyMass") return;
      const startDate = appleAttribute(tag, "startDate");
      if (!keepRecord(startDate)) return;
      const date = parseAppleDate(startDate);
      const rawWeight = Number(appleAttribute(tag, "value"));
      const unit = appleAttribute(tag, "unit").toLowerCase();
      if (!date || !Number.isFinite(rawWeight) || rawWeight <= 0) return;
      const weightKg = unit === "lb" || unit === "lbs" ? rawWeight * 0.45359237
        : unit === "g" ? rawWeight / 1000 : rawWeight;
      if (weightKg < 25 || weightKg > 300) return;
      const record = { weight_kg: Math.round(weightKg * 100) / 100, logged_at: date.toISOString() };
      weights.set(`${record.logged_at}|${record.weight_kg.toFixed(2)}`, record);
      return;
    }

    if (!tag.startsWith("<Workout")) return;
    const startDate = appleAttribute(tag, "startDate");
    if (!keepRecord(startDate)) return;
    const date = parseAppleDate(startDate);
    const rawDuration = Number(appleAttribute(tag, "duration"));
    if (!date || !Number.isFinite(rawDuration) || rawDuration <= 0) return;
    const durationUnit = appleAttribute(tag, "durationUnit").toLowerCase();
    const durationMinutes = durationUnit.startsWith("sec") || durationUnit === "s" ? rawDuration / 60
      : durationUnit.startsWith("hour") || durationUnit === "h" ? rawDuration * 60
      : rawDuration;
    if (durationMinutes <= 0 || durationMinutes > 1440) return;
    const rawCalories = Number(appleAttribute(tag, "totalEnergyBurned"));
    const energyUnit = appleAttribute(tag, "totalEnergyBurnedUnit").toLowerCase();
    const calories = Number.isFinite(rawCalories) && rawCalories >= 0
      ? Math.round(energyUnit === "kj" ? rawCalories / 4.184 : rawCalories) : null;
    const record = {
      activity_type: appleWorkoutName(appleAttribute(tag, "workoutActivityType")),
      duration_minutes: Math.round(durationMinutes),
      calories_burned: calories,
      steps: null,
      logged_at: date.toISOString()
    };
    const key = `${record.logged_at}|${record.activity_type}|${record.duration_minutes}|${record.calories_burned ?? ""}`;
    workouts.set(key, record);
  };

  const processBuffer = () => {
    const pattern = /<(?:Record|Workout)\b[^>]*>/g;
    let match;
    let consumed = 0;
    while ((match = pattern.exec(buffer))) {
      handleTag(match[0]);
      consumed = pattern.lastIndex;
    }
    const remainder = buffer.slice(consumed);
    const lastTagStart = remainder.lastIndexOf("<");
    buffer = lastTagStart >= 0 ? remainder.slice(lastTagStart) : "";
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      chunks += 1;
      buffer += decoder.decode(value, { stream: true });
      processBuffer();
      if (chunks % 24 === 0) {
        onProgress(file.size ? Math.min(99, Math.floor(loaded / file.size * 100)) : 0);
        await new Promise(resolve => window.setTimeout(resolve, 0));
      }
    }
    buffer += decoder.decode();
    processBuffer();
  } finally {
    reader.releaseLock();
  }
  onProgress(100);
  return { weights: [...weights.values()], workouts: [...workouts.values()] };
}

async function loadAppleImportedRows(table, columns) {
  const rows = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from(table).select(columns)
      .eq("user_id", currentUser.id).ilike("notes", "Apple Health 匯入%")
      .order("id").range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < pageSize) return rows;
  }
}

async function loadLatestWeight() {
  const { data, error } = await supabase
    .from("weight_logs")
    .select("weight_kg, logged_at")
    .eq("user_id", currentUser.id)
    .order("logged_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  latestWeight = data?.[0] || null;
}

async function getRows(table, dateColumn) {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("user_id", currentUser.id)
    .order(dateColumn, { ascending: false })
    .limit(30);

  if (error) throw error;
  return data || [];
}

function showLogin() {
  app.innerHTML = `
    <div class="login-page">
      <div class="login-brand" aria-hidden="true">♡</div>
      <h1>My Slim Journey</h1>
      <p>記錄飲食、運動與體態進度</p>

      <div class="social-login" aria-label="快速登入">
        <button type="button" class="social-button" data-provider="google">
          <span class="google-mark" aria-hidden="true">G</span><span>使用 Google 繼續</span>
        </button>
        <button type="button" class="social-button apple-button" data-provider="apple">
          <span class="apple-mark" aria-hidden="true">●</span><span>使用 Apple 繼續</span>
        </button>
      </div>

      <div class="login-divider"><span>或使用 Email</span></div>

      <form id="loginForm">
        <label>Email
        <input name="email" type="email"
          placeholder="name@example.com" autocomplete="email" required></label>
        <label>密碼
        <input name="password" type="password"
          placeholder="至少 6 個字元" autocomplete="current-password" required minlength="6"></label>
        <button type="submit" id="emailLogin">登入</button>
        <button type="button" id="signup">建立 Email 帳號</button>
        <button type="button" id="forgotPassword" class="text-button">忘記密碼？</button>
      </form>
      <p id="message" class="login-message" role="status" aria-live="polite"></p>
      <p class="login-terms">繼續即表示你同意服務條款與隱私權政策。</p>
    </div>
  `;

  const providerButtons = [...document.querySelectorAll("[data-provider]")];
  providerButtons.forEach(button => {
    button.onclick = async () => {
      if (providerButtons.some(item => item.disabled)) return;
      const message = document.querySelector("#message");
      providerButtons.forEach(item => { item.disabled = true; });
      message.textContent = "正在開啟登入頁面…";
      try {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: button.dataset.provider,
          options: { redirectTo: `${window.location.origin}${window.location.pathname}` }
        });
        if (error) throw error;
      } catch (error) {
        message.textContent = `無法使用此登入方式：${error.message || "請稍後重試。"}`;
        providerButtons.forEach(item => { item.disabled = false; });
      }
    };
  });

  document.querySelector("#loginForm").onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.target);
    const submit = document.querySelector("#emailLogin");
    submit.disabled = true;
    submit.textContent = "登入中…";

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: form.get("email"),
        password: form.get("password")
      });
      if (error) throw error;
      await refresh();
    } catch (error) {
      document.querySelector("#message").textContent = error.message || "登入失敗，請檢查網路後重試。";
      submit.disabled = false;
      submit.textContent = "登入";
    }
  };

  document.querySelector("#signup").onclick = async () => {
    const loginForm = document.querySelector("#loginForm");
    if (!loginForm.reportValidity()) return;
    const form = new FormData(loginForm);
    const button = document.querySelector("#signup");
    const message = document.querySelector("#message");
    button.disabled = true;
    message.textContent = "正在建立帳號…";
    try {
      const { error } = await supabase.auth.signUp({
        email: form.get("email"),
        password: form.get("password")
      });
      if (error) throw error;
      message.textContent = "請到 Email 收取驗證信。";
    } catch (error) {
      message.textContent = error.message || "建立帳號失敗，請稍後重試。";
    } finally {
      button.disabled = false;
    }
  };

  document.querySelector("#forgotPassword").onclick = async () => {
    const emailInput = document.querySelector('#loginForm [name="email"]');
    const email = emailInput.value.trim();
    const message = document.querySelector("#message");
    if (!email) return message.textContent = "請先輸入 Email，再點選忘記密碼。";
    if (!emailInput.reportValidity()) return;
    const button = document.querySelector("#forgotPassword");
    button.disabled = true;
    message.textContent = "正在寄送重設信…";
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}${window.location.pathname}`
      });
      if (error) throw error;
      message.textContent = "密碼重設信已寄出，請查看信箱。";
    } catch (error) {
      message.textContent = `無法寄送：${error.message || "請稍後重試。"}`;
    } finally {
      button.disabled = false;
    }
  };
}

const homeStyles = `<style>
  .home-dashboard { color:#493d3a; font-variant-numeric:tabular-nums; }
  .home-dashboard .card { padding:16px 18px; margin:0 0 12px; border-radius:22px; }
  .home-dashboard h2 { color:#493d3a; font-size:18px; letter-spacing:.015em; margin:0; }
  .home-row { display:flex; align-items:center; justify-content:space-between; gap:10px; }
  .home-row-actions { display:flex; align-items:center; gap:7px; }
  .home-refresh { min-height:36px; padding:7px 10px; border:1px solid #e5dbe1; border-radius:11px; color:#654b60; background:#fff; font:inherit; font-size:12px; font-weight:700; }
  .home-refresh:disabled { opacity:.6; }
  .home-note { color:#766762; font-size:13px; line-height:1.45; }
  .home-energy { align-items:flex-end; margin:13px 0 9px; }
  .home-energy-side { text-align:right; }
  .home-energy-side b { display:block; margin-top:4px; font-size:15px; }
  .home-number { color:#755751; font-size:38px; font-weight:750; letter-spacing:-.045em; line-height:1.12; }
  .home-number small { font-size:14px; letter-spacing:0; color:#766762; font-weight:600; }
  .home-meter { height:8px; background:#f1ebe8; border-radius:20px; overflow:hidden; }
  .home-meter span { display:block; height:100%; background:#b88691; border-radius:inherit; }
  .calorie-meter { position:relative; }
  .calorie-meter .home-meter { display:flex; height:10px; }
  .calorie-meter .home-meter span { flex:none; border-radius:0; }
  .calorie-meter .home-meter .calorie-overflow {
    background:repeating-linear-gradient(135deg, #815461 0 4px, #a06c7b 4px 8px);
  }
  .calorie-meter-tick {
    position:absolute; top:-2px; height:14px; width:2px; left:var(--calorie-goal-stop);
    transform:translateX(-50%); background:#51403f; border-radius:2px;
  }
  .calorie-meter-labels { display:flex; justify-content:space-between; gap:8px; margin-top:5px; }

  .home-meter.sage span { background:#7e9e89; }
  .home-meter.lavender span { background:#a399bb; }
  .home-macros { display:grid; gap:10px; margin-top:15px; }
  .home-macro .home-row { margin-bottom:5px; font-size:13px; }
  .home-macro .home-meter { height:6px; }
  .home-details { border-top:1px solid #eee6e2; margin-top:15px; color:#766762; font-size:13px; }
  .home-details summary { cursor:pointer; padding-top:10px; }
  .home-dashboard dl { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin:12px 0 0; }
  .home-dashboard dt { font-size:12px; color:#766762; }
  .home-dashboard dd { font-weight:700; margin:4px 0 0; }
  .home-exercise-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin:12px 0; }
  .home-exercise-grid > div { display:grid; gap:4px; padding:12px; border-radius:13px; background:#faf5f4; }
  .home-exercise-grid span { color:#766762; font-size:12px; }
  .home-exercise-grid b { color:#514744; font-size:17px; }
  .home-stage { border-top:1px solid #eee6e2; padding-top:11px; }
  .home-dashboard .home-link { min-height:40px; padding:7px 9px; color:#765651; background:#f7efed; font-size:12px; white-space:nowrap; }
  .home-trend { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:4px; text-align:center; }
  .home-day b, .home-day small { display:block; font-size:11px; }
  .home-day small { color:#766762; }
  .home-column { display:flex; align-items:flex-end; justify-content:center; height:46px; margin:4px 0; border-bottom:1px solid #eee6e2; }
  .home-column span { width:65%; max-width:24px; background:#a399bb; border-radius:5px 5px 0 0; }
  .home-meals { margin:8px 0 0; padding:0; list-style:none; }
  .home-meals li { border-top:1px solid #eee6e2; padding:10px 0; font-size:14px; }
  .home-meals li > b { white-space:nowrap; }
  .home-meals p { color:#766762; font-size:12px; margin:3px 0 0; overflow-wrap:anywhere; }
  .home-meals .home-missing { display:block; margin-top:4px; color:#9a6b67; font-size:11px; }
  .home-meals p:empty { display:none; }
  .home-dashboard .home-coach { background:#f2edf5; }
  .home-coach p { margin:6px 0 0; }
</style>`;

const homeDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit"
});
const homeNumber = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1 });
const mealLabels = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "點心", other: "其他" };

function shiftHomeDate(date, days) {
  return new Date(Date.parse(date + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
}

function stagePace(fromWeight, fromDate, targetWeight, targetDate) {
  const start = Number(fromWeight), target = Number(targetWeight);
  const from = Date.parse(String(fromDate || "") + "T00:00:00Z");
  const to = Date.parse(String(targetDate || "") + "T00:00:00Z");
  if (!(start > 0) || !(target > 0) || !Number.isFinite(from) || !Number.isFinite(to)) return "填入體重與日期後顯示速率參考";
  const days = Math.round((to - from) / 86400000);
  if (days <= 0) return "目標日期需晚於前一個階段日期";
  const weekly = (start - target) * 7 / days;
  return `${weekly >= 0 ? "每週下降" : "每週增加"}約 ${Math.abs(weekly).toFixed(2)} kg`;
}

async function loadHomeMeals(userId, date) {
  const start = new Date(date + "T00:00:00+08:00");
  const end = new Date(shiftHomeDate(date, 1) + "T00:00:00+08:00");
  const meals = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from("meals")
      .select("meal_type,source,meal_items(food_name,calories,protein_g,carbs_g,fat_g)")
      .eq("user_id", userId).gte("eaten_at", start.toISOString()).lt("eaten_at", end.toISOString())
      .order("id").range(offset, offset + pageSize - 1);
    if (error) throw error;
    meals.push(...data.filter(meal => meal.source !== "planned"));
    if (data.length < pageSize) return meals;
  }
}

async function loadHomeWeights(userId, date) {
  const start = new Date(shiftHomeDate(date, -6) + "T00:00:00+08:00");
  const end = new Date(shiftHomeDate(date, 1) + "T00:00:00+08:00");
  const { data, error } = await supabase.from("weight_logs").select("weight_kg,logged_at")
    .eq("user_id", userId).gte("logged_at", start.toISOString()).lt("logged_at", end.toISOString())
    .order("logged_at", { ascending: false });
  if (error) throw error;
  const weights = new Map();
  for (const log of data) {
    const day = homeDate.format(new Date(log.logged_at));
    if (!weights.has(day) && Number(log.weight_kg) > 0) weights.set(day, Number(log.weight_kg));
    if (weights.size === 7) break;
  }
  return weights;
}

// Historical overview must never display a measurement recorded after the selected date.
async function loadWeightAsOfDate(userId, date) {
  const end = new Date(shiftHomeDate(date, 1) + "T00:00:00+08:00").toISOString();
  const { data, error } = await supabase.from("weight_logs")
    .select("weight_kg,logged_at").eq("user_id", userId)
    .lt("logged_at", end).not("weight_kg", "is", null)
    .order("logged_at", { ascending: false }).limit(1);
  if (error) throw error;
  const value = Number(data?.[0]?.weight_kg);
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function loadHomeBodyFat(userId,date){
  const from=new Date(shiftHomeDate(date,-6)+'T00:00:00+08:00').toISOString();
  const to=new Date(shiftHomeDate(date,1)+'T00:00:00+08:00').toISOString();
  const {data,error}=await supabase.from('weight_logs').select('body_fat_pct,logged_at').eq('user_id',userId).gte('logged_at',from).lt('logged_at',to).not('body_fat_pct','is',null).order('logged_at',{ascending:false});
  if(error)throw error;const map=new Map();for(const row of data||[]){const day=homeDate.format(new Date(row.logged_at));if(!map.has(day)&&Number(row.body_fat_pct)>0)map.set(day,Number(row.body_fat_pct));}return map;
}

async function loadHomeFatBaseline(userId, date) {
  const before = new Date(shiftHomeDate(date, 1) + "T00:00:00+08:00").toISOString();
  const {data,error} = await supabase.from("weight_logs")
    .select("body_fat_pct,logged_at").eq("user_id",userId)
    .lt("logged_at",before).not("body_fat_pct","is",null)
    .order("logged_at",{ascending:true}).limit(1);
  if(error) throw error;
  const value=Number(data?.[0]?.body_fat_pct);
  return value>0?value:null;
}

async function loadHomeActivityCalories(userId, date) {
  const from = new Date(shiftHomeDate(date, -6) + "T00:00:00+08:00").toISOString();
  const to = new Date(shiftHomeDate(date, 1) + "T00:00:00+08:00").toISOString();
  const entries = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from("activity_logs")
      .select("id,activity_type,calories_burned,steps,duration_minutes,logged_at,notes,created_at,total_calories,resting_calories")
      .eq("user_id", userId).gte("logged_at", from).lt("logged_at", to)
      .order("logged_at").range(offset, offset + pageSize - 1);
    if (error) throw error;
    entries.push(...(data || []));
    if ((data || []).length < pageSize) break;
  }
  // Summary Move calories already include exercise. When no summary exists,
  // use de-duplicated workouts only. Never add both together.
  const days = summarizeDailyMap(entries);
  // Apple TOTAL = resting + active. Keep Move and workout separate so exercise is not added twice.
  // A daily summary may arrive with steps only: that must not be mistaken for an energy sync.
  for (const row of entries) {
    if (row.activity_type !== 'Apple 健康每日摘要') continue;
    const valid = value => value === null || value === undefined || value === '' ? null :
      Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
    const resting = valid(row.resting_calories);
    const active = valid(row.calories_burned);
    const storedTotal = valid(row.total_calories);
    const total = storedTotal ?? (active !== null && resting !== null ? active + resting : null);
    const day = homeDate.format(new Date(row.logged_at));
    const previous = days.get(day) || { calories: null, steps: null, source: null };
    days.set(day, { ...previous, totalCalories: total, restingCalories: resting,
      // Don't assume individual workout calories are Apple Move ring calories.
      activeCalories: active, totalSource: total === null ? null : 'apple' });
  }
  return { ...(days.get(date) || { calories: null, steps: null, source: null }), days };
}

function homeActivityTarget(goal) {
  if (!goal?.ready) return null;
  // Estimated whole-day Move target, separate from planned extra exercise.
  const baseline = ({ sedentary: 150, light: 200, moderate: 250, active: 300, very_active: 350 })[profile?.activity_level] ?? 150;
  const extra = Math.max(0, Number(goal.plannedExtraActivity) || 0);
  return Math.round((baseline + extra) / 10) * 10;
}

function renderHomeEnergyPlan(goal, recordedActivity, date) {
  const isToday = date === homeDate.format(new Date());
  const dayLabel = isToday ? "今天" : date.slice(5).replace("-", "/");
  const valid = value => value == null || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0 ? null : Number(value);
  const total = valid(recordedActivity?.totalCalories);
  const rawActive = valid(recordedActivity?.activeCalories);
  const restingFromHealth = valid(recordedActivity?.restingCalories);
  const move = rawActive ?? (recordedActivity?.source === 'health' ? valid(recordedActivity.calories) : null);
  // Only a daily Move sample may be used to split Apple TOTAL. Recorded workouts are a subset, not another segment.
  const staticEnergy = total !== null && restingFromHealth !== null && restingFromHealth <= total ? restingFromHealth :
    total !== null && move !== null && move <= total ? Math.max(0,total - move) : null;
  const activeEnergy = total !== null && staticEnergy !== null ? Math.max(0,total - staticEnergy) : null;
  const workout = valid(recordedActivity?.workoutCalories);
  const steps = valid(recordedActivity?.steps);
  const workoutTarget = homeActivityTarget(goal) ?? 150;
  const validSplit = total !== null && total > 0 && staticEnergy !== null && activeEnergy !== null;
  const fmtKcal = x => x === null ? '—' : homeNumber.format(Math.round(x));
  const stack = validSplit ? `<div class="msj-energy-breakdown" role="img" aria-label="Apple 全天總消耗 ${fmtKcal(total)} kcal，靜態 ${fmtKcal(staticEnergy)} kcal，活動 ${fmtKcal(activeEnergy)} kcal；已記錄運動不再相加">
      <div class="msj-energy-breakdown-head"><strong>全天熱量組成</strong><small>靜態＋活動＝TOTAL</small></div>
      <div class="msj-energy-breakdown-bar" aria-hidden="true"><span class="msj-energy-resting" style="width:${Math.max(0,Math.min(100,staticEnergy/total*100))}%"></span><span class="msj-energy-active" style="width:${Math.max(0,Math.min(100,activeEnergy/total*100))}%"></span></div>
      <div class="msj-energy-breakdown-legend"><span><i class="msj-resting-dot"></i>靜態 ${fmtKcal(staticEnergy)} kcal</span><span><i class="msj-active-dot"></i>活動 ${fmtKcal(activeEnergy)} kcal</span></div>
    </div>` : total !== null
      ? `<p class="msj-energy-data-note">已取得 Apple TOTAL ${fmtKcal(total)} kcal；活動／靜態熱量尚未同步，暫不猜測各自比例。</p>`
      : `<p class="msj-energy-data-note">Apple TOTAL 尚未寫入。請確認捷徑上傳的 <code>days</code> 清單包含 <code>totalCalories</code>，重新執行後按「更新」。</p>`;
  const workoutNote = workout === null ? '尚無單次運動消耗紀錄' :
    move !== null && total !== null && workout <= activeEnergy + 5
      ? `其中已記錄運動 ${fmtKcal(workout)} kcal，包含於活動消耗，不額外相加。`
      : `已記錄運動 ${fmtKcal(workout)} kcal，僅供參考，不直接加到 Apple TOTAL。`;
  return `<section class="card msj-activity-card msj-activity-compact msj-tap-card">
    <div class="msj-activity-heading"><div><h2>每日活動 <span class="msj-card-hint">查看明細 ›</span></h2><p>${dayLabel} · Apple Fitness 與運動紀錄</p></div>
      <div class="msj-activity-actions"><button type="button" id="homeHealthShortcut" class="home-shortcut" aria-label="執行 Apple Fitness 捷徑">同步健康</button><button type="button" id="homeHealthRefresh" class="home-refresh" aria-label="重新讀取已同步資料">↻ 更新</button></div>
    </div>
    <div class="msj-activity-three-stats" aria-label="當日活動摘要">
      <div class="msj-activity-stat msj-activity-stat-total"><small>${isToday?'目前總消耗':'全天總消耗'}</small><strong>${fmtKcal(total)}</strong><span>${total === null ? '待同步' : 'kcal · Apple'}</span></div>
      <div class="msj-activity-stat msj-activity-stat-steps"><small>當日步數</small><strong>${steps === null ? '—' : homeNumber.format(Math.round(steps))}</strong><span>${steps === null ? '待同步' : '步'}</span></div>
      <div class="msj-activity-stat msj-activity-stat-workout"><small>運動消耗</small><strong>${fmtKcal(workout)}</strong><span>${workout === null ? '未記錄' : 'kcal · 紀錄'}</span></div>
    </div>
    ${stack}
    <p class="msj-activity-workout-note">${workoutNote}</p>
    ${workout !== null ? `<p class="msj-activity-goal-note">運動參考 ${homeNumber.format(workoutTarget)} kcal · 約 ${Math.round(workout/workoutTarget*100)}%，不是每日必須達標的目標。</p>` : ''}
    <p class="home-note msj-activity-help" id="homeHealthStatus">「同步健康」執行 Apple Fitness 捷徑；「更新」讀取已上傳資料。</p>
    <button type="button" data-tab="activity" class="msj-stretch-link" aria-label="查看所選日期的運動紀錄"></button>
  </section>`;
}

function homeMeter(label, percent, tone, valueText) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return `<div class="home-meter ${tone}" role="progressbar" aria-label="${label}"
    aria-valuenow="${value}" aria-valuetext="${valueText}"><span style="width:${value}%"></span></div>`;
}

function macroMeter(label, actual, target, tone) {
  const percent = target > 0 ? Math.max(0, actual / target * 100) : 0;
  const scale = Math.max(125, Math.ceil(percent / 25) * 25);
  const targetStop = 10000 / scale;
  const regularWidth = Math.min(percent, 100) * 100 / scale;
  const extraWidth = Math.max(0, percent - 100) * 100 / scale;
  const shownPercent = homeNumber.format(percent);
  const labelText = `${label} ${homeNumber.format(actual)} g / 目標 ${homeNumber.format(target)} g，${shownPercent}%`;
  return `<div class="macro-meter ${tone}" role="img" aria-label="${escapeHTML(labelText)}">
    <span class="macro-meter-fill" style="width:${regularWidth}%"></span>
    ${extraWidth > 0 ? `<span class="macro-meter-overflow" style="width:${extraWidth}%"></span>` : ""}
    <i class="macro-meter-target" style="left:${targetStop}%" aria-hidden="true"></i>
  </div>`;
}

function renderCalorieMeter(actual, target) {
  const percent = Math.max(0, actual / target * 100);
  const scale = Math.max(125, Math.ceil(percent / 25) * 25);
  const targetStop = 10000 / scale;
  const normalWidth = Math.min(percent, 100) * 100 / scale;
  const extraWidth = Math.max(0, percent - 100) * 100 / scale;
  const displayPercent = homeNumber.format(percent) + "%";
  const arialabel = `已攝取 ${homeNumber.format(actual)} kcal，目標 ${homeNumber.format(target)} kcal，為目標的 ${displayPercent}`;
  return `<div class="calorie-meter" style="--calorie-goal-stop:${targetStop}%">
    <div class="home-meter" role="img" aria-label="${arialabel}">
      <span style="width:${normalWidth}%"></span>
      ${extraWidth > 0 ? `<span class="calorie-overflow" style="width:${extraWidth}%"></span>` : ""}
    </div>
    <span class="calorie-meter-tick" aria-hidden="true"></span>
    <div class="calorie-meter-labels home-note"><span>已攝取 ${displayPercent}</span><span>刻度為目標 100%</span></div>
  </div>`;
}

function renderHomeNutrition(goal, totals, date) {
  if (!totals) return '<section class="card home-nutrition msj-tap-card"><h2>當日營養攝取</h2><p>飲食紀錄暫時無法載入。</p><button type="button" data-tab="meals" class="msj-stretch-link" aria-label="查看飲食明細"></button></section>';
  const complete = totals._complete || { calories: true, protein: true, carbs: true, fat: true };
  const remaining = goal.ready && complete.calories ? Math.round(goal.calorieTarget - totals.calories) : null;
  const actualCalories = complete.calories ? homeNumber.format(Math.round(totals.calories)) : "資料不完整";
  const targetCalories = goal.ready ? homeNumber.format(goal.calorieTarget) : null;
  const incompleteLabels = Object.entries({ calories: "熱量", protein: "蛋白質", carbs: "碳水", fat: "脂肪" })
    .filter(([key]) => !complete[key]).map(([, label]) => label);
  const macros = [
    ["蛋白質", "protein", "sage"],
    ["碳水", "carbs", "lavender"],
    ["脂肪", "fat", "rose"]
  ];
  return `<section class="card home-nutrition msj-tap-card">
    <div class="home-row"><h2>當日營養攝取</h2><span class="msj-card-hint">${date.slice(5).replace("-", "/")} · 查看飲食明細 ›</span></div>
    <div class="home-row home-energy">
      <div><span class="home-note">${goal.ready ? (remaining === null ? "熱量統計" : remaining < 0 ? "超出目標" : "剩餘熱量") : "已攝取"}</span>
      <div class="home-number">${remaining === null ? actualCalories : homeNumber.format(Math.abs(remaining))}${actualCalories === "資料不完整" && remaining === null ? "" : " <small>kcal</small>"}</div></div>
      ${goal.ready ? `<div class="home-energy-side"><span class="home-note">已攝取 / 目標</span><b>${actualCalories} / ${targetCalories}</b></div>` : ""}
    </div>
    ${goal.ready && complete.calories ? renderCalorieMeter(totals.calories, goal.calorieTarget)
      : goal.ready ? '<p class="home-note">部分食物缺少熱量資料，暫不比較熱量目標。</p>'
      : `<p class="home-note">${escapeHTML(goal.reason || "補齊個人設定後即可顯示每日目標。")}</p>`}
    <div class="home-macros">
      ${macros.map(([label, key, tone]) => {
        const actual = complete[key] ? homeNumber.format(totals[key]) : "資料不完整";
        const target = goal.ready ? goal[key] : null;
        const values = `${actual}${target === null ? "" : " / " + target} g`;
        return `<div class="home-macro"><div class="home-row"><strong>${label}</strong><span>${values}</span></div>
          ${target > 0 && complete[key] ? macroMeter(label, totals[key], target, tone) : ""}</div>`;
      }).join("")}
    </div>
    ${incompleteLabels.length ? `<p class="home-note">${incompleteLabels.join("、")}有未填資料，總量暫不完整。</p>` : ""}
    <button type="button" data-tab="meals" class="msj-stretch-link" aria-label="查看所選日期的飲食明細"></button>
  </section>`;
}

function renderHomeWeight(stage, current, start, weights, date) {
  const days = Array.from({length:7},(_,i)=>shiftHomeDate(date,i-6));
  const points = days.map(day=>({date:day,value:weights?.get(day)??null}));
  const target = stage ? Number(stage.target_weight_kg) : null;
  const distance = target === null || current === null ? null : Math.max(0, current - target);
  const progress = target !== null && current !== null && start > target ? (start - current) / (start - target) * 100 : null;
  const showProgress = target !== null && current !== null && progress !== null;
  return `<section class="card home-weight msj-tap-card">
    <div class="home-row"><h2>體重進度</h2><span class="msj-card-hint">查看趨勢 ›</span></div>
    <div class="home-row home-energy"><div>
      <span class="home-note">${latestWeight ? "最新體重" : "起始體重"}</span>
      <div class="home-number">${current === null ? "—" : current.toFixed(1)} <small>kg</small></div>
    </div>${target !== null ? `<div class="home-energy-side"><span class="home-note">階段目標</span><b>${target} kg</b></div>` : ""}</div>
    ${showProgress ? homeMeter("體重目標進度", progress, "lavender", `${current.toFixed(1)} kg，目標 ${target} kg`) : ""}
    ${target === null ? '<p class="home-note">目前無進行中的階段</p>' : `<dl class="home-stage">
      <div><dt>距離目標</dt><dd>${distance === null ? "—" : distance === 0 ? "已達目標" : distance.toFixed(1) + " kg"}</dd></div>
      <div><dt>目標日期</dt><dd>${escapeHTML(stage.target_date.replaceAll("-", "/"))}</dd></div>
    </dl>`}
    <div class="msj-home-chart-heading"><h3>最近 7 天體重變化</h3><span>kg</span></div>
    ${weights === null ? '<p class="home-note">體重紀錄暫時無法載入。</p>' : trendLineChart(points,{unit:'kg',label:'最近七天體重',color:'#a795c6',target})}
    <button type="button" data-tab="weight" class="msj-stretch-link" aria-label="查看體重與體脂趨勢"></button>
  </section>`;
}

function renderHomeTrend(weights, date) {
  const days = Array.from({ length: 7 }, (_, i) => shiftHomeDate(date, i - 6));
  const points = days.map(day => ({date:day,value:weights?.get(day) ?? null}));
  return `<section class="card"><h2>最近 7 天體重</h2>${weights === null ? '<p class="home-note">體重紀錄暫時無法載入。</p>' : trendLineChart(points,{unit:'kg',label:'最近七天體重',color:'#a795c6'})}</section>`;
}

function renderHomeBodyFat(fats, date, fatBaseline) {
  const days = Array.from({ length: 7 }, (_, i) => shiftHomeDate(date, i - 6));
  const points = days.map(day => ({date:day,value:fats?.get(day) ?? null}));
  const current = [...(fats?.values() || [])][0] ?? null;
  const target = profile?.target_body_fat_pct == null ? null : Number(profile.target_body_fat_pct);
  const earliest = fatBaseline;
  return `<section class="card msj-home-fat msj-tap-card"><div class="msj-home-fat-head"><h2>體脂進度</h2><span class="msj-card-hint">查看趨勢 ›</span></div>
    <div class="msj-home-fat-stats"><div><span>最近體脂</span><strong>${current == null ? '—' : current.toFixed(1)+'%'}</strong></div><div><span>目標體脂</span><strong>${target == null ? '未設定' : target.toFixed(1)+'%'}</strong></div></div>
    ${fatBaseline === undefined ? '<p class="home-note">體脂起點暫時無法讀取。</p>' : goalProgress(earliest,current,target,'個百分點')}
    <p class="msj-home-chart-title">最近 7 天體脂變化</p>${fats === null ? '<p class="home-note">體脂紀錄暫時無法載入。</p>' : trendLineChart(points,{unit:'%',label:'最近七天體脂',color:'#d5a2b8',target})}
    <p class="msj-trend-foot">體脂計讀數容易受水分影響，建議觀察長期趨勢。</p>
    <button type="button" data-tab="weight" class="msj-stretch-link" aria-label="查看體脂與體重趨勢"></button></section>`;
}

function renderHome(meals, weights, date, weightTrend, recordedActivity, fats, fatBaseline, weightAsOfDate) {
  const current = weightAsOfDate == null ? null : Number(weightAsOfDate);
  const goal = calculateNutrition({ ...profile, _stages: stages, _weightTrend: weightTrend }, current, date);
  const stage = [...stages]
    .filter(entry => entry.target_date >= date && Number(entry.target_weight_kg) > 0)
    .sort((a, b) => a.target_date.localeCompare(b.target_date))[0];
  const nutritionFields = { calories: "calories", protein: "protein_g", carbs: "carbs_g", fat: "fat_g" };
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0,
    _complete: Object.fromEntries(Object.keys(nutritionFields).map(key => [key, true])) };
  for (const meal of meals ?? []) {
    for (const item of meal.meal_items ?? []) {
      for (const [key, field] of Object.entries(nutritionFields)) {
        const value = item[field];
        if (value == null || !Number.isFinite(Number(value))) totals._complete[key] = false;
        else totals[key] += Number(value);
      }
    }
  }
  return `${homeStyles}<main class="home-dashboard">
    ${renderHomeNutrition(goal, meals ? totals : null, date)}
    ${renderHomeEnergyPlan(goal, recordedActivity, date)}
    <section class="card home-coach msj-tap-card"><div class="home-row"><h2>${date === homeDate.format(new Date()) ? "本週赤字概況" : "所選週赤字概況"}</h2><span class="msj-card-hint">Coach 詳細分析 ›</span></div>
      <div id="msjHomeDeficit" class="msj-home-deficit" aria-live="polite">讀取本週資料…</div>
      <button type="button" data-tab="coach" class="msj-stretch-link" aria-label="開啟 Coach 查看每日及每週熱量赤字"></button></section>
    ${renderHomeWeight(stage, current, Number(profile?.start_weight_kg), weights, date)}
    ${renderHomeBodyFat(fats, date, fatBaseline)}
  </main>`;
}

const sectionTitles = { home: "每日總覽", meals: "飲食日曆", activity: "運動", weight: "趨勢", reports: "趨勢", coach: "Coach", settings: "帳號與設定" };
const tabIcons = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-7h6v7"/>',
  meals: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18m-14 5h2m3 0h2m3 0h1"/>',
  activity: '<path d="M3 12h5l3-7 4 14 3-7h3"/>',
  weight: '<path d="M4 4v16h16M7 15l4-4 3 2 5-6"/>',
  coach: '<path d="M12 3l2.1 6.9L21 12l-6.9 2.1L12 21l-2.1-6.9L3 12l6.9-2.1z"/>'
};

function renderOverviewPage(content, date) {
  return `<div id="overview-page" data-date="${date}" style="touch-action:pan-y pinch-zoom">
    <style>
      .overview-picker { margin:0 0 12px; padding:12px; background:#fff; border:1px solid #eee5e0; border-radius:20px; text-align:center; color:#493d3a }
      .overview-picker-row { display:grid; align-items:center; grid-template-columns:44px minmax(0, 1fr) 44px; gap:8px }
      .overview-picker-row button { width:44px; margin:0; padding:0; min-height:44px; border-radius:12px; color:#644b63; background:#f4edf3; font-size:23px }
      .overview-date { position:relative; display:grid; place-items:center; min-height:44px; border-radius:12px; background:#f4edf3; color:#644b63; font-size:16px }
      .overview-date input { position:absolute; inset:0; width:100%; height:100%; margin:0; opacity:0; cursor:pointer; font-size:16px }
      .overview-picker small { display:block; margin-top:6px; color:#746663 }
    </style>
    <section class="overview-picker" aria-label="切換總覽日期">
      <div class="overview-picker-row">
        <button type="button" data-offset="-1" aria-label="前一天">&lt;</button>
        <label class="overview-date"><strong><time datetime="${date}">${date.replaceAll("-", "/")}</time></strong><input type="date" value="${date}" aria-label="選擇總覽日期"></label>
        <button type="button" data-offset="1" aria-label="後一天">&gt;</button>
      </div>
      <small>向右滑看前一天，向左滑看後一天</small>
    </section>
    ${content}
  </div>`;
}

function renderAppShell(content) {
  const trend = currentTab === "weight" || currentTab === "reports";
  const name = String(profile?.display_name || currentUser.email || "").trim();
  const initial = [...name][0]?.toUpperCase() || "帳";
  const avatarUrl = currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture;
  const tab = (id, label, selected) => `<button type="button" data-tab="${id}" ${selected ? 'class="active" aria-current="page"' : ""}>
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${tabIcons[id]}</svg>
    <span>${label}</span></button>`;
  const headerAction = currentTab === "settings"
    ? `<button type="button" data-tab="${settingsReturnTab}" class="app-back" aria-label="返回上一頁">‹</button>`
    : `<button type="button" data-tab="settings" class="app-avatar" aria-label="帳號與設定">${avatarUrl ? `<img src="${escapeHTML(avatarUrl)}" alt="">` : escapeHTML(initial)}</button>`;
  return `<header class="app-header"><h1>${sectionTitles[currentTab] || "今日"}</h1>${headerAction}</header>
    ${trend ? `<div class="app-trend-tabs" role="group" aria-label="趨勢分類">
      <button type="button" data-tab="weight" aria-pressed="${currentTab === "weight"}">體重</button>
      <button type="button" data-tab="reports" aria-pressed="${currentTab === "reports"}">週報</button>
    </div>` : ""}
    ${currentTab === "settings" ? `<section class="card app-account"><div class="account-summary">
      <div class="account-avatar">${avatarUrl ? `<img src="${escapeHTML(avatarUrl)}" alt="">` : escapeHTML(initial)}</div>
      <div><strong>${escapeHTML(profile?.display_name || currentUser.user_metadata?.full_name || "我的帳號")}</strong><p>${escapeHTML(currentUser.email || "")}</p></div>
      </div><p class="account-provider">登入方式：${escapeHTML(currentUser.app_metadata?.provider === "google" ? "Google" : currentUser.app_metadata?.provider === "apple" ? "Apple" : "Email")}</p>
      <details class="account-security"${passwordRecovery ? " open" : ""}><summary>帳號安全</summary>
        <form id="passwordForm"><label>設定新密碼<input name="password" type="password" autocomplete="new-password" minlength="6" placeholder="至少 6 個字元" required></label><button type="submit">更新密碼</button></form>
      </details>
      <details class="account-data"><summary>資料備份</summary><p>下載你的個人設定、目標階段、飲食、體重、運動與常吃食物紀錄。照片檔案不包含在備份中。</p><button id="exportData" type="button">下載我的資料</button><p id="exportStatus" role="status" aria-live="polite"></p></details>
      <details class="account-data health-sync" id="healthSyncPanel"><summary>Apple 健康自動同步</summary>
        <p>網站不能直接讀取 iPhone「健康」資料。完成捷徑設定後，可同步每日步數、活動熱量與運動項目；資料會寫入你的運動紀錄。</p>
        <p class="health-sync-notice"><strong>目前進度：</strong>每日步數已同步。Apple 健康活動熱量與捷徑運動項目尚未完整同步；沿用「Apple Fitness」即可，不必刪除、改名或建立副本。</p>
        <ol><li>先按下方按鈕建立同步金鑰並複製保存。金鑰只顯示一次；不要貼到聊天或分享給別人。</li><li>依照下方步驟修改現有的 <code>Apple Fitness</code>：保留步數查詢，移除 7 天加總，改為逐日清單並加入上傳。</li><li>手動執行後，只有看到 <code>ok: true</code> 且本頁出現「最近成功同步」，才算完成；之後再設定每日自動化。</li></ol>
        <section class="health-sync-automation" aria-label="自動同步與一鍵同步設定">
          <h3>一鍵同步與定時自動化</h3>
          <p>先確認現有 <code>Apple Fitness</code> 捷徑能成功上傳，再設定自動化。以下操作不會自動建立 iPhone 自動化。</p>
          <button type="button" id="settingsHealthShortcut" class="health-shortcut-launch">開啟 Apple Fitness 捷徑</button>
          <p id="settingsShortcutStatus" role="status" aria-live="polite"></p>
          <ol>
            <li>開啟 iPhone「捷徑」App →「自動化」→「＋」→「特定時間」。</li>
            <li>設定每天 <strong>08:00</strong>、<strong>12:30</strong>、<strong>20:30</strong> 各一個自動化（時間可自行調整）。</li>
            <li>選擇「立即執行」（若系統提供），加入「執行捷徑」動作，指定既有的 <code>Apple Fitness</code>。</li>
            <li>第一次執行請允許「健康」讀取與網路存取權限。回到 App 按「更新」檢查同步時間和步數。</li>
          </ol>
          <p>iOS 版本、裝置鎖定及健康權限可能影響是否能無提示執行；若自動化失敗，請先手動執行捷徑排除問題。每日定時同步不是即時同步。</p>
        </section>
        <button id="createHealthSyncToken" type="button">建立捷徑同步金鑰</button>
        <p id="healthSyncStatus" role="status" aria-live="polite"></p>
        <div id="healthSyncTokenList" aria-live="polite"><p>正在讀取同步狀態…</p></div>
        <details class="health-sync-guide"><summary>先同步步數：iPhone 捷徑步驟</summary>
          <ol>
            <li>在本頁按「建立捷徑同步金鑰」，點「複製金鑰」。這串金鑰等下放進捷徑，不要貼到聊天。</li>
            <li>在 Shortcuts 打開既有的 <code>Apple Fitness</code>。沿用這個名稱和捷徑，不要刪除或另建副本。保留 <code>Find Health Samples</code>：<code>Type is Steps</code>、<code>Start Date is in the last 7 days</code>、<code>Group by Day</code>；刪除 <code>Calculate the Sum</code>，因為它會把 7 天合成一個總數。</li>
            <li>在 <code>Find Health Samples</code> 上方加入空的 <code>List</code>，再加入 <code>Set Variable</code>，命名為 <code>Days</code>，將空清單存入它。把這兩個動作移到查詢步數之前。</li>
            <li>在查詢步數後加入 <code>Repeat with Each</code>，輸入選 <code>Health Samples</code>。在 Repeat 內依序加入：<code>Get Details of Health Sample</code>（選 <code>Start Date</code>，來源 <code>Repeat Item</code>）；<code>Format Date</code>（日期格式 <code>Custom</code>，格式填 <code>yyyy-MM-dd</code>）；再加入 <code>Get Details of Health Sample</code>（選 <code>Value</code>，來源仍是 <code>Repeat Item</code>）。</li>
            <li>仍在 Repeat 內加入 <code>Dictionary</code>，建立 <code>date</code>＝格式化日期、<code>steps</code>＝步數 Value；再加入 <code>Add to Variable</code>，選 <code>Days</code>。Repeat 結束後，<code>Quick Look</code> 檢查 Days，應是一日一筆的字典清單。</li>
            <li>Repeat 後加入 <code>Dictionary</code>：<code>days</code>＝變數 Days；<code>workouts</code>＝空的 <code>List</code>。再加入 <code>Get Contents of URL</code>，URL 與設定見下一段。</li>
            <li>在 <code>Get Contents of URL</code> 設 <code>Method: POST</code>、<code>Request Body: JSON</code>。Headers 加入 <code>Authorization</code>＝<code>Bearer </code>加上剛複製的金鑰，以及 <code>Content-Type</code>＝<code>application/json</code>。執行一次並允許 Health 權限；成功回應會包含 <code>ok: true</code>。</li>
          </ol>
          <p>捷徑中的 <code>Group by Day</code> 需讓每個 Repeat Item 對應一天。若 <code>Get Details of Health Sample</code> 沒有 <code>Start Date</code> 或 <code>Value</code>，先不要上傳，因為輸出格式未符合每日摘要。</p>
          <p>URL：<code>${escapeHTML(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/apple-health-sync`)}</code></p>
          <p>每個日期一筆資料；<code>steps</code> 是當日總步數，<code>activeCalories</code> 是 Apple 健康「活動能量／Move」的當日總 kcal。要讓首頁顯示活動熱量，該欄位必須由捷徑送出；未同步時會標示「尚未同步」。<code>workouts</code> 可暫時為空陣列，但這代表捷徑運動項目尚未同步。</p>
          <pre>{"days":[{"date":"2026-11-20","steps":3444,"activeCalories":163}],"workouts":[]}</pre>
          <p>健康活動熱量包含日常活動與運動，和「計畫額外運動」是不同指標，不要把它當成額外運動完成量。確認本頁顯示最近成功同步後，再於現有 Automation 設定每日執行。</p>
          <p><a href="https://support.apple.com/guide/shortcuts/intro-to-find-and-filter-actions-apd3c845e881/ios" target="_blank" rel="noreferrer">Apple：尋找健康樣本</a> · <a href="https://support.apple.com/guide/shortcuts/apd58d46713f/ios" target="_blank" rel="noreferrer">Apple：用捷徑傳送 API 請求</a> · <a href="https://support.apple.com/guide/shortcuts/apdfbdbd7123/ios" target="_blank" rel="noreferrer">Apple：建立個人自動化</a></p>
        </details>
      </details>
      <details class="account-data health-import"><summary>Apple 健康資料匯入</summary>
        <p>在 iPhone「健康」App 選擇「匯出所有健康資料」，解壓縮後選取 export.xml。只匯入所選日期內的體重與運動紀錄；XML 會在此裝置解析，其他健康資料不會匯入。</p>
        <label>選擇 export.xml<input id="healthXmlFile" type="file" accept=".xml,text/xml,application/xml"></label>
        <div class="health-import-dates">
          <label>開始日期<input id="healthImportFrom" type="date" value="${shiftHomeDate(homeDate.format(new Date()), -89)}"></label>
          <label>結束日期<input id="healthImportTo" type="date" value="${homeDate.format(new Date())}"></label>
        </div>
        <button id="previewHealthImport" type="button">預覽匯入資料</button>
        <p id="healthImportStatus" role="status" aria-live="polite"></p>
        <p id="healthImportPreview" class="health-import-preview"></p>
        <button id="applyHealthImport" type="button" disabled>匯入預覽資料</button>
      </details>
      <button id="logout" type="button" class="account-logout">登出</button></section>` : ""}
    ${currentTab === "home" ? renderOverviewPage(content, overviewDate ?? homeDate.format(new Date())) : content}
    <nav class="app-tabs" aria-label="主要導覽">
      ${tab("home", "今日", currentTab === "home")}
      ${tab("meals", "飲食", currentTab === "meals")}
      ${tab("activity", "運動", currentTab === "activity")}
      ${tab("weight", "趨勢", trend)}
      ${tab("coach", "Coach", currentTab === "coach")}
    </nav>`;
}

async function focusActivityDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  const label = document.getElementById('anActivityMonth');
  const calendar = document.getElementById('anActivityCalendar');
  const match = label?.textContent?.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  if (!match || !calendar) return;
  const target = day.slice(0,7).split('-').map(Number);
  const offset = (target[0]-Number(match[1]))*12+target[1]-Number(match[2]);
  if (Math.abs(offset)>18) return; // Very distant dates can be selected in the calendar manually.
  const arrow = document.getElementById(offset>=0?'anActivityNext':'anActivityPrevious');
  for(let i=0;i<Math.abs(offset);i++) arrow?.click();
  await new Promise(resolve => {
    let completed=false;
    let observer=null;
    const finish=()=>{if(completed)return;completed=true;observer?.disconnect();clearTimeout(timeout);resolve();};
    const check=()=>{
      if(currentTab!=='activity'||!calendar.isConnected)return finish();
      const button=[...calendar.querySelectorAll('[data-date]')].find(node=>node.dataset.date===day);
      if(button){button.click();finish();}
    };
    observer=new MutationObserver(check);
    observer.observe(calendar,{childList:true,subtree:true});
    const timeout=setTimeout(finish,6500);
    check();
  });
}

async function showApp() {
  const generation = ++appRenderGeneration;
  if (!currentUser) return showLogin();
  const renderUserId = currentUser.id;

  let content = "";
  let settingsWeightTrend = null;
  let homeDeficitGoal = null;
  let homeDeficitDate = null;

  try {
    await Promise.all([
      loadProfile(),
      loadStages(),
      loadLatestWeight()
    ]);
    if (generation !== appRenderGeneration || currentUser?.id !== renderUserId) return;

    if (currentTab === "settings") {
      settingsWeightTrend = await loadNutritionTrend(supabase, currentUser.id, homeDate.format(new Date())).catch(() => null);
      if (generation !== appRenderGeneration || currentUser?.id !== renderUserId) return;
    }

    if (currentTab === "home") {
      const date = overviewDate ?? homeDate.format(new Date());
      const [meals, weights, trend, activity, fats, fatBaseline, asOfWeight] = await Promise.allSettled([
        loadHomeMeals(currentUser.id, date),
        loadHomeWeights(currentUser.id, date),
        loadNutritionTrend(supabase, currentUser.id, date),
        loadHomeActivityCalories(currentUser.id, date),
        loadHomeBodyFat(currentUser.id, date),
        loadHomeFatBaseline(currentUser.id, date),
        loadWeightAsOfDate(currentUser.id, date)
      ]);
      if (generation !== appRenderGeneration || currentUser?.id !== renderUserId) return;
      homeDeficitGoal = calculateNutrition({ ...profile, _stages: stages, _weightTrend: trend.status === "fulfilled" ? trend.value : null }, asOfWeight.status === "fulfilled" ? asOfWeight.value : null, date);
      homeDeficitDate = date;
      content = renderHome(meals.value ?? null, weights.value ?? null, date, trend.value, activity.value, fats.status === 'fulfilled' ? fats.value : null, fatBaseline.status === 'fulfilled' ? fatBaseline.value : undefined, asOfWeight.status === 'fulfilled' ? asOfWeight.value : null);
    }

    if (currentTab === "meals") {
      content = renderMealSuite();
    }

    if (["weight", "activity", "reports", "coach"].includes(currentTab)) {
      content = renderAnalytics(currentTab);
    }

    if (currentTab === "settings") {
      const orderedStages = [...stages].sort((a, b) => a.target_date.localeCompare(b.target_date));
      const firstWeight = Number(latestWeight?.weight_kg) || Number(profile?.start_weight_kg);
      const firstDate = homeDate.format(new Date());
      const nutritionPreview = calculateNutrition({ ...profile, _stages: stages, _weightTrend: settingsWeightTrend }, firstWeight);
      const activeStage = orderedStages.find(stage => stage.target_date >= firstDate && Number(stage.target_weight_kg) > 0);
      const stageRows = orderedStages.map((stage, index) => {
        const previous = orderedStages[index - 1];
        const fromWeight = previous ? Number(previous.target_weight_kg) : firstWeight;
        const fromDate = previous ? previous.target_date : firstDate;
        return `<div class="stage-row">
          <h3>${escapeHTML(stage.stage_name)}${activeStage?.id === stage.id ? '<span class="stage-active-tag">目前套用</span>' : ''}</h3>
          <p>目標：${Number(stage.target_weight_kg).toFixed(1)} kg · ${escapeHTML(stage.target_date.replaceAll("-", "/"))}</p>
          <p class="stage-pace">${escapeHTML(stagePace(fromWeight, fromDate, stage.target_weight_kg, stage.target_date))}</p>
          <button type="button" class="edit-stage" data-id="${escapeHTML(stage.id)}">修改</button>
          <button type="button" class="delete-stage" data-id="${escapeHTML(stage.id)}" style="background:#eee;color:#80635b">刪除</button>
        </div>`;
      }).join("");
      content = `
        <details class="card settings-panel" open>
          <summary><span>個人資料</span><small>身高、活動量與體脂目標</small></summary>
          <div class="settings-panel-body">
          <form id="profileForm">
            <label>顯示名稱<input name="display_name" value="${escapeHTML(profile?.display_name || "")}"></label>
            <label>出生日期<input name="birth_date" type="date" value="${profile?.birth_date ?? ""}" required></label>
            <label>生理性別<select name="sex" required><option value="">請選擇</option><option value="female" ${profile?.sex === "female" ? "selected" : ""}>女性</option><option value="male" ${profile?.sex === "male" ? "selected" : ""}>男性</option></select></label>
            <label>身高（cm）<input name="height_cm" type="number" min="100" max="220" step="0.1" value="${profile?.height_cm ?? ""}" required></label>
            <label>起始體重（kg）<input name="start_weight_kg" type="number" min="25" max="250" step="0.1" value="${profile?.start_weight_kg ?? ""}" required></label>
            <p class="muted">目標體重與期限請在下方「減重階段管理」設定，營養目標會依階段自動計算。</p>
            <label>目標體脂率（%）<input name="target_body_fat_pct" type="number" min="5" max="60" step="0.1" value="${profile?.target_body_fat_pct ?? ""}"></label>
            <label>活動程度<select name="activity_level" required><option value="sedentary" ${profile?.activity_level === "sedentary" ? "selected" : ""}>久坐，幾乎沒有運動</option><option value="light" ${profile?.activity_level === "light" ? "selected" : ""}>輕量活動，每週約 1–3 天</option><option value="moderate" ${profile?.activity_level === "moderate" ? "selected" : ""}>中度活動，每週約 3–5 天</option><option value="active" ${profile?.activity_level === "active" ? "selected" : ""}>高度活動，每週約 6–7 天</option><option value="very_active" ${profile?.activity_level === "very_active" ? "selected" : ""}>非常高活動量</option></select></label>
            <label>管理目標<select name="goal_mode" required><option value="lose" ${(!profile?.goal_mode || profile?.goal_mode === "lose") ? "selected" : ""}>減脂</option><option value="maintain" ${profile?.goal_mode === "maintain" ? "selected" : ""}>維持體重</option><option value="gain" ${profile?.goal_mode === "gain" ? "selected" : ""}>增肌</option></select></label>
            <details><summary>進階設定：自訂營養目標（選填）</summary><p class="muted">留空即自動計算。若以前填過數值，清空後儲存即可恢復自動。</p>
            <label>自訂熱量（kcal）<input name="calorie_target_override" type="number" min="1200" max="5000" step="1" value="${profile?.calorie_target_override ?? ""}"></label>
            <label>蛋白質（g）<input name="protein_target_g" type="number" min="0" max="400" step="1" value="${profile?.protein_target_g ?? ""}"></label>
            <label>碳水（g）<input name="carbs_target_g" type="number" min="0" max="600" step="1" value="${profile?.carbs_target_g ?? ""}"></label>
            <label>脂肪（g）<input name="fat_target_g" type="number" min="0" max="250" step="1" value="${profile?.fat_target_g ?? ""}"></label></details>
            <button type="submit">儲存個人設定</button>
          </form>
          <p class="muted">目前體重會自動讀取最新一筆體重紀錄。</p></div>
        </details>

        ${renderSettingsNutritionPreview(nutritionPreview)}

        <details class="card settings-panel">
          <summary><span>減重目標階段</span><small>${stages.length ? `${stages.length} 個階段` : "尚未設定"}</small></summary>
          <div class="settings-panel-body">
          <p class="muted">階段會依目標日期排序；每週變化是依目前體重或上一階段目標換算的速率參考。</p>

          <form id="stageForm">
            <input type="hidden" name="stage_id">
            <label>階段名稱
              <input name="stage_name" required placeholder="例如：第一階段">
            </label>
            <label>目標體重（kg）
              <input name="target_weight_kg" type="number"
                min="25" max="250" step="0.1" required>
            </label>
            <label>目標日期
              <input name="target_date" type="date" required>
            </label>
            <p id="stagePacePreview" class="stage-pace" aria-live="polite">填入體重與日期後顯示速率參考。</p>
            <button type="submit" id="stageSubmit">新增階段</button>
            <button type="button" id="cancelStage"
              style="display:none;background:#eee;color:#665">
              取消修改
            </button>
          </form>
          <h3>已設定的階段</h3>
          ${stageRows || "<p class='muted'>尚未新增階段目標。</p>"}
          </div>
        </details>
      `;
    }

  } catch (error) {
    if (generation !== appRenderGeneration || currentUser?.id !== renderUserId) return;
    content = `
      <section class="card">
        讀取失敗：${escapeHTML(error.message)}
      </section>
    `;
  }

  if (generation !== appRenderGeneration || currentUser?.id !== renderUserId) return;
  app.innerHTML = renderAppShell(content);
  if (currentTab === "home" && homeDeficitDate) void mountHomeDeficit(supabase, currentUser.id, homeDeficitGoal, homeDeficitDate);
  if (currentTab === "home") mountDailyQuickActions({
    db: supabase, uid: currentUser.id, selectedDate: overviewDate ?? homeDate.format(new Date()),
    onSaved: () => showApp(),
    goWeight: async () => {
      currentTab = "weight";
      localStorage.setItem("msj-current-tab", "weight");
      window.scrollTo(0, 0);
      await showApp();
      const details = app.querySelector("#anWeightEditor");
      if (details) { details.open = true; details.querySelector('[name="weight_kg"]')?.focus(); }
    }
  });
  const overview = app.querySelector("#overview-page");
  if (overview) {
    const move = offset => {
      overviewDate = shiftHomeDate(overviewDate ?? overview.dataset.date, offset);
      if (overviewDate === homeDate.format(new Date())) overviewDate = null;
      void showApp();
    };
    overview.querySelectorAll("[data-offset]").forEach(button => {
      button.onclick = () => move(Number(button.dataset.offset));
    });
    overview.querySelector('.overview-date input').addEventListener('change', event => {
      if (!event.target.value) return;
      overviewDate = event.target.value === homeDate.format(new Date()) ? null : event.target.value;
      void showApp();
    });
    let start = null;
    overview.addEventListener("touchstart", event => {
      start = event.touches.length === 1 && !event.target.closest("button,input,summary,a,.msj-trend-graph")
        ? event.touches[0] : null;
    }, { passive: true });
    overview.addEventListener("touchcancel", () => { start = null; });
    overview.addEventListener("touchend", event => {
      if (!start) return;
      const end = event.changedTouches[0];
      const dx = end.clientX - start.clientX;
      const dy = end.clientY - start.clientY;
      start = null;
      if (Math.abs(dx) >= 55 && Math.abs(dx) > 1.6 * Math.abs(dy)) move(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  // iOS PWA cannot access HealthKit directly. Open the user's existing Shortcut.
  // A return to the foreground only re-fetches data already uploaded by that Shortcut.
  const shortcutLaunch = app.querySelectorAll("#homeHealthShortcut, #settingsHealthShortcut");
  shortcutLaunch.forEach(button => {
    button.onclick = () => {
      const status = app.querySelector("#settingsShortcutStatus") || app.querySelector("#homeHealthStatus");
      if (status) status.textContent = "正在開啟 Apple Fitness。捷徑執行完成後，返回此 App 會重新讀取資料；若沒有自動更新，請按「更新」。";
      window.__msjAwaitingShortcutReturn = true;
      window.location.href = "shortcuts://run-shortcut?name=Apple%20Fitness";
    };
  });
  const homeHealthRefresh = app.querySelector("#homeHealthRefresh");
  if (homeHealthRefresh) homeHealthRefresh.onclick = async () => {
    const status = app.querySelector("#homeHealthStatus");
    homeHealthRefresh.disabled = true;
    homeHealthRefresh.textContent = "↻ 更新中";
    if (status) status.textContent = "正在重新讀取捷徑最近上傳的 Apple 健康資料…";
    await showApp();
  };

  const analyticsTab = currentTab;
  const analyticsUser = currentUser.id;
  const nutritionProfile = { ...profile, _stages: stages };
  const analyticsTasks = {
    activity: async () => {
      await initAnalytics(supabase, analyticsUser, analyticsTab);
      if (currentTab === analyticsTab && currentUser?.id === analyticsUser) {
        const focusDate = activityDeepLink;
        activityDeepLink = null;
        if (focusDate && focusDate !== homeDate.format(new Date())) await focusActivityDay(focusDate);
        if (currentTab === analyticsTab && currentUser?.id === analyticsUser) mountActivityDedupeView(supabase, analyticsUser);
      }
    },
    weight: async () => {
      await initAnalytics(supabase, analyticsUser, analyticsTab, profile);
      await mountWeightTrends(supabase, analyticsUser, profile);
      if (currentTab === analyticsTab) await renderWeightInsights(supabase, analyticsUser, nutritionProfile);
    },
    reports: () => renderReportInsights(supabase, analyticsUser, nutritionProfile, latestWeight),
    coach: async () => {
      await renderCoachGuidance(supabase, analyticsUser, nutritionProfile, latestWeight);
      if (currentTab === analyticsTab) {
        const asOfDate = coachDeepLinkDate;
        coachDeepLinkDate = null;
        await mountCoachDeficit(supabase, analyticsUser, nutritionProfile, latestWeight, asOfDate);
      }
    }
  };
  if (Object.hasOwn(analyticsTasks, analyticsTab)) {
    Promise.resolve().then(analyticsTasks[analyticsTab]).catch(error => {
      if (currentTab === analyticsTab) alert(`載入失敗：${error.message}`);
    });
  }

  document.querySelectorAll("[data-tab]").forEach(button => {
    button.onclick = () => {
      const next = button.dataset.tab;
      if (currentTab === next) return;
      if (next === "settings") settingsReturnTab = currentTab;
      if (button.closest(".home-dashboard") && next === "coach") coachDeepLinkDate = overviewDate || homeDate.format(new Date());
      if (button.closest(".home-dashboard") && next === "activity") {
        activityDeepLink = overviewDate || homeDate.format(new Date());
      }
      if (button.closest(".home-dashboard") && next === "meals") {
        diarySelection = overviewDate;
        mealDeepLink = button.dataset.mealType || null;
      }
      currentTab = next;
      localStorage.setItem("msj-current-tab", next);
      window.scrollTo(0, 0);
      showApp();
    };
  });

  const logout = document.querySelector("#logout");
  if (logout) logout.onclick = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) return showMessage(error.message);
    diarySelection = null;
    settingsReturnTab = "home";
    currentTab = "home";
    localStorage.setItem("msj-current-tab", "home");
    pendingHealthImport = null;
    currentUser = null;
    showLogin();
  };

  const passwordForm = document.querySelector("#passwordForm");
  if (passwordForm) passwordForm.onsubmit = async event => {
    event.preventDefault();
    const button = passwordForm.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "更新中…";
    const password = new FormData(passwordForm).get("password");
    const { error } = await supabase.auth.updateUser({ password });
    button.disabled = false;
    button.textContent = "更新密碼";
    if (error) return showMessage(`更新失敗：${error.message}`);
    passwordRecovery = false;
    passwordForm.reset();
    showMessage("密碼已更新。");
  };

  const exportButton = document.querySelector("#exportData");
  if (exportButton) exportButton.onclick = async () => {
    const status = document.querySelector("#exportStatus");
    exportButton.disabled = true;
    status.textContent = "正在整理個人資料…";
    try {
      const backup = await buildUserBackup(currentUser.id);
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `my-slim-journey-backup-${today()}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = "備份已下載到你的裝置。";
    } catch (error) {
      status.textContent = `備份失敗：${error.message || "請稍後重試。"}`;
    } finally {
      exportButton.disabled = false;
    }
  };

  const healthSyncList = document.querySelector("#healthSyncTokenList");
  const healthSyncStatus = document.querySelector("#healthSyncStatus");
  const createHealthSyncButton = document.querySelector("#createHealthSyncToken");
  if (healthSyncList && healthSyncStatus && createHealthSyncButton) {
    const loadHealthSyncTokens = async () => {
      const { data, error } = await supabase.from("health_sync_tokens")
        .select("id,label,created_at,last_used_at,last_sync_at,last_sync_error,revoked_at")
        .eq("user_id", currentUser.id).order("created_at", { ascending: false });
      if (error) throw error;
      healthSyncList.innerHTML = data?.length ? data.map(token => `
        <div class="health-sync-token"><p><strong>${token.revoked_at ? "已撤銷" : "可使用"}</strong> · 建立於 ${escapeHTML(new Date(token.created_at).toLocaleString("zh-TW"))}<br><span>${token.last_used_at ? `最近連線：${escapeHTML(new Date(token.last_used_at).toLocaleString("zh-TW"))}` : "捷徑尚未連線"}<br>${token.last_sync_at ? `最近成功同步：${escapeHTML(new Date(token.last_sync_at).toLocaleString("zh-TW"))}` : "尚無成功同步紀錄"}</span>${token.last_sync_error ? `<br><span class="health-sync-error">同步失敗：${escapeHTML(token.last_sync_error)}</span>` : ""}</p>
        ${token.revoked_at ? "" : `<button type="button" class="revoke-health-token" data-token-id="${escapeHTML(token.id)}">撤銷金鑰</button>`}</div>`).join("") : "<p>尚未建立同步金鑰。</p>";
      healthSyncList.querySelectorAll(".revoke-health-token").forEach(button => {
        button.onclick = async () => {
          button.disabled = true;
          const { error: revokeError } = await supabase.from("health_sync_tokens")
            .update({ revoked_at: new Date().toISOString() })
            .eq("id", button.dataset.tokenId).eq("user_id", currentUser.id).is("revoked_at", null);
          if (revokeError) {
            button.disabled = false;
            healthSyncStatus.textContent = `撤銷失敗：${revokeError.message}`;
            return;
          }
          healthSyncStatus.textContent = "金鑰已撤銷，使用它的捷徑將無法再同步。";
          await loadHealthSyncTokens();
        };
      });
    };
    loadHealthSyncTokens().catch(error => { healthSyncList.innerHTML = `<p>讀取同步狀態失敗：${escapeHTML(error.message)}</p>`; });
    createHealthSyncButton.onclick = async () => {
      createHealthSyncButton.disabled = true;
      healthSyncStatus.textContent = "正在建立安全金鑰…";
      try {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        const token = `msj_${Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("")}`;
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
        const tokenHash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
        const { error } = await supabase.from("health_sync_tokens").insert({
          user_id: currentUser.id, token_hash: tokenHash, label: "Apple 捷徑"
        });
        if (error) throw error;
        healthSyncStatus.innerHTML = `金鑰只會顯示這一次，請立即複製到捷徑：<br><code class="health-sync-secret">${escapeHTML(token)}</code> <button id="copyHealthSyncToken" type="button">複製金鑰</button>`;
        document.querySelector("#copyHealthSyncToken").onclick = async () => {
          await navigator.clipboard.writeText(token);
          healthSyncStatus.textContent = "已複製。請貼到捷徑的 Authorization 標頭：Bearer 金鑰。";
        };
        await loadHealthSyncTokens();
      } catch (error) {
        healthSyncStatus.textContent = `建立失敗：${error.message || "請稍後重試。"}`;
      } finally {
        createHealthSyncButton.disabled = false;
      }
    };
  }

  const healthFileInput = document.querySelector("#healthXmlFile");
  const healthPreviewButton = document.querySelector("#previewHealthImport");
  const healthApplyButton = document.querySelector("#applyHealthImport");
  const healthStatus = document.querySelector("#healthImportStatus");
  const healthPreview = document.querySelector("#healthImportPreview");
  const healthDateInputs = [document.querySelector("#healthImportFrom"), document.querySelector("#healthImportTo")].filter(Boolean);

  if (healthFileInput && healthPreviewButton && healthApplyButton && healthStatus && healthPreview) {
    const resetHealthPreview = () => {
      pendingHealthImport = null;
      healthApplyButton.disabled = true;
      healthPreview.textContent = "";
      healthStatus.textContent = "";
    };
    healthFileInput.onchange = resetHealthPreview;
    healthDateInputs.forEach(input => { input.onchange = resetHealthPreview; });

    healthPreviewButton.onclick = async () => {
      const file = healthFileInput.files?.[0];
      const fromDate = document.querySelector("#healthImportFrom").value;
      const toDate = document.querySelector("#healthImportTo").value;
      if (!file) return healthStatus.textContent = "請先選擇解壓縮後的 export.xml。";
      if (!file.name.toLowerCase().endsWith(".xml")) return healthStatus.textContent = "請選擇 Apple 健康匯出的 export.xml 檔案。";
      if (fromDate && toDate && fromDate > toDate) return healthStatus.textContent = "開始日期需早於或等於結束日期。";
      if (!fromDate || !toDate) return healthStatus.textContent = "請先選擇匯入日期範圍。";

      healthPreviewButton.disabled = true;
      healthApplyButton.disabled = true;
      pendingHealthImport = null;
      healthPreview.textContent = "";
      healthStatus.textContent = "正在本機解析 XML…";
      try {
        const parsed = await parseAppleHealthXml(file, fromDate, toDate, percent => {
          healthStatus.textContent = `正在本機解析 XML… ${percent}%`;
        });
        pendingHealthImport = { ...parsed, fromDate, toDate };
        const count = parsed.weights.length + parsed.workouts.length;
        healthPreview.textContent = count
          ? `預覽範圍 ${fromDate} 至 ${toDate}：${parsed.weights.length} 筆體重、${parsed.workouts.length} 筆運動。按下匯入後會略過已匯入過的相同紀錄。`
          : `預覽範圍 ${fromDate} 至 ${toDate} 沒有找到體重或運動紀錄。`;
        healthStatus.textContent = "XML 解析完成。";
        healthApplyButton.disabled = count === 0;
      } catch (error) {
        healthStatus.textContent = `解析失敗：${error.message || "請確認檔案是 Apple 健康匯出的 XML。"}`;
      } finally {
        healthPreviewButton.disabled = false;
      }
    };

    healthApplyButton.onclick = async () => {
      if (!pendingHealthImport) return;
      healthApplyButton.disabled = true;
      healthPreviewButton.disabled = true;
      healthStatus.textContent = "正在檢查重複紀錄…";
      let insertedWeights = 0;
      let insertedWorkouts = 0;
      try {
        const [existingWeights, existingWorkouts] = await Promise.all([
          loadAppleImportedRows("weight_logs", "weight_kg,logged_at,notes"),
          loadAppleImportedRows("activity_logs", "activity_type,duration_minutes,calories_burned,logged_at,notes")
        ]);
        const weightKeys = new Set(existingWeights.map(row => `${new Date(row.logged_at).toISOString()}|${Number(row.weight_kg).toFixed(2)}`));
        const workoutKeys = new Set(existingWorkouts.map(row =>
          `${new Date(row.logged_at).toISOString()}|${row.activity_type}|${Number(row.duration_minutes)}|${row.calories_burned == null ? "" : Number(row.calories_burned)}`
        ));
        const weights = pendingHealthImport.weights
          .filter(row => !weightKeys.has(`${row.logged_at}|${Number(row.weight_kg).toFixed(2)}`))
          .map(row => ({ ...row, user_id: currentUser.id, notes: "Apple Health 匯入｜體重" }));
        const workouts = pendingHealthImport.workouts
          .filter(row => !workoutKeys.has(`${row.logged_at}|${row.activity_type}|${Number(row.duration_minutes)}|${row.calories_burned == null ? "" : Number(row.calories_burned)}`))
          .map(row => ({ ...row, user_id: currentUser.id, notes: "Apple Health 匯入｜運動" }));

        const insertBatches = async (table, rows, setCount) => {
          for (let offset = 0; offset < rows.length; offset += 200) {
            const batch = rows.slice(offset, offset + 200);
            const { error } = await supabase.from(table).insert(batch);
            if (error) throw error;
            setCount(batch.length);
          }
        };
        await insertBatches("weight_logs", weights, count => { insertedWeights += count; });
        await insertBatches("activity_logs", workouts, count => { insertedWorkouts += count; });
        const skipped = pendingHealthImport.weights.length + pendingHealthImport.workouts.length - weights.length - workouts.length;
        healthStatus.textContent = `匯入完成：體重 ${insertedWeights} 筆、運動 ${insertedWorkouts} 筆；略過重複 ${skipped} 筆。`;
        healthPreview.textContent = "匯入的運動紀錄會顯示在運動頁，體重紀錄會更新趨勢圖。";
        pendingHealthImport = null;
      } catch (error) {
        healthStatus.textContent = `匯入中斷：已新增體重 ${insertedWeights} 筆、運動 ${insertedWorkouts} 筆。${error.message || "請稍後重試；已成功匯入的紀錄會在下次略過。"}`;
      } finally {
        healthApplyButton.disabled = !pendingHealthImport;
        healthPreviewButton.disabled = false;
      }
    };
  }

  const profileForm = document.querySelector("#profileForm");

  if (profileForm) {
    const refreshNutritionPreview = () => {
      const f = new FormData(profileForm);
      const optionalNumber = name => {
        const value = f.get(name);
        return value === "" || value === null ? null : Number(value);
      };
      const draftProfile = {
        ...profile,
        birth_date: f.get("birth_date") || null,
        sex: f.get("sex"),
        height_cm: optionalNumber("height_cm"),
        start_weight_kg: optionalNumber("start_weight_kg"),
        activity_level: f.get("activity_level"),
        goal_mode: f.get("goal_mode"),
        calorie_target_override: optionalNumber("calorie_target_override"),
        protein_target_g: optionalNumber("protein_target_g"),
        carbs_target_g: optionalNumber("carbs_target_g"),
        fat_target_g: optionalNumber("fat_target_g"),
        _stages: stages,
        _weightTrend: settingsWeightTrend
      };
      const draftGoal = calculateNutrition(draftProfile, Number(latestWeight?.weight_kg) || draftProfile.start_weight_kg);
      const preview = document.querySelector("#settingsGoalPreview");
      if (preview) preview.outerHTML = renderSettingsNutritionPreview(draftGoal);
    };
    profileForm.addEventListener("input", refreshNutritionPreview);
    profileForm.addEventListener("change", refreshNutritionPreview);

    profileForm.onsubmit = async event => {
      event.preventDefault();
      const f = new FormData(profileForm);

      const optionalNumber = name => {
        const value = f.get(name);
        return value === "" || value === null ? null : Number(value);
      };
      const profilePayload = {
        display_name: f.get("display_name"),
        birth_date: f.get("birth_date") || null,
        sex: f.get("sex"),
        height_cm: Number(f.get("height_cm")),
        start_weight_kg: Number(f.get("start_weight_kg")),
        target_weight_kg: Number(stages.length ? [...stages].sort((a,b)=>a.target_date.localeCompare(b.target_date)).at(-1).target_weight_kg : (profile?.target_weight_kg ?? f.get("start_weight_kg"))),
        target_body_fat_pct: optionalNumber("target_body_fat_pct"),
        activity_level: f.get("activity_level"),
        goal_mode: f.get("goal_mode"),
        target_date: profile?.target_date || null,
        weekly_change_kg: profile?.weekly_change_kg ?? null,
        calorie_target_override: optionalNumber("calorie_target_override"),
        protein_target_g: optionalNumber("protein_target_g"),
        carbs_target_g: optionalNumber("carbs_target_g"),
        fat_target_g: optionalNumber("fat_target_g"),
        updated_at: new Date().toISOString()
      };
      const profileWrite = profile
        ? supabase.from("profiles").update(profilePayload)
            .eq("id", currentUser.id).select("id").maybeSingle()
        : supabase.from("profiles").insert({ ...profilePayload, id: currentUser.id })
            .select("id").single();
      const { data: savedProfile, error } = await profileWrite;

      if (error) return showMessage("儲存失敗：" + error.message);
      if (!savedProfile) return showMessage("找不到可更新的個人資料，請重新整理後再儲存。");
      const {data: verified, error: verifyError} = await supabase.from("profiles")
        .select("birth_date,sex,height_cm,start_weight_kg").eq("id",currentUser.id).single();
      if (verifyError || verified?.birth_date !== f.get("birth_date") || verified?.sex !== f.get("sex")) {
        return showMessage("儲存後驗證失敗，請重新整理再試；若持續發生請回報。");
      }
      showMessage("個人設定已儲存並驗證成功！");

      await showApp();
    };
  }

  const stageForm = document.querySelector("#stageForm");

  if (stageForm) {
    const pacePreview = document.querySelector("#stagePacePreview");
    const updateStagePace = () => {
      const stageId = stageForm.elements.stage_id.value;
      const weight = Number(stageForm.elements.target_weight_kg.value);
      const targetDate = stageForm.elements.target_date.value;
      if (!(weight > 0) || !targetDate) {
        pacePreview.textContent = "填入體重與日期後顯示速率參考。";
        return;
      }
      if (stages.some(stage => stage.id !== stageId && stage.target_date === targetDate)) {
        pacePreview.textContent = "這個日期已經有目標階段，請選擇不同日期。";
        return;
      }
      const previous = [...stages]
        .filter(stage => stage.id !== stageId && stage.target_date < targetDate)
        .sort((a, b) => a.target_date.localeCompare(b.target_date)).at(-1);
      pacePreview.textContent = stagePace(
        previous ? Number(previous.target_weight_kg) : Number(latestWeight?.weight_kg) || Number(profile?.start_weight_kg),
        previous?.target_date || homeDate.format(new Date()), weight, targetDate
      );
    };
    stageForm.addEventListener("input", updateStagePace);
    stageForm.addEventListener("change", updateStagePace);
    updateStagePace();
    stageForm.onsubmit = async event => {
      event.preventDefault();
      const f = new FormData(stageForm);
      const stageId = f.get("stage_id");
      const targetDate = String(f.get("target_date"));
      const stageName = String(f.get("stage_name")).trim();
      if (!stageName) return showMessage("請輸入階段名稱。");
      if (stages.some(stage => stage.id !== stageId && stage.target_date === targetDate)) {
        return showMessage("每個目標階段請設定不同日期。");
      }

      const payload = {
        user_id: currentUser.id,
        stage_name: stageName,
        target_weight_kg: Number(f.get("target_weight_kg")),
        target_date: targetDate,
        sort_order: stageId
          ? stages.find(s => s.id === stageId)?.sort_order || stages.length + 1
          : stages.length + 1,
        updated_at: new Date().toISOString()
      };

      const query = stageId
        ? supabase.from("goal_stages").update(payload).eq("id", stageId)
        : supabase.from("goal_stages").insert(payload);

      const { error } = await query;

      if (error) return showMessage(error.message);

      showMessage(stageId ? "階段已更新！" : "階段已新增！");
      await showApp();
    };

    document.querySelector("#cancelStage").onclick = () => {
      stageForm.reset();
      stageForm.elements.stage_id.value = "";
      document.querySelector("#stageSubmit").textContent = "新增階段";
      document.querySelector("#cancelStage").style.display = "none";
      updateStagePace();
    };

    document.querySelectorAll(".edit-stage").forEach(button => {
      button.onclick = () => {
        const stage = stages.find(s => s.id === button.dataset.id);
        if (!stage) return;

        stageForm.elements.stage_id.value = stage.id;
        stageForm.elements.stage_name.value = stage.stage_name;
        stageForm.elements.target_weight_kg.value = stage.target_weight_kg;
        stageForm.elements.target_date.value = stage.target_date;
      updateStagePace();

        document.querySelector("#stageSubmit").textContent = "儲存修改";
        document.querySelector("#cancelStage").style.display = "block";

        stageForm.scrollIntoView({ behavior: "smooth" });
      };
    });

    document.querySelectorAll(".delete-stage").forEach(button => {
      button.onclick = async () => {
        if (!confirm("確定要刪除這個階段嗎？")) return;

        const { error } = await supabase
          .from("goal_stages")
          .delete()
          .eq("id", button.dataset.id);

        if (error) return showMessage(error.message);

        showMessage("階段已刪除。");
        await showApp();
      };
    });
  }

  if (currentTab === "meals") {
    const mealWeight = latestWeight?.weight_kg;
    const goal = loadNutritionTrend(supabase, analyticsUser).catch(() => null)
      .then(weightTrend => calculateNutrition({ ...nutritionProfile, _weightTrend: weightTrend }, mealWeight));
    initMealSuite(supabase, analyticsUser, {
      selectedDate: diarySelection,
      onDateChange: date => { diarySelection = date; },
      goal
    });
    mountDiaryQuickActions();
    mountSmartMeal({ db: supabase, uid: analyticsUser, getDate: () => diarySelection || homeDate.format(new Date()), onSaved: () => showApp() });
    if (mealDeepLink) { openMealGroupAfterRender(mealDeepLink); mealDeepLink = null; }
  }

}

async function refresh() {
  const { data } = await supabase.auth.getSession();
  currentUser = data.session?.user || null;
  await showApp();
}

supabase.auth.onAuthStateChange((event, session) => {
  const nextUser = session?.user || null;
  if (event === "PASSWORD_RECOVERY") {
    passwordRecovery = true;
    currentTab = "settings";
    localStorage.setItem("msj-current-tab", "settings");
  }
  if (currentUser?.id && currentUser.id === nextUser?.id && (event === "TOKEN_REFRESHED" || event === "SIGNED_IN")) {
    currentUser = nextUser;
    return;
  }
  if (!nextUser && currentUser?.id) {
    diarySelection = null;
    currentTab = "home";
    localStorage.setItem("msj-current-tab", "home");
  }
  currentUser = nextUser;
  showApp();
});

refresh();
