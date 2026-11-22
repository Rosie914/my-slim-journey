import { calculateNutrition } from "./nutrition.js";
import { loadNutritionTrend } from "./journey-next.js";

const fmt = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 });
const taiwanDate = () => new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const safe = n => Number.isFinite(n) ? fmt.format(Math.max(0,Math.round(n))) : "—";

export async function mountCoachDeficit(db, uid, profile, latestWeight) {
  const anchor = document.querySelector("#anCoach");
  if (!anchor) return;
  const section = document.createElement("section");
  section.className = "coach-deficit";
  section.innerHTML = `<div class="coach-deficit-head"><div><span class="coach-deficit-eyebrow">減脂計畫</span><h3>熱量赤字分析</h3></div><span class="coach-deficit-tag">計畫值</span></div><p class="coach-deficit-loading">正在計算階段目標…</p>`;
  anchor.prepend(section);
  try {
    const trend = await loadNutritionTrend(db, uid).catch(() => null);
    if (!section.isConnected) return;
    const goal = calculateNutrition({ ...profile, _weightTrend: trend }, Number(latestWeight?.weight_kg) || null, taiwanDate());
    if (!goal.ready) {
      section.innerHTML = `<div class="coach-deficit-head"><h3>熱量赤字分析</h3></div><p>請先在設定中補齊身高、生日、體重及生理性別，才能計算目標。</p>`;
      return;
    }
    const isLoss = goal.goalMode === "lose";
    const daily = isLoss ? goal.plannedDeficit : 0;
    const weekly = daily * 7;
    const hasStage = Boolean(goal.targetDate);
    section.innerHTML = `<div class="coach-deficit-head"><div><span class="coach-deficit-eyebrow">減脂計畫</span><h3>熱量赤字分析</h3></div><span class="coach-deficit-tag">計畫值</span></div>
      <div class="coach-deficit-grid"><div><span>每日計畫赤字</span><strong>${safe(daily)} <small>kcal</small></strong></div><div><span>每週計畫赤字</span><strong>${safe(weekly)} <small>kcal</small></strong></div></div>
      <div class="coach-deficit-details"><div><span>估算每日總消耗（TDEE）</span><b>${safe(goal.tdee)} kcal</b></div><div><span>每日建議攝取</span><b>${safe(goal.calorieTarget)} kcal</b></div><div><span>預估每週體重變化</span><b>${isLoss && hasStage ? '−' + goal.weeklyChange.toFixed(2) + ' kg' : '—'}</b></div></div>
      <p class="coach-deficit-note">${!hasStage && isLoss ? '尚無進行中的減重階段，目前依維持熱量估算。' : goal.manual ? '目前使用手動攝取熱量設定，計畫赤字可能不同於自動建議。' : '依目前減重階段與活動程度推算；不代表每天必須額外運動消耗這些熱量。'}</p>
      <p class="coach-deficit-note">「實際赤字」需有可靠的每日總消耗與完整飲食紀錄才能估算；目前不把運動熱量直接加到 TDEE，也不將缺漏資料當成零。</p>`;
  } catch {
    if (section.isConnected) section.innerHTML = '<h3>熱量赤字分析</h3><p>暫時無法計算，請稍後重新開啟 Coach。</p>';
  }
}
