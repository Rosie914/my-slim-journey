
const FACTORS={sedentary:1.2,light:1.375,moderate:1.55,active:1.725,very_active:1.9};
const LABELS={sedentary:"久坐，幾乎沒有運動",light:"輕量活動，每週約 1–3 天",moderate:"中度活動，每週約 3–5 天",active:"高度活動，每週約 6–7 天",very_active:"非常高活動量"};
const num=v=>v===null||v===undefined||v===""?null:Number.isFinite(Number(v))?Number(v):null;
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const DAY_MS = 86400000;
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
 const activityFactor = FACTORS[profile?.activity_level] || FACTORS.sedentary;
 const tdee = Math.round(bmr * activityFactor);
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
 const dueToday = goalMode === "lose" && daysRemaining === 0 && desiredChange > 0;
 const reached = goalMode === "lose" && active && desiredChange <= 0;
 const fastLoss = goalMode === "lose" && observedChange !== null && -observedChange > rateLimit;
 const flatOrRising = goalMode === "lose" && observedChange !== null && observedChange >= -0.1;
 const paused = dueToday || fastLoss || reached;
 const plannedRate = goalMode === "lose" && !paused ? Math.min(requiredWeekly, rateLimit) : 0;
 // When progress is flat, use the preceding window's plan as a ceiling for the deficit.
 const earlierRate = flatOrRising && daysRemaining !== null && targetWeight !== null
  ? Math.max(0, (previousWeight - targetWeight) * 7 / (daysRemaining + 7)) : plannedRate;
 const rate = Math.min(plannedRate, earlierRate);
 const deficit = Math.min(500, rate * 7700 / 7);
 const automaticTarget = Math.max(floor, Math.round(goalMode === "gain" ? tdee + 150 : tdee - deficit));
 const override = num(profile?.calorie_target_override);
 const manual = override !== null && override >= floor;
 const calorieTarget = manual ? Math.round(override) : automaticTarget;
 const protein = Math.round(Math.max(0, num(profile?.protein_target_g) ?? weight * 1.6));
 const fat = Math.round(Math.max(0, num(profile?.fat_target_g) ?? weight * 0.8));
 const carbs = Math.round(Math.max(0, num(profile?.carbs_target_g) ?? (calorieTarget - protein * 4 - fat * 9) / 4));
 const macroCalories = protein * 4 + carbs * 4 + fat * 9;
 const energyDifference = calorieTarget - tdee;
 // The activity multiplier already covers habitual movement. Only plan extra activity.
 const plannedExtraActivity = goalMode === "lose" && active && !paused
  ? Math.min(200, Math.max(0, Math.round(deficit + energyDifference))) : 0;
 const plannedDeficit = Math.max(0, plannedExtraActivity - energyDifference);
 const weeklyChange = plannedDeficit * 7 / 7700;
 const warnings = [];
 if (!manual && fastLoss) {
  warnings.push("近兩段週平均的下降幅度高於此計畫的上限，這次改以維持熱量估算。");
 } else if (!manual && (dueToday)) {
  warnings.push("階段期限為今天，熱量改以維持估算。");
 } else if (!manual && (reached)) {
  warnings.push("已達此階段的體重目標，熱量改以維持估算。");
 } else if (!manual && (goalMode === "lose" && !active)) {
  warnings.push("目前沒有進行中的階段，以維持熱量估算。");
 } else if (!manual && (goalMode === "lose" && requiredWeekly > rateLimit + 0.02)) {
  warnings.push("依原期限推算的速度較快，熱量目標使用較保守的速度。");
 }
 if (rate < plannedRate && !manual) warnings.push("週平均持平或回升，本次沿用前一段的熱量差上限。");
 if (override !== null && !manual) warnings.push("自訂熱量低於下限，已採用自動估算。");
 if (!manual && deficit > 0 && tdee - deficit < floor) warnings.push("已套用 App 的最低熱量保護。");

 return {
  ready: true, age, sex, height, bmr, tdee, calorieTarget, protein, carbs, fat, macroCalories,
  goalMode, goalLabel: ({ lose: "減脂", maintain: "維持體重", gain: "增肌" })[goalMode] || "自訂",
  activityLabel: LABELS[profile?.activity_level] || LABELS.sedentary,
  targetDate: active?.target_date ?? null, daysRemaining, currentWeight: weight, targetWeight,
  targetBodyFat: num(profile?.target_body_fat_pct), stageName: active?.stage_name ?? null,
  weeklyChange, requiredWeekly, observedChange, energyDifference, plannedExtraActivity, plannedDeficit,
  activityFactor, rateLimit, plannedRate, appliedRate: rate, dailyIntakeDeficit: deficit,
  calorieFloor: floor, automaticTarget, trendWeight, manual, warnings
 };
}

export function renderNutritionBasis(goal) {
 if (!goal.ready) return "";
 const trend = goal.trendWeight === null ? "最新體重或起始體重" : "最近完整 7 天平均";
 const stagePace = goal.targetWeight === null || goal.daysRemaining === null
  ? "目前沒有期限階段速度" : `依階段期限需每週約 ${goal.requiredWeekly.toFixed(2)} kg`;
 const observed = goal.observedChange === null ? "尚無兩段完整體重週平均可比較"
  : `近兩段 7 天平均變化 ${goal.observedChange > 0 ? "+" : ""}${goal.observedChange.toFixed(2)} kg`;
 const targetSource = goal.manual ? "自訂攝取目標" : "公式自動攝取目標";
 const intakeEquation = goal.manual
  ? `自訂 ${goal.calorieTarget} kcal（公式參考值 ${goal.automaticTarget} kcal）`
  : `${goal.tdee} − ${goal.dailyIntakeDeficit} = ${goal.calorieTarget} kcal`;
 const exerciseEquation = `${goal.plannedExtraActivity} − (${goal.calorieTarget} − ${goal.tdee}) = ${goal.plannedDeficit} kcal`;
 return `<div class="nutrition-basis">
  <p class="nutrition-basis-intro">${targetSource} · 使用${trend} ${goal.currentWeight.toFixed(2)} kg。</p>
  <div class="nutrition-basis-grid">
   <div><span>基礎代謝 BMR</span><b>${goal.bmr} kcal</b><small>10 × ${goal.currentWeight.toFixed(2)} + 6.25 × ${goal.height} − 5 × ${goal.age} ${goal.sex === "male" ? "+ 5" : "− 161"}</small></div>
   <div><span>日常總消耗 TDEE</span><b>${goal.tdee} kcal</b><small>${goal.bmr} × 活動係數 ${goal.activityFactor}</small></div>
   <div><span>階段期限要求</span><b>${stagePace}</b><small>${goal.targetWeight === null ? "先設定一個階段目標" : `目標 ${goal.targetWeight} kg · ${goal.targetDate} · 剩 ${goal.daysRemaining} 天`}</small></div>
   <div><span>計畫採用速度</span><b>每週約 ${goal.weeklyChange.toFixed(2)} kg</b><small>${goal.appliedRate.toFixed(2)} kg/週用於飲食與額外運動計畫</small></div>
   <div><span>每日攝取目標</span><b>${goal.calorieTarget} kcal</b><small>${intakeEquation}</small></div>
   <div><span>額外運動與計畫赤字</span><b>${goal.plannedExtraActivity} / ${goal.plannedDeficit} kcal</b><small>${exerciseEquation} · 單位皆為每日</small></div>
  </div>
  <p class="nutrition-basis-note">${observed}。活動係數已包含日常活動；額外運動另行列入。這是公式與規則計算，並非 AI 判斷。</p>
 </div>`;
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
