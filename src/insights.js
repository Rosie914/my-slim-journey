// Read-only insights for My Slim Journey. All date boundaries are Asia/Taipei.
import { calculateNutrition } from './nutrition.js';
const $ = id => document.getElementById(id);
const esc = x => String(x ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const val = x => Number.isFinite(Number(x)) ? Number(x) : 0;
const dateTW = (value=new Date()) => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const datePlus = (s,days) => new Date(Date.parse(`${s}T00:00:00Z`)+days*86400000).toISOString().slice(0,10);
const monday = s => {const d=new Date(`${s}T00:00:00Z`);return datePlus(s,-((d.getUTCDay()+6)%7))};
const bounds = (s,days=1) => [new Date(`${s}T00:00:00+08:00`).toISOString(),new Date(`${datePlus(s,days)}T00:00:00+08:00`).toISOString()];
async function all(q){let result=[];for(let page=0;page<20;page++){const {data,error}=await q.range(page*500,page*500+499);if(error)throw error;result.push(...(data||[]));if(!data||data.length<500)return result}throw Error('紀錄過多，請縮短查詢日期範圍')}
const sumItems = meals => {const r={calories:0,protein:0,carbs:0,fat:0};for(const m of meals)for(const x of m.meal_items||[]){r.calories+=val(x.calories);r.protein+=val(x.protein_g);r.carbs+=val(x.carbs_g);r.fat+=val(x.fat_g)}return r};
const actual = rows => rows.filter(x=>x.source!=='planned');
const avg = arr => arr.length?arr.reduce((s,x)=>s+x,0)/arr.length:null;
const fmt = (x,d=1) => x==null?'—':Number(x).toFixed(d);
function delta(now, previous, unit = '', digits = 1) {
 if (now == null || previous == null) return '—';
 const change = Number((now - previous).toFixed(digits));
 return `${change > 0 ? '+' : ''}${fmt(change, digits)}${unit}`;
}
function card(title,html){return `<section class="card insight-card"><h3>${esc(title)}</h3>${html}</section>`}
function insertAfter(anchor,html,id){document.getElementById(id)?.remove();const div=document.createElement('div');div.id=id;div.innerHTML=html;anchor?.insertAdjacentElement('afterend',div)}
function weeklyWeight(logs) {
 const grouped = new Map();
 for (const log of logs) {
  const weight = Number(log.weight_kg);
  if (!Number.isFinite(weight) || weight <= 0) continue;
  const day = dateTW(log.logged_at), week = monday(day);
  if (!grouped.has(week)) grouped.set(week, new Map());
  const days = grouped.get(week);
  const previous = days.get(day);
  if (!previous || Date.parse(log.logged_at) > Date.parse(previous.logged_at)) days.set(day, log);
 }
 return new Map([...grouped].map(([week, days]) => [
  week, { weight: avg([...days.values()].map(log => Number(log.weight_kg))), days: days.size }
 ]));
}

function weekSeries(logs, lastMonday, count) {
 const grouped = weeklyWeight(logs);
 return Array.from({ length: count }, (_, index) => {
  const week = datePlus(lastMonday, 7 * (index - count + 1));
  return { week, ...(grouped.get(week) ?? { weight: null, days: 0 }) };
 });
}

const shortDate = day => day.slice(5).replace('-', '/');
const stat = (value, label) => `<div><b>${value}</b><small>${label}</small></div>`;
const summary = (...cells) => `<div class="insight-summary">${cells.join('')}</div>`;
const kg = value => value === null ? '—' : `${fmt(value, 2)} kg`;
const displaySteps = value => value === null ? '—' : value.toLocaleString('zh-TW');

function weightChart(weeks) {
 const recorded = weeks.filter(week => week.weight !== null);
 if (!recorded.length) return '<p class="muted">這段期間沒有體重紀錄。</p>';
 const weights = recorded.map(week => week.weight);
 const low = Math.floor((Math.min(...weights) - 0.15) * 2) / 2;
 const high = Math.ceil((Math.max(...weights) + 0.15) * 2) / 2;
 const points = weeks.map((week, index) => ({
  ...week, x: 42 + 244 * index / (weeks.length - 1),
  y: week.weight === null ? null : 100 - 80 * (week.weight - low) / (high - low)
 }));
 const lines = points.slice(1).map((point, index) => {
  const prior = points[index];
  return point.y === null || prior.y === null ? '' : `<line x1="${prior.x}" y1="${prior.y}" x2="${point.x}" y2="${point.y}" stroke="#886991" stroke-width="2"/>`;
 }).join('');
 const dots = points.map(point => point.y === null ? '' : `<circle cx="${point.x}" cy="${point.y}" r="3.2" fill="#886991">
  <title>${point.week} · ${kg(point.weight)} · ${point.days} 天</title></circle>`).join('');
 return `<svg viewBox="0 0 310 125" width="100%" role="img" aria-label="週平均體重折線圖，詳細數值見下方表格">
  <g fill="#65585a" font-size="10">
  <text x="2" y="24">${fmt(high)}</text><text x="2" y="103">${fmt(low)}</text>
  <text x="42" y="119">${shortDate(weeks[0].week)}</text>
  <text x="286" y="119" text-anchor="end">${shortDate(weeks.at(-1).week)}</text></g>
  <path d="M42 20H286 M42 60H286 M42 100H286" stroke="#e8e0e4"/>${lines}${dots}
 </svg>`;
}

function stageReview(weeks, today, profile) {
 const stage = [...(profile?._stages || [])]
  .filter(entry => /^\d{4}-\d{2}-\d{2}$/.test(entry.target_date) && entry.target_date >= today && Number(entry.target_weight_kg) > 0)
  .sort((a, b) => a.target_date.localeCompare(b.target_date))[0];
 if (!stage) return '<p class="muted">目前沒有進行中的階段，可在「設定」新增。</p>';
 const finished = weeks.slice(0, -1);
 const latest = [...weeks].reverse().find(week => week.days >= 3);
 const comparison = latest
  ? `<p>最近一個至少記錄 3 天的週平均為 <b>${kg(latest.weight)}</b>（${shortDate(latest.week)} 起）。與階段目標相差 ${kg(Math.abs(latest.weight - Number(stage.target_weight_kg)))}。</p>`
  : '<p class="muted">累積同一週至少 3 天的紀錄後，會用週平均與階段目標比較。</p>';
 const recent = finished.slice(-3);
 let observed = '<p class="muted">最近 3 個完整週各有至少 3 天紀錄後，會顯示觀察到的每週變化。</p>';
 if (recent.length === 3 && recent.every(week => week.days >= 3)) {
  const perWeek = (recent[2].weight - recent[0].weight) / 2;
  observed = `<p>最近 3 個完整週觀察到的平均變化為 <b>${delta(perWeek, 0, ' kg／週', 2)}</b>。</p>`;
 }
 return `<p><b>${esc(stage.stage_name || '目前階段')}</b> · ${Number(stage.target_weight_kg)} kg · ${esc(stage.target_date)}</p>${comparison}${observed}`;
}

export async function renderWeightInsights(db, uid, profile) {
 const anchor = $('anWeightChart');
 if (!anchor) return;
 const today = dateTW(), lastMonday = monday(today);
 const [from] = bounds(datePlus(lastMonday, -105)), [, to] = bounds(today);
 const logs = await all(db.from('weight_logs').select('weight_kg,logged_at').eq('user_id', uid)
  .gte('logged_at', from).lt('logged_at', to).order('logged_at').order('id'));
 if (!document.contains(anchor)) return;
 const weeks = weekSeries(logs, lastMonday, 16);
 const current = weeks.at(-1), previous = weeks.at(-2);
 const change = current.days >= 3 && previous.days >= 3 ? delta(current.weight, previous.weight, ' kg', 2) : '—';
 const chartId = 'anWeeklyWeightChart';
 const history = weeks.slice().reverse().map(week => `<tr><td>${week.week}</td><td>${kg(week.weight)}</td><td>${week.days}/7</td></tr>`).join('');
 insertAfter(anchor.closest('section'), card('週平均體重',
  `${summary(stat(kg(current.weight), '本週平均'), stat(kg(previous.weight), '上週平均'), stat(change, '與上週差異'))}
  <label>圖表期間<select id="anWeightWeeks"><option value="8">最近 8 週</option><option value="16">最近 16 週</option></select></label>
  <div id="${chartId}">${weightChart(weeks.slice(-8))}</div>
  <p class="muted">週一開始，每天採最新一筆。兩週各至少記錄 3 天才顯示差異。</p>
  <details><summary>查看各週數值</summary><div class="insight-scroll"><table class="insight-table">
  <thead><tr><th>週一日期</th><th>平均體重</th><th>記錄天數</th></tr></thead><tbody>${history}</tbody></table></div></details>`)
  + card('階段進度', stageReview(weeks, today, profile)), 'insightWeight');
 anchor.closest('section').before($('insightWeight'));
 $('anWeightWeeks').onchange = event => { $(chartId).innerHTML = weightChart(weeks.slice(-Number(event.currentTarget.value))); };
}
function activityTotal(logs) {
 const stepLogs = logs.filter(log => log.steps != null);
 return {
  count: logs.length,
  minutes: logs.reduce((sum, log) => sum + val(log.duration_minutes), 0),
  steps: stepLogs.length ? stepLogs.reduce((sum, log) => sum + val(log.steps), 0) : null
 };
}

function activityDays(logs, week) {
 return Array.from({ length: 7 }, (_, index) => {
  const day = datePlus(week, index);
  return { day, ...activityTotal(logs.filter(log => dateTW(log.logged_at) === day)) };
 });
}

function dayBars(days, measure, { target = null, unit = '分' } = {}) {
 const max = Math.max(1, ...days.map(day => day[measure] ?? 0));
 const scale = target > 0 ? Math.max(target, ...days.map(day => day[measure] ?? 0)) : max;
 return `<div class="insight-bars">${days.map(day => {
  const value = day[measure], width = value == null ? 0 : Math.min(100, Math.max(0, value / scale * 100));
  const over = value != null && target > 0 && value > target;
  const state = measure === 'calories' ? day.calorieState : measure === 'burnedCalories' ? day.burnState : null;
  const text = value == null ? (state === 'incomplete' ? '資料不完整' : '未記錄') : `${Math.round(value)} ${unit}`;
  const mark = target > 0 ? target / scale * 100 : null;
  return `<div class="insight-bar-row${over ? ' is-over-target' : ''}"><span>${shortDate(day.day)}</span><div class="insight-track" aria-hidden="true"><div class="insight-fill" style="width:${width}%"></div>${mark !== null ? `<i class="insight-target-mark" style="left:${mark}%"></i>` : ''}</div><b>${text}${over ? '<small>超標</small>' : ''}</b></div>`;
 }).join('')}</div>`;
}

const activityQuery = (db, uid, from, to) => db.from('activity_logs').select('logged_at,duration_minutes,steps')
 .eq('user_id', uid).gte('logged_at', from).lt('logged_at', to).order('id');

export async function renderActivityInsights(db, uid) {
 const anchor = $('anActivityStats');
 if (!anchor) return;
 const today = dateTW(), week = monday(today), [from] = bounds(week), [, to] = bounds(today);
 const logs = await all(activityQuery(db, uid, from, to));
 if (!document.contains(anchor)) return;
 const total = activityTotal(logs);
 const days = activityDays(logs, week).map(day => ({ ...day, minutes: day.count ? day.minutes : null }));
 const section = anchor.closest('section');
 insertAfter(section, card(`本週活動 · ${shortDate(week)}–${shortDate(datePlus(week, 6))}`,
  summary(stat(total.count, '活動紀錄'), stat(total.minutes, '累計分鐘'), stat(displaySteps(total.steps), '紀錄步數'))
  + dayBars(days, 'minutes') + '<p class="muted">步數是活動紀錄中的已填合計。— 代表沒有紀錄。</p>'), 'insightActivity');
 section.before($('insightActivity'));
 anchor.style.display = 'none';
}

function reportStats(week, meals, weights, activities) {
 const end = datePlus(week, 7);
 const inWeek = timestamp => {
  const day = dateTW(timestamp);
  return day >= week && day < end;
 };
 const theseMeals = meals.filter(meal => inWeek(meal.eaten_at));
 const mealDays = new Map();
 for (const meal of theseMeals) {
  const day = dateTW(meal.eaten_at);
  mealDays.set(day, (mealDays.get(day) ?? 0) + sumItems([meal]).calories);
 }
  const daily = Array.from({ length: 7 }, (_, index) => {
  const day = datePlus(week, index);
  const dayMeals = theseMeals.filter(meal => dateTW(meal.eaten_at) === day);
  const dayActivities = activities.filter(log => dateTW(log.logged_at) === day);
  const incompleteCalories = dayMeals.some(meal => !(meal.meal_items || []).length || meal.meal_items.some(item => item.calories == null || !Number.isFinite(Number(item.calories))));
  const calories = dayMeals.length ? (incompleteCalories ? null : (mealDays.get(day) ?? 0)) : null;
  const hasActivity = dayActivities.length > 0;
  const completeBurn = hasActivity && dayActivities.every(log => log.calories_burned != null && Number.isFinite(Number(log.calories_burned)));
  return { day, calories, calorieState: !dayMeals.length ? 'empty' : incompleteCalories ? 'incomplete' : 'logged', activityMinutes: hasActivity ? dayActivities.reduce((sum, log) => sum + val(log.duration_minutes), 0) : null,
   burnedCalories: completeBurn ? dayActivities.reduce((sum, log) => sum + val(log.calories_burned), 0) : null,
   burnState: !hasActivity ? 'empty' : completeBurn ? 'logged' : 'incomplete', activityCount: dayActivities.length, hasActivity };
 });
 const nutrients = sumItems(theseMeals);
 const nutrientFields = { protein: 'protein_g', carbs: 'carbs_g', fat: 'fat_g' };
 const nutrientIncomplete = Object.fromEntries(Object.entries(nutrientFields).map(([key, field]) => [key,
  theseMeals.some(meal => !(meal.meal_items || []).length || meal.meal_items.some(item => item[field] == null || !Number.isFinite(Number(item[field]))))
 ]));
 return {
  nutrients, nutrientIncomplete, daily, mealDays: mealDays.size, mealCount: theseMeals.length,
  average: mealDays.size && daily.filter(day => day.calorieState === 'logged').length === mealDays.size
   ? nutrients.calories / mealDays.size : null,
  weight: weights.get(week) ?? { weight: null, days: 0 },
  activity: activityTotal(activities.filter(log => inWeek(log.logged_at))),
  activityCalories: activities.filter(log => inWeek(log.logged_at)).length && activities.filter(log => inWeek(log.logged_at)).every(log => log.calories_burned != null && Number.isFinite(Number(log.calories_burned)))
   ? activities.filter(log => inWeek(log.logged_at)).reduce((sum, log) => sum + val(log.calories_burned), 0) : null
 };
}

function reportBody(current, prior, start, isCurrent, calorieTarget = null) {
 const cell = (value, digits) => typeof value === 'number' && Number.isFinite(value) ? fmt(value, digits) : esc(value ?? '—');
 const row = (name, a, b, digits = 0, comparable = true) =>
  `<tr><th>${name}</th><td>${cell(a, digits)}</td><td>${cell(b, digits)}</td><td>${comparable && typeof a === 'number' && typeof b === 'number' ? delta(a, b, '', digits) : '—'}</td></tr>`;
 return `<p class="muted">${start} 至 ${datePlus(start, 6)} · 台灣時間${isCurrent ? " · 本週仍在進行" : ""}</p>
  ${summary(stat(current.mealDays + '/7', '飲食紀錄天數'), stat(kg(current.weight.weight), '週平均體重'), stat(current.activity.minutes, '活動分鐘'))}
  <h3>每日攝取熱量</h3>${dayBars(current.daily, 'calories', { target: calorieTarget, unit: 'kcal' })}
  <p class="muted">${calorieTarget ? `刻度線是每日目標 ${Math.round(calorieTarget)} kcal；超出會標示。` : '尚無可用的每日攝取目標。'} — 代表沒有實際飲食紀錄；「資料不完整」會保留空值，不會當成 0。</p>
  <h3>每日運動</h3>${dayBars(current.daily, 'activityMinutes', { unit: '分' })}
  <h3>每日運動消耗</h3>${dayBars(current.daily, 'burnedCalories', { unit: 'kcal' })}
  <div class="insight-summary">${stat(current.activityCalories == null ? (current.activity.count ? '資料不完整' : '—') : `${Math.round(current.activityCalories)} kcal`, '本週已記錄運動消耗')}</div>
  <p class="muted">運動消耗只加總有填寫消耗熱量的活動；「未記錄」代表當天沒有活動，「資料不完整」代表活動未填消耗。</p>
  <h3>與前一週比較</h3><div class="insight-scroll"><table class="insight-table">
   <thead><tr><th>指標</th><th>所選週</th><th>前一週</th><th>變化</th></tr></thead><tbody>
   ${row('飲食紀錄天數', current.mealDays, prior.mealDays)}
   ${row('餐次', current.mealCount, prior.mealCount)}
   ${row('飲食總熱量 kcal', current.mealCount ? current.daily.some(day => day.calorieState === 'incomplete') ? '資料不完整' : current.nutrients.calories : null, prior.mealCount ? prior.daily.some(day => day.calorieState === 'incomplete') ? '資料不完整' : prior.nutrients.calories : null)}
   ${row('蛋白質總量 g', current.mealCount ? current.nutrientIncomplete.protein ? '資料不完整' : current.nutrients.protein : null, prior.mealCount ? prior.nutrientIncomplete.protein ? '資料不完整' : prior.nutrients.protein : null, 1)}
   ${row('有紀錄日平均 kcal', current.average, prior.average)}
   ${row('週平均體重 kg', current.weight.weight, prior.weight.weight, 2, current.weight.days >= 3 && prior.weight.days >= 3)}
   ${row('體重紀錄天數', current.weight.days, prior.weight.days)}
   ${row('活動分鐘', current.activity.count ? current.activity.minutes : null, prior.activity.count ? prior.activity.minutes : null)}
   ${row('紀錄步數', current.activity.steps, prior.activity.steps)}
   </tbody></table></div>
  <p class="muted">週平均體重每天取最新一筆。兩週各至少有 3 天體重紀錄才顯示差異。</p>
  <details><summary>所選週營養合計</summary><p>${current.mealCount
   ? `蛋白質 ${current.nutrientIncomplete.protein ? '資料不完整' : `${fmt(current.nutrients.protein)} g`} · 碳水 ${current.nutrientIncomplete.carbs ? '資料不完整' : `${fmt(current.nutrients.carbs)} g`} · 脂肪 ${current.nutrientIncomplete.fat ? '資料不完整' : `${fmt(current.nutrients.fat)} g`}`
   : '沒有實際飲食紀錄。'}</p></details>`;
}

export function renderReportInsights(db, uid, profile = {}, latestWeight = null) {
 const anchor = $('anReport'), picker = $('anWeekStart');
 if (!anchor || !picker) return;
 const currentWeek = monday(dateTW());
 picker.value = currentWeek;
 picker.max = currentWeek;
 picker.insertAdjacentHTML('afterend', `<div class="an-section-head">
  <button type="button" id="anReportBack">前一週</button>
  <button type="button" id="anReportCurrent">本週</button>
  <button type="button" id="anReportForward">下一週</button></div>`);
 let request = 0;
 async function render() {
  const revision = ++request;
  const start = monday(picker.value || currentWeek);
  picker.value = start > currentWeek ? currentWeek : start;
  const week = picker.value, previous = datePlus(week, -7);
  $('anReportForward').disabled = week >= currentWeek;
  anchor.innerHTML = '<p class="muted">讀取中…</p>';
  const [from, to] = bounds(previous, 14);
  try {
   const [meals, weights, activities] = await Promise.all([
    all(db.from('meals').select('source,eaten_at,meal_items(calories,protein_g,carbs_g,fat_g)')
     .eq('user_id', uid).gte('eaten_at', from).lt('eaten_at', to).order('id')),
    all(db.from('weight_logs').select('weight_kg,logged_at').eq('user_id', uid)
     .gte('logged_at', from).lt('logged_at', to).order('logged_at').order('id')),
    all(db.from('activity_logs').select('logged_at,duration_minutes,steps,calories_burned').eq('user_id', uid).gte('logged_at', from).lt('logged_at', to).order('id'))
   ]);
   if (revision !== request || !document.contains(anchor)) return;
   const now = dateTW();
   const actualMeals = actual(meals).filter(meal => dateTW(meal.eaten_at) <= now);
   const loggedWeights = weeklyWeight(weights.filter(log => dateTW(log.logged_at) <= now));
   const loggedActivities = activities.filter(log => dateTW(log.logged_at) <= now);
   const goal = calculateNutrition({ ...profile, _weightTrend: undefined }, latestWeight?.weight_kg);
   const calorieTarget = goal.ready ? goal.calorieTarget : null;
   anchor.innerHTML = reportBody(reportStats(week, actualMeals, loggedWeights, loggedActivities),
    reportStats(previous, actualMeals, loggedWeights, loggedActivities), week, week === currentWeek, calorieTarget);
  } catch {
   if (revision === request && document.contains(anchor)) anchor.textContent = '週報暫時無法載入。切換週次可重新讀取。';
  }
 }
 picker.onchange = render;
 const step = days => { picker.value = datePlus(picker.value || currentWeek, days); return render(); };
 $('anReportBack').onclick = () => step(-7);
 $('anReportCurrent').onclick = () => { picker.value = currentWeek; return render(); };
 $('anReportForward').onclick = () => step(7);
 return render();
}
