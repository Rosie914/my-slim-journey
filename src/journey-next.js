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
const card=(title,body)=>`<section class="card next-card"><h3>${safe(title)}</h3>${body}</section>`;
function place(id,html,anchor,where='afterend'){document.getElementById(id)?.remove();if(!anchor)return;const el=document.createElement('div');el.id=id;el.innerHTML=html;anchor.insertAdjacentElement(where,el);}
function goals(profile,weight){return calculateNutrition(profile,weight?.weight_kg??null)}
function bar(value,target){const p=target>0?Math.max(0,Math.min(100,value/target*100)):0;return `<div class="next-meter" role="progressbar" aria-valuenow="${Math.round(p)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${p}%"></span></div>`}
async function mealsBetween(db,uid,start,days){const [a,b]=range(start,days);return actual(await fetchAll(db.from('meals').select('source,eaten_at,meal_items(calories,protein_g,carbs_g,fat_g)').eq('user_id',uid).gte('eaten_at',a).lt('eaten_at',b).order('id')));}
export async function renderDailyBudget(db,uid,profile,weight){
 const anchor=[...document.querySelectorAll('.card')].find(x=>x.textContent.includes("TODAY'S NUTRITION SUMMARY"));if(!anchor)return;
 const day=tw(),week=add(day,-6),meals=await mealsBetween(db,uid,week,7);if(!document.contains(anchor))return;
 const todayMeals=meals.filter(m=>tw(m.eaten_at)===day),t=totals(todayMeals),g=goals(profile,weight);
 const budget=g.ready?`<div class="next-stats"><div><strong>${g.calorieTarget}</strong><small>今日目標 kcal</small></div><div><strong>${Math.round(t.calories)}</strong><small>已攝取 kcal</small></div><div><strong>${Math.round(g.calorieTarget-t.calories)}</strong><small>${t.calories>g.calorieTarget?'超出目標 kcal':'剩餘 kcal'}</small></div></div>${bar(t.calories,g.calorieTarget)}<p>蛋白質 ${t.protein.toFixed(1)} / ${g.protein} g，${t.protein>=g.protein?'已達目標':`尚差 ${(g.protein-t.protein).toFixed(1)} g`}</p>${bar(t.protein,g.protein)}`:'<p class="muted">請先在設定完成個人資料，並記錄體重，才能計算每日預算。</p>';
 const days=Array.from({length:7},(_,i)=>add(week,i));const cells=days.map(d=>{const m=meals.filter(x=>tw(x.eaten_at)===d),s=totals(m);return `<div class="next-day ${d===day?'next-today':''}"><b>${safe(d.slice(5))}</b><small>${m.length?Math.round(s.calories)+' kcal':'未紀錄'}</small><small>${m.length?s.protein.toFixed(0)+'g 蛋白質':'—'}</small></div>`}).join('');
 place('nextHome',card('今日熱量預算',budget+'<p class="muted">依個人設定估算；剩餘熱量不代表必須吃滿。未紀錄餐點不會自動估算。</p>')+card('最近七日飲食日曆',`<div class="next-calendar">${cells}</div><p class="muted">以台灣時間分日；只統計實際飲食，不含預計餐點。</p>`),anchor);
}
async function recentWeight(db,uid){const [a,b]=range(add(tw(),-90),91);return fetchAll(db.from('weight_logs').select('weight_kg,logged_at').eq('user_id',uid).gte('logged_at',a).lt('logged_at',b).order('logged_at',{ascending:true}));}
function trend(logs){const byDay=new Map();for(const l of logs)byDay.set(tw(l.logged_at),num(l.weight_kg));const points=[...byDay].sort((a,b)=>a[0].localeCompare(b[0]));if(points.length<8)return null;const first=points[0],last=points.at(-1);const days=(Date.parse(last[0])-Date.parse(first[0]))/86400000;if(days<21)return null;const slope=(last[1]-first[1])/days*7;return {slope,days,points:points.length,last:last[1]};}
export async function renderWeightForecast(db,uid,profile){const anchor=document.getElementById('insightWeight');if(!anchor)return;const logs=await recentWeight(db,uid);if(!document.contains(anchor))return;const t=trend(logs),target=Number(profile?.target_weight_kg);let body='<p class="muted">需要至少 8 個不同日期、涵蓋至少 21 天的體重紀錄，才顯示初步趨勢。</p>';
 if(t){body=`<p>近 ${t.days} 天（${t.points} 個紀錄日）觀察到的粗略趨勢：<b>${t.slope>0?'+':''}${t.slope.toFixed(2)} kg／週</b></p>`;if(Number.isFinite(target)&&target>0&&t.last>target&&t.slope<-0.05){const weeks=(t.last-target)/(-t.slope);body+=weeks<=104?`<p>若相同趨勢持續，約 <b>${Math.ceil(weeks)} 週</b>可能接近 ${target} kg。</p>`:'<p>依目前趨勢，目標時間無法可靠估計。</p>';}else{body+='<p>目前趨勢不適合推算達標日期（可能已達標、趨勢持平或體重上升）。</p>';}body+='<p class="muted">僅為簡易線性推估，會受水分、月經週期、測量時間等影響；不是保證，也不建議為趕上日期而過度限制飲食。</p>';}
 place('nextForecast',card('減重進度預測',body),anchor);
}
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
    fetchAll(db.from("activity_logs").select("duration_minutes,steps").eq("user_id", uid)
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
