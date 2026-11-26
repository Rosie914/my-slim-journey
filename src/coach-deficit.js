import { calculateNutrition } from "./nutrition.js";
import { loadNutritionTrend } from "./journey-next.js";
import { loadWeekDeficit, renderCoachDeficitDetails } from "./deficit-insights.js";

const numbers = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 });
const taiwanDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const safeDate = value => {
  // Home deep-link may be null when Coach is opened directly from the tab bar.
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return taiwanDate();
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : taiwanDate();
};
const fmt = value => Number.isFinite(Number(value)) ? numbers.format(Math.round(Number(value))) : "—";
const escape = value => String(value ?? "").replace(/[&<>"']/g, x => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[x]));
const planHeader = date => `<div class="coach-deficit-head"><div><span class="coach-deficit-eyebrow">減脂計畫 · ${date === taiwanDate() ? "本週" : escape(date) + " 所在週"}</span><h3>熱量赤字分析</h3></div><span class="coach-deficit-tag">計畫與紀錄</span></div>`;

function renderDeficitPlan(goal) {
  const daily = goal.goalMode === "lose" ? Math.max(0, Math.round(goal.plannedDeficit)) : 0;
  const optional = Math.max(0, Math.round(goal.plannedExtraActivity || 0));
  const stage = goal.targetWeight != null && goal.targetDate
    ? `<p class="coach-deficit-note"><strong>目前階段：</strong>${escape(goal.targetWeight)} kg · ${escape(goal.targetDate)}；依期限需每週約 ${Number(goal.requiredWeekly || 0).toFixed(2)} kg，計畫採用每週約 ${Number(goal.weeklyChange || 0).toFixed(2)} kg。</p>`
    : '<p class="coach-deficit-note">目前沒有進行中的減重階段，請至設定確認目標與期限。</p>';
  return `<div class="coach-deficit-grid" aria-label="依減脂階段計算的計畫熱量赤字">
    <div><span>每日計畫總赤字</span><strong>${fmt(daily)} <small>kcal</small></strong></div>
    <div><span>每週計畫總赤字</span><strong>${fmt(daily * 7)} <small>kcal</small></strong></div>
  </div>
  ${stage}
  <details class="msj-coach-plan-details"><summary>查看 TDEE 與目標計算依據</summary>
  <div class="coach-deficit-details">
    <div><span>原計畫 TDEE（依活動程度）</span><b>${fmt(goal.tdee)} kcal</b></div>
    <div><span>未同步 Apple TOTAL 時的備用 TDEE</span><b>${fmt(Math.round(goal.bmr * 1.2))} kcal</b></div>
    <div><span>每日攝取目標</span><b>${fmt(goal.calorieTarget)} kcal</b></div>
    <div><span>原計畫額外活動部分（選擇性）</span><b>${fmt(optional)} kcal</b></div>
  </div>
  <p class="coach-deficit-note">上方沿用原本減重階段的<strong>計畫值</strong>。下方優先使用 Apple Fitness 全天 TOTAL 減飲食；尚無 TOTAL 時才用久坐基準 TDEE＋已記錄運動。Apple TOTAL 已含運動，不再重複加計；額外運動不是硬性任務。</p>
  </details>`;
}

export async function mountCoachDeficit(db, uid, profile, latestWeight, referenceDate) {
  const anchor = document.querySelector("#anCoach");
  if (!anchor) return;
  anchor.querySelector(".coach-deficit")?.remove();
  const date = safeDate(referenceDate);
  const section = document.createElement("section");
  section.className = "coach-deficit";
  section.innerHTML = planHeader(date) + '<p class="coach-deficit-loading">正在讀取減脂計畫…</p>';
  anchor.prepend(section);
  // Existing Coach guidance also repeats the entire nutrition formula and weight/activity
  // reports. Keep it accessible, but secondary to the deficit chart and AI coaching.
  const aiPanel=[...anchor.children].find(node=>node.classList?.contains('coach-ai'));
  if(aiPanel){
    const extra=document.createElement('details');extra.className='msj-coach-additional';
    const summary=document.createElement('summary');summary.textContent='展開營養、體重與近期紀錄分析';
    extra.append(summary);
    for(const node of [...anchor.childNodes]){
      if(node===section||node===aiPanel)continue;
      extra.append(node);
    }
    anchor.insertBefore(extra,aiPanel);
  }

  let goal;
  try {
    const trend = await loadNutritionTrend(db, uid, date).catch(() => null);
    if (!section.isConnected) return;
    goal = calculateNutrition({ ...profile, _weightTrend: trend }, Number(latestWeight?.weight_kg) || null, date);
  } catch (error) {
    console.warn("[Coach] plan calculation failed", error?.name || "UnknownError");
    if (section.isConnected) section.innerHTML = planHeader(date) + '<p class="coach-deficit-note">目標計算目前無法完成。請檢查個人資料與目標階段設定。</p>';
    return;
  }
  if (!goal.ready) {
    const reason = goal.reason || (goal.missing?.length ? `尚缺少：${goal.missing.join("、")}` : "個人資料尚未完整");
    section.innerHTML = planHeader(date) + `<p class="coach-deficit-note">${escape(reason)}。補齊後即可顯示計畫赤字。</p>`;
    return;
  }

  // Render the target FIRST. Reading meal logs must not erase the target on failure.
  section.innerHTML = planHeader(date) + renderDeficitPlan(goal)
    + '<div class="coach-deficit-records" aria-live="polite"><p class="coach-deficit-loading">正在讀取每日飲食與運動紀錄…</p></div>';
  const records = section.querySelector(".coach-deficit-records");
  async function refreshRecords() {
    records.innerHTML = '<p class="coach-deficit-loading">正在讀取 Apple TOTAL、飲食與運動的每日／每週進度…</p>';
    try {
      const overview = await loadWeekDeficit(db, uid, goal, date);
      if (!records.isConnected) return;
      // The source/method explanation already lives in the expandable detail of the chart.
      records.innerHTML = renderCoachDeficitDetails(overview);
    } catch (error) {
      console.warn("[Coach] meal history loading failed", error?.code || error?.name || "UnknownError");
      if (!records.isConnected) return;
      records.innerHTML = '<p class="coach-deficit-note" role="status">計畫目標已顯示，但飲食或運動明細暫時讀取失敗。請確認網路後重試；不會把缺少的紀錄當成 0。</p><button type="button" class="coach-deficit-retry">重新讀取進度</button>';
      records.querySelector(".coach-deficit-retry")?.addEventListener("click", refreshRecords, { once: true });
    }
  }
  await refreshRecords();
}

export const __test = { safeDate, renderDeficitPlan };
