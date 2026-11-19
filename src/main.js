
import { renderAnalytics, initAnalytics } from "./analytics.js";
import { renderWeightInsights, renderReportInsights, renderActivityInsights } from "./insights.js";
import "./insights.css";
import "./journey-next.css";
import { renderCoachGuidance, loadNutritionTrend } from "./journey-next.js";
import "./analytics.css";
import { createClient } from "@supabase/supabase-js";
import { calculateNutrition, renderNutritionBasis } from "./nutrition.js";
import { renderMealSuite, initMealSuite } from "./meal-suite.js";
import "./meal-suite.css";
import "./style.css";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const app = document.querySelector("#app");

let currentUser = null;
let currentTab = "home";
let diarySelection = null;
let profile = null;
let stages = [];
let latestWeight = null;
let pendingFoodPhoto = null;
let pendingFoodMimeType = "image/jpeg";
let pendingFoodAnalysis = null;

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
      <h1>♡ My Slim Journey</h1>
      <p>Every day, a healthier me.</p>

      <form id="loginForm">
        <input name="email" type="email"
          placeholder="Email" required>
        <input name="password" type="password"
          placeholder="Password" required minlength="6">
        <button type="submit">登入</button>
        <button type="button" id="signup">建立帳號</button>
      </form>
      <p id="message"></p>
    </div>
  `;

  document.querySelector("#loginForm").onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.target);

    const { error } = await supabase.auth.signInWithPassword({
      email: form.get("email"),
      password: form.get("password")
    });

    if (error) {
      document.querySelector("#message").textContent = error.message;
    } else {
      await refresh();
    }
  };

  document.querySelector("#signup").onclick = async () => {
    const form = new FormData(
      document.querySelector("#loginForm")
    );

    const { error } = await supabase.auth.signUp({
      email: form.get("email"),
      password: form.get("password")
    });

    document.querySelector("#message").textContent =
      error ? error.message : "請到 Email 收取驗證信。";
  };
}

const homeStyles = `<style>
  .home-dashboard { color:#493d3a; font-variant-numeric:tabular-nums; }
  .home-dashboard .card { padding:16px 18px; margin:0 0 12px; border-radius:22px; }
  .home-dashboard h2 { color:#493d3a; font-size:18px; letter-spacing:.015em; margin:0; }
  .home-row { display:flex; align-items:center; justify-content:space-between; gap:10px; }
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

async function loadHomeActivityCalories(userId, date) {
  const from = new Date(date + "T00:00:00+08:00").toISOString();
  const to = new Date(shiftHomeDate(date, 1) + "T00:00:00+08:00").toISOString();
  let total = null;
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from("activity_logs").select("calories_burned")
      .eq("user_id", userId).gte("logged_at", from).lt("logged_at", to)
      .order("id").range(offset, offset + pageSize - 1);
    if (error) throw error;
    for (const entry of data) {
      if (entry.calories_burned !== null) total = (total ?? 0) + Number(entry.calories_burned);
    }
    if (data.length < pageSize) return total;
  }
}

function renderHomeEnergyPlan(goal, recordedActivity) {
  const actual = recordedActivity === undefined ? "暫時無法讀取"
    : recordedActivity === null ? "尚未記錄" : homeNumber.format(Math.round(recordedActivity)) + " kcal";
  return `<section class="card">
    <div class="home-row"><h2>飲食與運動安排</h2><button type="button" data-tab="activity" class="home-link">記錄運動 ›</button></div>
    ${goal.ready ? `<dl>
      <div><dt>${goal.manual ? "自訂每日攝取" : "估計每日攝取目標"}</dt><dd>${homeNumber.format(goal.calorieTarget)} kcal</dd></div>
      <div><dt>日常總消耗估計</dt><dd>${homeNumber.format(goal.tdee)} kcal</dd></div>
      <div><dt>規劃額外運動消耗</dt><dd>${homeNumber.format(goal.plannedExtraActivity)} kcal</dd></div>
      <div><dt>計畫熱量赤字</dt><dd>${homeNumber.format(goal.plannedDeficit)} kcal</dd></div>
    </dl>` : ""}
    <p class="home-note">今日已記錄運動消耗 · ${actual}</p>
    <p class="home-note">日常總消耗已含活動程度。規劃只加上超出日常的運動，已記錄的運動熱量另列。</p>
  </section>`;
}

function homeMeter(label, percent, tone, valueText) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return `<div class="home-meter ${tone}" role="progressbar" aria-label="${label}"
    aria-valuenow="${value}" aria-valuetext="${valueText}"><span style="width:${value}%"></span></div>`;
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
  if (!totals) return '<section class="card"><h2>今日營養攝取</h2><p>飲食紀錄暫時無法載入。</p></section>';
  const remaining = goal.ready ? Math.round(goal.calorieTarget - totals.calories) : null;
  const actualCalories = homeNumber.format(Math.round(totals.calories));
  const targetCalories = goal.ready ? homeNumber.format(goal.calorieTarget) : null;
  const macros = [
    ["蛋白質", "protein", "sage"],
    ["碳水", "carbs", "lavender"],
    ["脂肪", "fat", "rose"]
  ];
  return `<section class="card home-nutrition">
    <div class="home-row"><h2>今日營養攝取</h2><span class="home-note">${date.slice(5).replace("-", "/")}</span></div>
    <div class="home-row home-energy">
      <div><span class="home-note">${goal.ready ? (remaining < 0 ? "超出目標" : "剩餘熱量") : "已攝取"}</span>
      <div class="home-number">${remaining === null ? actualCalories : homeNumber.format(Math.abs(remaining))} <small>kcal</small></div></div>
      ${goal.ready ? `<div class="home-energy-side"><span class="home-note">已攝取 / 目標</span><b>${actualCalories} / ${targetCalories}</b></div>` : ""}
    </div>
    ${goal.ready ? renderCalorieMeter(totals.calories, goal.calorieTarget)
      : `<p class="home-note">${escapeHTML(goal.reason || "補齊個人設定後即可顯示每日目標。")}</p>`}
    <div class="home-macros">
      ${macros.map(([label, key, tone]) => {
        const actual = homeNumber.format(totals[key]);
        const target = goal.ready ? goal[key] : null;
        const values = `${actual}${target === null ? "" : " / " + target} g`;
        return `<div class="home-macro"><div class="home-row"><strong>${label}</strong><span>${values}</span></div>
          ${target > 0 ? homeMeter(label, totals[key] / target * 100, tone, values) : ""}</div>`;
      }).join("")}
    </div>
    ${goal.ready ? `<details class="home-details"><summary>熱量估算與階段資訊</summary>
      <dl><div><dt>基礎代謝</dt><dd>${goal.bmr} kcal</dd></div><div><dt>每日總消耗</dt><dd>${goal.tdee} kcal</dd></div></dl>
      ${renderNutritionBasis(goal)}
      <p>${escapeHTML(goal.activityLabel)}</p>
      ${goal.stageName ? `<p>${escapeHTML(goal.stageName)} · 飲食與額外運動合計換算約每週 ${goal.weeklyChange.toFixed(2)} kg</p>` : ""}
      ${Math.abs(goal.macroCalories - goal.calorieTarget) > 5 ? `<p>營養素換算熱量為 ${goal.macroCalories} kcal，與熱量目標不同。</p>` : ""}
      ${goal.warnings.map(warning => `<p>${escapeHTML(warning)}</p>`).join("")}
    </details>` : ""}
  </section>`;
}

function renderHomeWeight(stage, current, start) {
  const target = stage ? Number(stage.target_weight_kg) : null;
  const distance = target === null || current === null ? null : Math.max(0, current - target);
  const progress = target !== null && current !== null && start > target ? (start - current) / (start - target) * 100 : null;
  const showProgress = target !== null && current !== null && progress !== null;
  return `<section class="card home-weight">
    <div class="home-row"><h2>體重進度</h2><button type="button" data-tab="weight" class="home-link">查看體重 ›</button></div>
    <div class="home-row home-energy"><div>
      <span class="home-note">${latestWeight ? "最新體重" : "起始體重"}</span>
      <div class="home-number">${current === null ? "—" : current.toFixed(1)} <small>kg</small></div>
    </div>${target !== null ? `<div class="home-energy-side"><span class="home-note">階段目標</span><b>${target} kg</b></div>` : ""}</div>
    ${showProgress ? homeMeter("體重目標進度", progress, "lavender", `${current.toFixed(1)} kg，目標 ${target} kg`) : ""}
    ${target === null ? '<p class="home-note">目前無進行中的階段</p>' : `<dl class="home-stage">
      <div><dt>距離目標</dt><dd>${distance === null ? "—" : distance === 0 ? "已達目標" : distance.toFixed(1) + " kg"}</dd></div>
      <div><dt>目標日期</dt><dd>${escapeHTML(stage.target_date.replaceAll("-", "/"))}</dd></div>
    </dl>`}
  </section>`;
}

function renderHomeTrend(weights, date) {
  const days = Array.from({ length: 7 }, (_, i) => shiftHomeDate(date, i - 6));
  let trend = '<p class="home-note">體重紀錄暫時無法載入。</p>';
  if (weights?.size === 0) trend = '<p class="home-note">最近 7 天還沒有體重紀錄。</p>';
  if (weights?.size > 0) {
    const values = [...weights.values()];
    const baseline = Math.floor(Math.min(...values)) - 0.5;
    const ceiling = Math.ceil(Math.max(...values));
    trend = `<p class="home-note">每日最新紀錄 · 刻度從 ${baseline} kg 起</p><div class="home-trend">
      ${days.map(day => {
        const value = weights.get(day);
        const height = value == null ? 0 : Math.round((value - baseline) / (ceiling - baseline) * 100);
        return `<div class="home-day" aria-label="${day}，${value == null ? "未記錄" : value.toFixed(1) + " kg"}">
          <b>${value == null ? "–" : value.toFixed(1)}</b>
          <div class="home-column"><span style="height:${height}%"></span></div>
          <small>${day.slice(5).replace("-", "/")}</small>
        </div>`;
      }).join("")}</div>`;
  }
  return `<section class="card"><h2>最近 7 天體重</h2>${trend}</section>`;
}

function renderHome(meals, weights, date, weightTrend, recordedActivity) {
  const current = Number(latestWeight?.weight_kg) || Number(profile?.start_weight_kg) || null;
  const goal = calculateNutrition({ ...profile, _stages: stages, _weightTrend: weightTrend }, current, date);
  const stage = [...stages]
    .filter(entry => entry.target_date >= date && Number(entry.target_weight_kg) > 0)
    .sort((a, b) => a.target_date.localeCompare(b.target_date))[0];
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const groups = new Map();
  for (const meal of meals ?? []) {
    const type = Object.hasOwn(mealLabels, meal.meal_type) ? meal.meal_type : "other";
    const group = groups.get(type) ?? { calories: 0, names: new Set() };
    groups.set(type, group);
    for (const item of meal.meal_items ?? []) {
      const calories = Number(item.calories) || 0;
      group.calories += calories;
      if (item.food_name) group.names.add(item.food_name);
      totals.calories += calories;
      totals.protein += Number(item.protein_g) || 0;
      totals.carbs += Number(item.carbs_g) || 0;
      totals.fat += Number(item.fat_g) || 0;
    }
  }
  const mealRows = Object.entries(mealLabels).filter(([type]) => groups.has(type)).map(([type, label]) => {
    const group = groups.get(type);
    return `<li class="home-row"><div><strong>${label}</strong><p>${[...group.names].map(escapeHTML).join("、")}</p></div>
      <b>${homeNumber.format(Math.round(group.calories))} kcal</b></li>`;
  }).join("");
  return `${homeStyles}<main class="home-dashboard">
    ${renderHomeNutrition(goal, meals ? totals : null, date)}
    ${renderHomeEnergyPlan(goal, recordedActivity)}
    ${renderHomeWeight(stage, current, Number(profile?.start_weight_kg))}
    ${renderHomeTrend(weights, date)}
    <section class="card">
      <div class="home-row"><h2>今日餐點</h2><button type="button" data-tab="meals" class="home-link">記錄飲食 ›</button></div>
      ${mealRows ? `<ul class="home-meals">${mealRows}</ul>` : `<p class="home-note">${meals ? "今天還沒有飲食紀錄。" : "餐點暫時無法載入。"}</p>`}
    </section>
    <section class="card home-coach">
      <div class="home-row"><h2>Coach</h2><button type="button" data-tab="coach" class="home-link">查看建議 ›</button></div>
      <p class="home-note">依近 7 天的紀錄檢視飲食與營養。</p>
    </section>
  </main>`;
}

const sectionTitles = { home: "今日", meals: "飲食日曆", activity: "運動", weight: "趨勢", reports: "趨勢", coach: "Coach", settings: "帳號與設定" };
const tabIcons = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-7h6v7"/>',
  meals: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18m-14 5h2m3 0h2m3 0h1"/>',
  activity: '<path d="M3 12h5l3-7 4 14 3-7h3"/>',
  weight: '<path d="M4 4v16h16M7 15l4-4 3 2 5-6"/>',
  coach: '<path d="M12 3l2.1 6.9L21 12l-6.9 2.1L12 21l-2.1-6.9L3 12l6.9-2.1z"/>'
};

function renderAppShell(content) {
  const trend = currentTab === "weight" || currentTab === "reports";
  const name = String(profile?.display_name || currentUser.email || "").trim();
  const initial = [...name][0]?.toUpperCase() || "帳";
  const tab = (id, label, selected) => `<button type="button" data-tab="${id}" ${selected ? 'class="active" aria-current="page"' : ""}>
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${tabIcons[id]}</svg>
    <span>${label}</span></button>`;
  const headerAction = currentTab === "settings"
    ? '<button type="button" data-tab="home" class="app-back" aria-label="回今日">‹</button>'
    : `<button type="button" data-tab="settings" class="app-avatar" aria-label="帳號與設定">${escapeHTML(initial)}</button>`;
  return `<header class="app-header"><h1>${sectionTitles[currentTab] || "今日"}</h1>${headerAction}</header>
    ${trend ? `<div class="app-trend-tabs" role="group" aria-label="趨勢分類">
      <button type="button" data-tab="weight" aria-pressed="${currentTab === "weight"}">體重</button>
      <button type="button" data-tab="reports" aria-pressed="${currentTab === "reports"}">週報</button>
    </div>` : ""}
    ${content}
    ${currentTab === "settings" ? `<section class="card app-account"><h2>登入帳號</h2><p>${escapeHTML(currentUser.email || "")}</p>
      <button id="logout" type="button">登出</button></section>` : ""}
    <nav class="app-tabs" aria-label="主要導覽">
      ${tab("home", "今日", currentTab === "home")}
      ${tab("meals", "飲食", currentTab === "meals")}
      ${tab("activity", "運動", currentTab === "activity")}
      ${tab("weight", "趨勢", trend)}
      ${tab("coach", "Coach", currentTab === "coach")}
    </nav>`;
}

async function showApp() {
  if (!currentUser) return showLogin();

  let content = "";

  try {
    await Promise.all([
      loadProfile(),
      loadStages(),
      loadLatestWeight()
    ]);

    if (currentTab === "home") {
      const date = homeDate.format(new Date());
      const [meals, weights, trend, activity] = await Promise.allSettled([
        loadHomeMeals(currentUser.id, date),
        loadHomeWeights(currentUser.id, date),
        loadNutritionTrend(supabase, currentUser.id, date),
        loadHomeActivityCalories(currentUser.id, date)
      ]);
      content = renderHome(meals.value ?? null, weights.value ?? null, date, trend.value, activity.value);
    }

    if (currentTab === "meals") {
      content = renderMealSuite();
    }

    if (["weight", "activity", "reports", "coach"].includes(currentTab)) {
      content = renderAnalytics(currentTab);
    }

    if (currentTab === "settings") {
      content = `
        <section class="card">
          <h2>個人設定</h2>
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
          <p class="muted">目前體重會自動讀取最新一筆體重紀錄。</p>
        </section>

        <section class="card">
          <h2>減重階段管理</h2>
          <p class="muted">你可以自行新增、修改及刪除階段。</p>

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
            <button type="submit" id="stageSubmit">新增階段</button>
            <button type="button" id="cancelStage"
              style="display:none;background:#eee;color:#665">
              取消修改
            </button>
          </form>
        </section>

        <section class="card">
          <h3>已設定的階段</h3>
          ${
            stages.length
              ? stages.map((stage, index) => `
                <div class="stage-row">
                  <h3>${escapeHTML(stage.stage_name)}</h3>
                  <p>目標：${stage.target_weight_kg} kg</p>
                  <p>期限：${stage.target_date}</p>
                  <button type="button" class="edit-stage"
                    data-id="${stage.id}">修改</button>
                  <button type="button" class="delete-stage"
                    data-id="${stage.id}"
                    style="background:#eee;color:#80635b">
                    刪除
                  </button>
                </div>
                ${index < stages.length - 1 ? "<hr>" : ""}
              `).join("")
              : "<p class='muted'>尚未新增階段目標。</p>"
          }
        </section>
      `;
    }

  } catch (error) {
    content = `
      <section class="card">
        讀取失敗：${escapeHTML(error.message)}
      </section>
    `;
  }

  app.innerHTML = renderAppShell(content);

  const analyticsTab = currentTab;
  const analyticsUser = currentUser.id;
  const nutritionProfile = { ...profile, _stages: stages };
  const analyticsTasks = {
    weight: async () => {
      await initAnalytics(supabase, analyticsUser, analyticsTab, showApp);
      if (currentTab === analyticsTab) await renderWeightInsights(supabase, analyticsUser, nutritionProfile);
    },
    activity: async () => {
      await initAnalytics(supabase, analyticsUser, analyticsTab, showApp);
      if (currentTab === analyticsTab) await renderActivityInsights(supabase, analyticsUser);
    },
    reports: () => renderReportInsights(supabase, analyticsUser),
    coach: () => renderCoachGuidance(supabase, analyticsUser, nutritionProfile, latestWeight)
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
      if (button.closest(".home-dashboard") && next === "meals") diarySelection = null;
      currentTab = next;
      window.scrollTo(0, 0);
      showApp();
    };
  });

  const logout = document.querySelector("#logout");
  if (logout) logout.onclick = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) return showMessage(error.message);
    diarySelection = null;
    currentTab = "home";
    currentUser = null;
    showLogin();
  };

  const profileForm = document.querySelector("#profileForm");

  if (profileForm) {
    profileForm.onsubmit = async event => {
      event.preventDefault();
      const f = new FormData(profileForm);

      const optionalNumber = name => {
        const value = f.get(name);
        return value === "" || value === null ? null : Number(value);
      };
      const { error } = await supabase.from("profiles").upsert({
        id: currentUser.id,
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
      }, { onConflict: "id" });

      if (error) return showMessage("儲存失敗：" + error.message);
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
    stageForm.onsubmit = async event => {
      event.preventDefault();
      const f = new FormData(stageForm);
      const stageId = f.get("stage_id");

      const payload = {
        user_id: currentUser.id,
        stage_name: f.get("stage_name"),
        target_weight_kg: Number(f.get("target_weight_kg")),
        target_date: f.get("target_date"),
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
    };

    document.querySelectorAll(".edit-stage").forEach(button => {
      button.onclick = () => {
        const stage = stages.find(s => s.id === button.dataset.id);
        if (!stage) return;

        stageForm.elements.stage_id.value = stage.id;
        stageForm.elements.stage_name.value = stage.stage_name;
        stageForm.elements.target_weight_kg.value = stage.target_weight_kg;
        stageForm.elements.target_date.value = stage.target_date;

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
  }

}

async function refresh() {
  const { data } = await supabase.auth.getSession();
  currentUser = data.session?.user || null;
  await showApp();
}

supabase.auth.onAuthStateChange((event, session) => {
  const nextUser = session?.user || null;
  if (currentUser?.id && currentUser.id === nextUser?.id && (event === "TOKEN_REFRESHED" || event === "SIGNED_IN")) {
    currentUser = nextUser;
    return;
  }
  if (currentUser?.id !== nextUser?.id) {
    diarySelection = null;
    currentTab = "home";
  }
  currentUser = nextUser;
  showApp();
});

refresh();
