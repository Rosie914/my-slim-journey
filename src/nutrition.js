
const FACTORS={sedentary:1.2,light:1.375,moderate:1.55,active:1.725,very_active:1.9};
const LABELS={sedentary:"久坐，幾乎沒有運動",light:"輕量活動，每週約 1–3 天",moderate:"中度活動，每週約 3–5 天",active:"高度活動，每週約 6–7 天",very_active:"非常高活動量"};
const num=v=>v===null||v===undefined||v===""?null:Number.isFinite(Number(v))?Number(v):null;
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const DAY_MS = 86400000;
const adultUnderweightBMI = 18.5;
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
 timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit"
});
const day = () => dateFormatter.format(new Date());
const date = value => {
 if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
 const timestamp = Date.parse(value + "T00:00:00Z");
 return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
  ? timestamp : null;
};
const ageOf = (birth, today) => {
 if (date(birth) === null) return null;
 const age = Number(today.slice(0, 4)) - Number(birth.slice(0, 4))
  - Number(today.slice(5) < birth.slice(5));
 return age > 0 && age < 120 ? age : null;
};

export function calculateNutrition(profile, currentWeight, today = day()) {
 const height = num(profile?.height_cm);
 const latest = num(currentWeight) ?? num(profile?.start_weight_kg);
 const age = ageOf(profile?.birth_date, today);
 const sex = profile?.sex;
 const missing = [];
 if (!(height > 0)) missing.push("身高");
 if (!(latest > 0)) missing.push("目前體重（或起始體重）");
 if (!age) missing.push("出生日期");
 if (!["female", "male"].includes(sex)) missing.push("生理性別");
 if (missing.length) return { ready: false, missing };
 if (age < 20) return { ready: false, missing: [], reason: "此營養估算適用於 20 歲以上的成人。" };

 const weightTrend = profile?._weightTrend;
 const recent = weightTrend?.recent;
 const previous = weightTrend?.previous;
 const trendWeight = recent?.days >= 3 && num(recent.average) > 0 ? recent.average : null;
 const weight = trendWeight ?? latest;
 const previousWeight = previous?.days >= 3 && num(previous.average) > 0 ? previous.average : null;
 const observedChange = trendWeight !== null && previousWeight !== null
  ? Math.round((trendWeight - previousWeight) * 100) / 100 : null;
 const bmr = Math.round(10 * weight + 6.25 * height - 5 * age + (sex === "male" ? 5 : -161));
 const tdee = Math.round(bmr * (FACTORS[profile?.activity_level] || 1.2));
 const active = [...(profile?._stages || [])]
  .filter(stage => date(stage.target_date) !== null && stage.target_date >= today && num(stage.target_weight_kg) > 0)
  .sort((a, b) => a.target_date.localeCompare(b.target_date))[0];
 const goalMode = profile?.goal_mode || "lose";
 const targetWeight = num(active?.target_weight_kg);
 const daysRemaining = active ? Math.round((date(active.target_date) - date(today)) / DAY_MS) : null;
 const desiredChange = targetWeight === null ? 0 : weight - targetWeight;
 const requiredWeekly = daysRemaining === null ? 0 : Math.max(0, desiredChange * 7 / Math.max(1, daysRemaining));
 const rateLimit = Math.min(0.5, weight * 0.0075);
 const floor = sex === "female" ? 1200 : 1500;
 const minimumWeight = adultUnderweightBMI * (height / 100) ** 2;
 const weightGuard = goalMode === "lose" && Math.min(weight, latest) <= minimumWeight;
 const stageGuard = goalMode === "lose" && targetWeight !== null && targetWeight < minimumWeight;
 const dueToday = goalMode === "lose" && daysRemaining === 0 && desiredChange > 0;
 const reached = goalMode === "lose" && active && desiredChange <= 0;
 const fastLoss = goalMode === "lose" && observedChange !== null && -observedChange > rateLimit;
 const flatOrRising = goalMode === "lose" && observedChange !== null && observedChange >= -0.1;
 const paused = weightGuard || stageGuard || dueToday || fastLoss || reached;
 const plannedRate = goalMode === "lose" && !paused ? Math.min(requiredWeekly, rateLimit) : 0;
 // When progress is flat, use the preceding window's plan as a ceiling for the deficit.
 const earlierRate = flatOrRising && daysRemaining !== null && targetWeight !== null
  ? Math.max(0, (previousWeight - targetWeight) * 7 / (daysRemaining + 7)) : plannedRate;
 const rate = Math.min(plannedRate, earlierRate);
 const deficit = Math.min(500, rate * 7700 / 7);
 const automaticTarget = Math.max(floor, Math.round(goalMode === "gain" ? tdee + 150 : tdee - deficit));
 const override = num(profile?.calorie_target_override);
 const manual = override !== null && override >= floor && (!paused || override >= tdee);
 const calorieTarget = manual ? Math.round(override) : automaticTarget;
 const protein = Math.round(Math.max(0, num(profile?.protein_target_g) ?? weight * 1.6));
 const fat = Math.round(Math.max(0, num(profile?.fat_target_g) ?? weight * 0.8));
 const carbs = Math.round(Math.max(0, num(profile?.carbs_target_g) ?? (calorieTarget - protein * 4 - fat * 9) / 4));
 const macroCalories = protein * 4 + carbs * 4 + fat * 9;
 const energyDifference = calorieTarget - tdee;
 const weeklyChange = Math.max(0, -energyDifference) * 7 / 7700;
 const warnings = [];
 if (weightGuard || stageGuard) {
  warnings.push("目前體重或階段目標達到成人體重過輕的篩檢界線，熱量改以維持估算。");
 } else if (fastLoss) {
  warnings.push("近兩段週平均的下降幅度高於此計畫的上限，這次改以維持熱量估算。");
 } else if (dueToday) {
  warnings.push("階段期限為今天，熱量改以維持估算。");
 } else if (reached) {
  warnings.push("已達此階段的體重目標，熱量改以維持估算。");
 } else if (goalMode === "lose" && !active) {
  warnings.push("目前沒有進行中的階段，以維持熱量估算。");
 } else if (goalMode === "lose" && requiredWeekly > rateLimit + 0.02) {
  warnings.push("依原期限推算的速度較快，熱量目標使用較保守的速度。");
 }
 if (rate < plannedRate && !manual) warnings.push("週平均持平或回升，本次沿用前一段的熱量差上限。");
 if (paused && override !== null && !manual) warnings.push("目前暫緩熱量赤字，因此這次採用維持估算。");
 if (!manual && deficit > 0 && tdee - deficit < floor) warnings.push("已套用 App 的最低熱量保護。");

 return {
  ready: true, age, bmr, tdee, calorieTarget, protein, carbs, fat, macroCalories,
  goalMode, goalLabel: ({ lose: "減脂", maintain: "維持體重", gain: "增肌" })[goalMode] || "自訂",
  activityLabel: LABELS[profile?.activity_level] || LABELS.sedentary,
  targetDate: active?.target_date ?? null, daysRemaining, currentWeight: weight, targetWeight,
  targetBodyFat: num(profile?.target_body_fat_pct), stageName: active?.stage_name ?? null,
  weeklyChange, requiredWeekly, observedChange, energyDifference, trendWeight, manual, warnings
 };
}

export function renderNutritionBasis(goal) {
 if (!goal.ready) return "";
 const trend = goal.trendWeight === null ? "最新體重或起始體重" : "最近完整 7 天平均";
 const source = goal.manual ? "手動熱量設定" : "自動估算";
 const energy = goal.energyDifference === 0 ? "與估計消耗相同"
  : `比估計消耗${goal.energyDifference < 0 ? "少" : "多"} ${Math.abs(goal.energyDifference)} kcal`;
 const pace = goal.observedChange === null ? "" :
  `<p>近兩段 7 天平均相差 ${goal.observedChange > 0 ? "+" : ""}${goal.observedChange.toFixed(2)} kg。</p>`;
 return `<p>${source} · 以${trend} ${goal.currentWeight.toFixed(2)} kg 計算。</p>
  <p>每日熱量目標 <b>${goal.calorieTarget} kcal</b>，${energy}。</p>${pace}`;
}
function bar(label,actual,target,unit){
 const a=Math.max(0,num(actual)??0),t=Math.max(0,num(target)??0);
 const pct=t>0?Math.min(100,100*a/t):0;
 return `<div class="nutrition-progress-item"><div class="nutrition-progress-label"><span>${label}</span><b>${a.toFixed(label==="熱量"?0:1)} / ${t.toFixed(0)} ${unit}</b></div><div class="nutrition-progress-track"><div class="nutrition-progress-fill" style="width:${pct}%"></div></div></div>`;
}
export function renderNutritionSummary(profile,currentWeight,totals){
 const g=calculateNutrition(profile,currentWeight);
 if(!g.ready)return `<section class="card nutrition-card"><p class="eyebrow">DAILY NUTRITION PLAN</p><h2>設定你的營養目標</h2><p>${g.reason ? esc(g.reason) : `尚缺少：<strong>${g.missing.map(esc).join("、")}</strong>`}</p><p class="muted">請至「設定」補齊並按「儲存個人設定」。營養目標的進階欄位可以全部留空。</p></section>`;
 const a=totals||{calories:0,protein:0,carbs:0,fat:0};
 const remaining=g.calorieTarget-(num(a.calories)??0);
 return `<section class="card nutrition-card">
 <p class="eyebrow">DAILY NUTRITION PLAN</p>
 <div class="nutrition-heading"><div><h2>${g.calorieTarget.toLocaleString("zh-TW")} kcal</h2><p class="muted">每日建議熱量 · ${esc(g.goalLabel)}${g.stageName?" · "+esc(g.stageName):""}</p></div><span class="nutrition-goal-tag">${esc(g.goalLabel)}</span></div>
 <div class="nutrition-energy"><div><span>已攝取</span><b>${Math.round(num(a.calories)??0)} kcal</b></div><div><span>${remaining>=0?"剩餘":"超出"}</span><b>${Math.abs(Math.round(remaining))} kcal</b></div></div>
 ${bar("熱量",a.calories,g.calorieTarget,"kcal")}${bar("蛋白質",a.protein,g.protein,"g")}${bar("碳水",a.carbs,g.carbs,"g")}${bar("脂肪",a.fat,g.fat,"g")}
 <div class="nutrition-detail-grid"><div><span>BMR 基礎代謝</span><b>${g.bmr} kcal</b></div><div><span>TDEE 每日總消耗</span><b>${g.tdee} kcal</b></div><div><span>蛋白質目標</span><b>${g.protein} g</b></div><div><span>脂肪目標</span><b>${g.fat} g</b></div></div>
 <p class="muted">${esc(g.activityLabel)}</p>
 <p class="muted">${g.stageName?`階段目標：${esc(g.stageName)} · ${g.targetWeight} kg · ${g.targetDate}（剩餘 ${g.daysRemaining} 天）`:"目前無進行中的階段"}</p>
 <p class="muted">依階段推算每週約 ${g.weeklyChange.toFixed(2)} kg；每日預估熱量差 ${Math.max(0,g.tdee-g.calorieTarget)} kcal。</p>
 ${g.warnings.map(w=>`<p class="muted" role="status">${esc(w)}</p>`).join("")}
 ${Math.abs(g.macroCalories-g.calorieTarget)>5?`<p class="muted">三大營養素換算熱量 ${g.macroCalories} kcal，與熱量目標不同；若使用手動設定，請檢查數值。</p>`:""}
 <p class="nutrition-disclaimer">以上為公式估算及規則式建議，非 AI 醫療判斷；需依實際體重趨勢與健康狀況調整。</p>
 </section>`;
}
