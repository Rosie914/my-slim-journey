import { calculateNutrition } from "./nutrition.js";
import { loadNutritionTrend } from "./journey-next.js";
import { loadWeekDeficit, renderCoachDeficitDetails } from "./deficit-insights.js";

const fmt = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 });
const taiwanDate = () => new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const safe = n => Number.isFinite(n) ? fmt.format(Math.max(0,Math.round(n))) : "—";

export async function mountCoachDeficit(db, uid, profile, latestWeight, referenceDate = taiwanDate()) {
  const anchor = document.querySelector("#anCoach");
  if (!anchor) return;
  const section = document.createElement("section");
  section.className = "coach-deficit";
  section.innerHTML = `<div class="coach-deficit-head"><div><span class="coach-deficit-eyebrow">減脂計畫</span><h3>熱量赤字分析</h3></div><span class="coach-deficit-tag">計畫值</span></div><p class="coach-deficit-loading">正在計算階段目標…</p>`;
  anchor.prepend(section);
  try {
    const trend = await loadNutritionTrend(db, uid).catch(() => null);
    if (!section.isConnected) return;
    const goal = calculateNutrition({ ...profile, _weightTrend: trend }, Number(latestWeight?.weight_kg) || null, referenceDate);
    if (!goal.ready) {
      section.innerHTML = `<div class="coach-deficit-head"><h3>熱量赤字分析</h3></div><p>請先在設定中補齊身高、生日、體重及生理性別，才能計算目標。</p>`;
      return;
    }
    const overview = await loadWeekDeficit(db, uid, goal, referenceDate);
    if (!section.isConnected) return;
    section.innerHTML = `<div class="coach-deficit-head"><div><span class="coach-deficit-eyebrow">減脂計畫 · ${referenceDate === taiwanDate() ? "本週" : referenceDate + " 所在週"}</span><h3>熱量赤字分析</h3></div><span class="coach-deficit-tag">估算值</span></div>
      ${renderCoachDeficitDetails(overview)}
      <p class="coach-deficit-note">這是依現有飲食記錄和 TDEE 推算的參考，不代表實際測得的熱量赤字。資料未完整時不會宣稱達標，也不會要求額外增加運動消耗。</p>`;
  } catch {
    if (section.isConnected) section.innerHTML = '<h3>熱量赤字分析</h3><p>暫時無法計算，請稍後重新開啟 Coach。</p>';
  }
}
