
const FACTORS={sedentary:1.2,light:1.375,moderate:1.55,active:1.725,very_active:1.9};
const LABELS={sedentary:"久坐，幾乎沒有運動",light:"輕量活動，每週約 1–3 天",moderate:"中度活動，每週約 3–5 天",active:"高度活動，每週約 6–7 天",very_active:"非常高活動量"};
const num=v=>v===null||v===undefined||v===""?null:Number.isFinite(Number(v))?Number(v):null;
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const day=()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),d.getDate())};
const date=v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v||""))return null;const d=new Date(v+"T12:00:00");return Number.isNaN(d.getTime())?null:d};
const ageOf=b=>{const d=date(b);if(!d)return null;const now=day();let a=now.getFullYear()-d.getFullYear();if(now.getMonth()<d.getMonth()||(now.getMonth()===d.getMonth()&&now.getDate()<d.getDate()))a--;return a>0&&a<120?a:null};
export function calculateNutrition(profile,currentWeight){
 const height=num(profile?.height_cm),weight=num(currentWeight)??num(profile?.start_weight_kg),age=ageOf(profile?.birth_date),sex=profile?.sex;
 const missing=[];
 if(!(height>0))missing.push("身高");
 if(!(weight>0))missing.push("目前體重（或起始體重）");
 if(!age)missing.push("出生日期");
 if(!["female","male"].includes(sex))missing.push("生理性別");
 if(missing.length)return {ready:false,missing};
 const bmr=Math.round(10*weight+6.25*height-5*age+(sex==="male"?5:-161));
 const tdee=Math.round(bmr*(FACTORS[profile?.activity_level]||1.2));
 const stages=[...(profile?._stages||[])].filter(s=>date(s.target_date)&&num(s.target_weight_kg)>0).sort((a,b)=>a.target_date.localeCompare(b.target_date));
 const today=day();
 const active=stages.find(s=>date(s.target_date)>=today)||null;
 const goalMode=profile?.goal_mode||"lose";
 const targetWeight=num(active?.target_weight_kg);
 const daysRemaining=active?Math.max(1,Math.ceil((date(active.target_date)-today)/86400000)):null;
 const desiredChange=targetWeight===null?0:weight-targetWeight;
 const requiredWeekly=daysRemaining?Math.max(0,desiredChange*7/daysRemaining):0;
 // Conservative rate and calorie bounds: no deadline-driven crash dieting.
 const safeWeekly=Math.min(0.5,weight*0.0075);
 const weeklyChange=goalMode==="lose"?Math.min(requiredWeekly,safeWeekly):0;
 const floor=sex==="female"?1200:1500;
 const deficit=goalMode==="lose"?Math.min(500,weeklyChange*7700/7):0;
 let calorieTarget=goalMode==="gain"?tdee+150:Math.round(tdee-deficit);
 calorieTarget=Math.max(floor,calorieTarget);
 const calorieOverride=num(profile?.calorie_target_override);
 if(calorieOverride!==null&&calorieOverride>=floor)calorieTarget=Math.round(calorieOverride);
 const protein=Math.round(Math.max(0,num(profile?.protein_target_g)??weight*1.6));
 const fat=Math.round(Math.max(0,num(profile?.fat_target_g)??weight*0.8));
 const carbs=Math.round(Math.max(0,num(profile?.carbs_target_g)??(calorieTarget-protein*4-fat*9)/4));
 const macroCalories=protein*4+carbs*4+fat*9;
 const warnings=[];
 if(active&&requiredWeekly>safeWeekly+0.02)warnings.push("此階段期限要求的減重速度較快；已使用較保守的熱量目標，建議延長期限。");
 if(goalMode==="lose"&&!active)warnings.push("尚未設定未來的減重階段，目前以維持熱量估算。");
 if(goalMode==="lose"&&active&&desiredChange<=0)warnings.push("已達到此階段目標，暫以維持熱量估算。");
 if(tdee-deficit<floor&&goalMode==="lose"&&deficit>0)warnings.push("估計消耗較低，已套用最低熱量保護；不應為了期限繼續降低攝取。");
 return {ready:true,age,bmr,tdee,calorieTarget,protein,carbs,fat,macroCalories,
  goalMode,goalLabel:({lose:"減脂",maintain:"維持體重",gain:"增肌"})[goalMode]||"自訂",
  activityLabel:LABELS[profile?.activity_level]||LABELS.sedentary,
  targetDate:active?.target_date||null,daysRemaining:active?daysRemaining:null,
  currentWeight:weight,targetWeight,targetBodyFat:num(profile?.target_body_fat_pct),
  weeklyChange,requiredWeekly,stageName:active?.stage_name||null,warnings};
}
function bar(label,actual,target,unit){
 const a=Math.max(0,num(actual)??0),t=Math.max(0,num(target)??0);
 const pct=t>0?Math.min(100,100*a/t):0;
 return `<div class="nutrition-progress-item"><div class="nutrition-progress-label"><span>${label}</span><b>${a.toFixed(label==="熱量"?0:1)} / ${t.toFixed(0)} ${unit}</b></div><div class="nutrition-progress-track"><div class="nutrition-progress-fill" style="width:${pct}%"></div></div></div>`;
}
export function renderNutritionSummary(profile,currentWeight,totals){
 const g=calculateNutrition(profile,currentWeight);
 if(!g.ready)return `<section class="card nutrition-card"><p class="eyebrow">DAILY NUTRITION PLAN</p><h2>設定你的營養目標</h2><p>尚缺少：<strong>${g.missing.map(esc).join("、")}</strong></p><p class="muted">請至「設定」補齊並按「儲存個人設定」。營養目標的進階欄位可以全部留空。</p></section>`;
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
