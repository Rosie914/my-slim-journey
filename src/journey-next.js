// Batch 3: read-only, Taiwan-local wellness insights. No database writes.
import { calculateNutrition, renderNutritionBasis } from './nutrition.js';
const tw = (d=new Date()) => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(d));
const add=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const range=(day,n=1)=>[new Date(day+'T00:00:00+08:00').toISOString(),new Date(add(day,n)+'T00:00:00+08:00').toISOString()];
const num=x=>Number.isFinite(Number(x))?Number(x):0;
const safe=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
async function fetchAll(q){const out=[];for(let p=0;p<12;p++){const {data,error}=await q.range(p*500,p*500+499);if(error)throw error;out.push(...(data||[]));if((data||[]).length<500)return out;}throw Error('紀錄量超過本頁讀取上限');}
const actual=m=>m.filter(x=>x.source!=='planned');
function totals(meals){const t={calories:0,protein:0,carbs:0,fat:0};for(const m of meals)for(const x of m.meal_items||[]){t.calories+=num(x.calories);t.protein+=num(x.protein_g);t.carbs+=num(x.carbs_g);t.fat+=num(x.fat_g);}return t;}
async function mealsBetween(db,uid,start,days){const [a,b]=range(start,days);return actual(await fetchAll(db.from('meals').select('source,eaten_at,meal_items(calories,protein_g,carbs_g,fat_g)').eq('user_id',uid).gte('eaten_at',a).lt('eaten_at',b).order('id')));}
function summarizeCoachWeights(logs, start, split, end) {
  const latestByDay = new Map();
  for (const log of logs) {
    const timestamp = Date.parse(log.logged_at);
    const weight = Number(log.weight_kg);
    if (!Number.isFinite(timestamp) || !Number.isFinite(weight) || weight <= 0) continue;
    const day = tw(timestamp);
    if (day < start || day >= end) continue;
    const existing = latestByDay.get(day);
    if (!existing || timestamp > existing.timestamp) latestByDay.set(day, { timestamp, weight });
  }

  const previous = [];
  const recent = [];
  for (const [day, record] of latestByDay) {
    (day < split ? previous : recent).push(record.weight);
  }
  const summarize = weights => ({
    days: weights.length,
    average: weights.length ? weights.reduce((sum, weight) => sum + weight, 0) / weights.length : null
  });
  return { previous: summarize(previous), recent: summarize(recent) };
}

export async function loadNutritionTrend(db, uid, end = tw()) {
  const split = add(end, -7);
  const start = add(end, -14);
  const [from, to] = range(start, 14);
  const logs = await fetchAll(db.from("weight_logs").select("weight_kg,logged_at").eq("user_id", uid)
    .gte("logged_at", from).lt("logged_at", to).order("logged_at").order("id"));
  return summarizeCoachWeights(logs, start, split, end);
}

function coachStat(value, label) {
  return `<div><strong>${value}</strong><small>${label}</small></div>`;
}

function renderCoachTrend(weights, goal, start, split, end) {
  const { recent, previous } = weights;
  const minDays = 3;
  const enough = recent.days >= minDays && previous.days >= minDays;
  const change = enough ? Math.round((recent.average - previous.average) * 100) / 100 : null;
  const displayDate = day => day.slice(5).replace("-", "/");
  const metric = week => week.average === null ? "—" : week.average.toFixed(2) + " kg";
  const changeLabel = change === null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(2)} kg`;
  let message = "每段至少需要 3 天體重紀錄才能比較。";
  if (enough) {
    const direction = change < -0.1 ? "下降" : change > 0.1 ? "上升" : "接近持平";
    message = `最近 7 天的平均體重${direction}。持續觀察後續週平均，再回顧原本的計畫。`;
  }
  const windowLabel = (first, last, days) => `${displayDate(first)}–${displayDate(add(last, -1))} · ${days}/7 天`;
  let stage = '<p class="muted">目前無可顯示的階段目標。</p>';
  if (goal.ready && goal.targetDate && goal.targetWeight !== null) {
    stage = `<p>目前階段 <b>${safe(goal.stageName || "階段目標")}</b> · ${goal.targetWeight} kg · ${safe(goal.targetDate.replaceAll("-", "/"))}</p>`;
    if (enough && recent.average <= goal.targetWeight && goal.goalMode === "lose") {
      stage += '<p class="muted">最近 7 天平均已達目前階段的體重目標。</p>';
    } else if (enough && goal.goalMode === "lose") {
      stage += `<p class="muted">以最近 7 天平均計算，距離階段目標還有 ${(recent.average - goal.targetWeight).toFixed(2)} kg。</p>`;
    }
  }
  return `<div class="next-stats">
    ${coachStat(metric(previous), windowLabel(start, split, previous.days))}
    ${coachStat(metric(recent), windowLabel(split, end, recent.days))}
    ${coachStat(changeLabel, "兩段平均差")}
  </div><p>${message}</p>${stage}<p class="muted">以台灣時間計算至昨天。每天採最新一筆體重。</p>`;
}

function renderCoachRecords(meals, activities, goal) {
  const mealDays = new Set(meals.map(meal => tw(meal.eaten_at))).size;
  const sum = totals(meals);
  const minutes = activities.reduce((total, activity) => total + num(activity.duration_minutes), 0);
  const stepLogs = activities.filter(activity => activity.steps != null);
  const steps = stepLogs.reduce((total, activity) => total + num(activity.steps), 0);
  const burnedCalories = activities.length && activities.every(activity => activity.calories_burned != null && Number.isFinite(Number(activity.calories_burned)))
    ? new Intl.NumberFormat("zh-TW").format(activities.reduce((total, activity) => total + num(activity.calories_burned), 0))
    : activities.length ? "資料不完整" : "—";
  const perDay = value => mealDays ? (value / mealDays).toFixed(0) : "—";
  const format = new Intl.NumberFormat("zh-TW");
  const calorieDifference = mealDays ? Math.round(sum.calories / mealDays) - goal.calorieTarget : null;
  const proteinDifference = mealDays ? Math.round(sum.protein / mealDays) - goal.protein : null;
  const signed = value => (value > 0 ? "+" : "") + format.format(value);
  const comparison = goal.ready && mealDays >= 4
    ? `<p>目前每日目標為 ${format.format(goal.calorieTarget)} kcal、蛋白質 ${goal.protein} g。已記錄日期的日均差為熱量 ${signed(calorieDifference)} kcal、蛋白質 ${signed(proteinDifference)} g。</p>`
    : '<p class="muted">累積更多飲食紀錄並完成個人設定後，即可對照每日目標。</p>';
  return `<div class="next-stats">
    ${coachStat(perDay(sum.calories), "有紀錄日平均 kcal")}
    ${coachStat(perDay(sum.protein), "有紀錄日平均蛋白質 g")}
    ${coachStat(`${mealDays}/7`, "飲食紀錄天數")}
    ${coachStat(burnedCalories, "運動消耗 kcal")}
  </div>${comparison}
  <p>活動 ${activities.length} 筆 · ${format.format(minutes)} 分鐘 · ${stepLogs.length ? format.format(steps) + " 步" : "步數未記錄"}</p>
  <p class="muted">飲食平均按有紀錄的日期計算。活動統計採手動紀錄。</p>`;
}

export async function renderCoachGuidance(db, uid, profile, weight) {
  const anchor = document.getElementById("anCoach");
  if (!anchor) return;
  const end = tw();
  const split = add(end, -7);
  const start = add(end, -14);
  const [activityFrom, to] = range(split, 7);
  const [weightResult, mealResult, activityResult] = await Promise.allSettled([
    loadNutritionTrend(db, uid, end),
    mealsBetween(db, uid, split, 7),
    fetchAll(db.from("activity_logs").select("duration_minutes,steps,calories_burned").eq("user_id", uid)
      .gte("logged_at", activityFrom).lt("logged_at", to).order("id"))
  ]);
  if (!document.contains(anchor)) return;
  const goal = calculateNutrition({ ...profile, _weightTrend: weightResult.value }, weight?.weight_kg, end);
  const unavailable = '<p class="muted">暫時無法讀取這項紀錄。</p>';
  const weightSummary = weightResult.status === "fulfilled"
    ? renderCoachTrend(weightResult.value, goal, start, split, end)
    : unavailable;
  const recordsSummary = mealResult.status === "fulfilled" && activityResult.status === "fulfilled"
    ? renderCoachRecords(mealResult.value, activityResult.value, goal)
    : unavailable;
  const plan = goal.ready
    ? renderNutritionBasis(goal) + goal.warnings.map(warning => `<p class="muted">${safe(warning)}</p>`).join("")
    : `<p class="muted">${safe(goal.reason || "請先補齊個人與體重資料。")}</p>`;
  anchor.innerHTML = `<h3>目前營養估算</h3>${plan}
    <h3>近 14 天體重回顧</h3>${weightSummary}
    <h3>近 7 天飲食與活動</h3>${recordsSummary}`;
}
