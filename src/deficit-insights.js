// Coach energy balance: prefer Apple Health daily TOTAL (resting + active)
// minus logged meals; when unavailable, estimate sedentary TDEE + deduped workout energy.
// Never add workout/Move calories again to Apple TOTAL.
import { summarizeDay, taipeiDay } from './activity-dedupe.js';

const fmt = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' });
const today = () => dateFmt.format(new Date());
const shift = (day, by) => new Date(Date.parse(`${day}T00:00:00Z`) + by * 86400000).toISOString().slice(0, 10);
const mondayOf = day => shift(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
const startTW = day => new Date(`${day}T00:00:00+08:00`).toISOString();
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const finite = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const positive = v => finite(v) && Number(v) >= 0;
const signed = v => v == null ? '—' : `${v < 0 ? '−' : ''}${fmt.format(Math.abs(Math.round(v)))}`;
const kcal = v => `${signed(v)} kcal`;
const upTo = (value, max = 100) => Math.max(0, Math.min(max, Number(value) || 0));

// Invariant: goal.tdee reflects the user's *habitual activity multiplier*.
// Adding all recorded exercise directly to that TDEE risks counting it twice.
// Instead, a sedentary baseline (Mifflin BMR × 1.2) is the comparison anchor.
// This can undercount unlogged daily movement; uncertainty is explicitly shown.
export function summarizeWeekDeficit(meals, goal, referenceDate, now = today(), activities = []) {
  const reference = /^\d{4}-\d{2}-\d{2}$/.test(referenceDate || '') ? referenceDate : now;
  const monday = mondayOf(reference);
  const target = goal?.ready && goal.goalMode === 'lose' && goal.targetDate
    ? Math.max(0, Math.round(Number(goal.plannedDeficit) || 0)) : 0;
  const baseline = finite(goal?.bmr) && Number(goal.bmr) > 0 ? Math.round(Number(goal.bmr) * 1.2) : null;

  const byMealDay = new Map();
  for (const meal of meals || []) {
    if (meal.source === 'planned') continue;
    const day = taipeiDay(meal.eaten_at);
    if (day < monday || day > shift(monday, 6)) continue;
    const row = byMealDay.get(day) || { calories: 0, count: 0, complete: true };
    row.count++;
    const items = meal.meal_items || [];
    if (!items.length || items.some(item => !positive(item.calories))) row.complete = false;
    else row.calories += items.reduce((sum, item) => sum + Number(item.calories), 0);
    byMealDay.set(day, row);
  }
  const byActivityDay = new Map();
  for (const entry of activities || []) {
    if (!entry?.logged_at) continue;
    const date = taipeiDay(entry.logged_at);
    if (date < monday || date > shift(monday, 6)) continue;
    const rows = byActivityDay.get(date) || [];
    rows.push(entry);
    byActivityDay.set(date, rows);
  }

  // A selected historical day only determines the detail focus; weekly status follows actual today.
  const cutoff = now;
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = shift(monday, i);
    const food = byMealDay.get(date);
    const activityRows = byActivityDay.get(date) || [];
    const activity = summarizeDay(activityRows);
    // Use only a real Apple daily summary as a source of TOTAL; individual workouts
    // and Apple Move are separate metrics and must not be added again.
    const dailyHealth = activityRows.filter(row => row.activity_type === 'Apple 健康每日摘要')
      .sort((a,b) => Date.parse(b.created_at || b.logged_at) - Date.parse(a.created_at || a.logged_at));
    const totalRecord = dailyHealth.find(row => positive(row.total_calories));
    const totalCalories = totalRecord ? Math.round(Number(totalRecord.total_calories)) : null;
    const source = totalCalories !== null ? 'apple_total' : 'estimated';
    const exerciseMissing = activity.workouts.some(row => !positive(row.calories_burned));
    const loggedWorkout = activity.workoutCalories === null ? 0 : Math.round(activity.workoutCalories);
    const workoutCount = activity.workouts.length;
    const future = date > cutoff;
    const isToday = date === now;
    const mealCompleteFields = Boolean(food && food.complete && food.count > 0);
    const intake = mealCompleteFields ? Math.round(food.calories) : null;
    const estimatedEnergy = totalCalories !== null ? totalCalories :
      (baseline !== null && !exerciseMissing ? baseline + loggedWorkout : null);
    const estimate = !future && !isToday && intake !== null && estimatedEnergy !== null
      ? Math.round(estimatedEnergy - intake) : null;
    const status = future ? '尚未到日期'
      : !food ? '尚無飲食紀錄'
      : !mealCompleteFields ? '熱量資料不完整'
      : isToday ? '今天尚未結束'
      : totalCalories === null && exerciseMissing ? '部分運動缺少熱量'
      : estimatedEnergy === null ? '消耗資料不足'
      : target <= 0 ? '僅供參考'
      : estimate >= target ? '估算達參考' : '估算低於參考';
    return { date, future, isToday, intake, estimate, status, totalCalories, source, estimatedEnergy,
      workoutCalories: workoutCount ? loggedWorkout : null, workoutCount,
      suppressedCount: activity.suppressed.length, hasMoveSummary: activity.activeCalories !== null,
      exerciseMissing, mealCount: food?.count || 0 };
  });

  const closed = days.filter(day => !day.future && !day.isToday);
  const known = closed.filter(day => day.estimate !== null);
  const knownSum = known.reduce((sum, day) => sum + day.estimate, 0);
  const completeThrough = closed.length > 0 && known.length === closed.length;
  const weekFinished = now > shift(monday, 6) && cutoff >= shift(monday, 6);
  const status = !known.length ? '目前沒有可估算的已結束日期'
    : !completeThrough ? '部分日期資料不足，暫不判定本週達標'
    : target <= 0 ? '目前沒有進行中的赤字計畫'
    : weekFinished
      ? knownSum >= target * 7 ? '本週依紀錄估算達參考' : '本週依紀錄估算低於參考'
      : knownSum >= closed.length * target ? '截至已結束日期，估算符合進度' : '截至已結束日期，估算低於進度';

  return { monday, referenceDate: reference, now, target, fullWeekTarget: target * 7,
    tdee: goal?.tdee ?? null, baselineTdee: baseline, calorieTarget: goal?.calorieTarget ?? null,
    optionalActivity: Math.max(0, Math.round(Number(goal?.plannedExtraActivity) || 0)),
    days, current: days.find(d => d.date === reference) || null,
    knownSum, knownDays: known.length, elapsedDays: closed.length,
    observedAll: completeThrough, finishedWeek: weekFinished, status, ready: Boolean(goal?.ready) };
}

async function loadAll(db, table, uid, select, monday, nextMonday) {
  const results = [];
  for (let offset = 0; offset < 2000; offset += 250) {
    const { data, error } = await db.from(table).select(select).eq('user_id', uid)
      .gte(table === 'meals' ? 'eaten_at' : 'logged_at', startTW(monday))
      .lt(table === 'meals' ? 'eaten_at' : 'logged_at', startTW(nextMonday))
      .order(table === 'meals' ? 'eaten_at' : 'logged_at').range(offset, offset + 249);
    if (error) throw error;
    results.push(...(data || []));
    if (!data || data.length < 250) return results;
  }
  throw new Error('本週紀錄超過可安全讀取的筆數，請縮小查詢範圍。');
}

export async function loadWeekDeficit(db, uid, goal, referenceDate) {
  const monday = mondayOf(referenceDate), nextMonday = shift(monday, 7);
  const [meals, activities] = await Promise.all([
    loadAll(db, 'meals', uid, 'eaten_at,source,meal_items(calories)', monday, nextMonday),
    loadAll(db, 'activity_logs', uid, 'activity_type,calories_burned,duration_minutes,logged_at,created_at,notes,steps,total_calories,resting_calories', monday, nextMonday)
  ]);
  return summarizeWeekDeficit(meals, goal, referenceDate, today(), activities);
}

const progress = (value, max) => max > 0 ? upTo(value / max * 100) : 0;
const weekday = day => ['日', '一', '二', '三', '四', '五', '六'][new Date(`${day}T00:00:00Z`).getUTCDay()];
// Home and Coach share the same day-level estimate and source. Today's Apple TOTAL
// is only energy accumulated so far; it is NEVER treated as a full-day target result.
function readableEnergy(day) {
  if (!day || day.future) return null;
  if (day.isToday && day.source !== 'apple_total') return null; // full-day fallback ≠ calories burned so far
  return day.estimatedEnergy;
}
function readableBalance(day) {
  if (!day || day.future || day.intake === null) return null;
  if (day.isToday) return day.source === 'apple_total' && day.totalCalories !== null
    ? Math.round(day.totalCalories - day.intake) : null;
  return day.estimate;
}
function balanceCaption(day, result) {
  if (!day) return '沒有選定的日期';
  if (day.future) return '尚未到這一天';
  if (day.intake === null) return day.mealCount ? '飲食熱量資料不完整' : '尚無飲食紀錄';
  if (day.isToday) return result === null
    ? '今天尚未結束；等待 Apple TOTAL 同步，暫不計算完整日赤字。'
    : '目前累積差額；今天尚未結束，不能用來判定全日達標。';
  if (result === null) return day.status;
  return `${day.status} · 若有漏記餐點，赤字可能高估。`;
}
const show = v => v === null || v === undefined ? '—' : fmt.format(Math.round(v));
function energyBars(day, classPrefix) {
  const burn = readableEnergy(day);
  const intake = day?.intake ?? null;
  const max = Math.max(1, burn || 0, intake || 0);
  const rows = [
    { value:burn, label:'總消耗', name:'burn', source:day?.source==='apple_total'?'Apple TOTAL':'公式估算' },
    { value:intake, label:'飲食', name:'eat', source:'已記錄' }
  ];
  return `<div class="${classPrefix}-bars" role="group" aria-label="消耗與飲食比較：${rows.map(r => r.label + ' ' + show(r.value) + ' kcal').join('，')}">
    ${rows.map(r=>{
      const pct=r.value===null?0:Math.max(0,Math.min(100,r.value/max*100));
      return `<div class="${classPrefix}-barline"><div class="${classPrefix}-barlabel"><span>${r.label}</span><strong>${show(r.value)} <small>kcal</small></strong></div><div class="${classPrefix}-bartrack"><i class="${classPrefix}-${r.name}" style="width:${pct.toFixed(2)}%"></i></div></div>`;
    }).join('')}
  </div>`;
}

// Render the ONE full daily breakdown on Home. Coach intentionally does not repeat it.
export function renderHomeDailyBalance(day, target=0) {
  const balance=readableBalance(day);
  const burn=readableEnergy(day);
  const hasEnough=burn !== null && day?.intake !== null;
  const source=day?.source==='apple_total'?'Apple Fitness TOTAL':burn!==null?'TDEE＋運動估算':'待同步';
  const label=balance===null?'熱量差額待確認':day?.isToday?'目前差額（未完成）':balance<0?'估算熱量盈餘':'估算熱量赤字';
  const result=balance===null?'—':balance<0?`盈餘 ${show(-balance)}`:show(balance);
  const note=balanceCaption(day,balance);
  return `<section class="msj-home-balance-panel" aria-label="${escape(day?.date || '所選日期')} 熱量收支圖">
    <div class="msj-home-balance-header"><strong>當日熱量收支</strong><small>${escape(source)}${day?.isToday?' · 目前累積':''}</small></div>
    ${energyBars(day,'msj-home-balance')}
    <div class="msj-home-balance-result"><span>${escape(label)}</span><strong>${escape(result)}${balance===null?'':' <small>kcal</small>'}</strong></div>
    <p class="msj-home-balance-note">${escape(note)}${!day?.isToday && hasEnough && target>0?' · 計畫參考 '+show(target)+' kcal':''}</p>
  </section>`;
}

export function renderCoachDeficitDetails(x) {
  const dailyTarget=x.target;
  const weekly=x.fullWeekTarget;
  const weekPercent=progress(x.knownSum, weekly);
  const appleCount=x.days.filter(d=>d.estimate!==null && d.source==='apple_total').length;
  const deduped=x.days.reduce((s,d)=>s+d.suppressedCount,0);
  const rows=x.days.map(day=>{
    const balance=readableBalance(day);
    const result=balance===null?'—':day.isToday?`目前 ${show(balance)} kcal`:
      balance<0?`盈餘 ${show(-balance)} kcal`:`${show(balance)} kcal`;
    const tone=day.isToday?'pending':balance===null?'pending':balance>=dailyTarget&&dailyTarget>0?'met':'below';
    const caption=day.isToday?'今天 · 未結束':day.status;
    const source=day.future?'':day.source==='apple_total'?'Apple TOTAL':'公式估算';
    const statusText=source?`${source} · ${caption}`:caption;
    return `<article class="msj-deficit-graph-day ${tone}" aria-label="${escape(day.date)} ${escape(result)}，${escape(caption)}">
      <header class="msj-deficit-graph-day-top"><time datetime="${day.date}">${day.date.slice(5).replace('-','/')} <small>週${weekday(day.date)}</small></time>
        <span class="msj-deficit-graph-status">${escape(statusText)}</span>
        <strong class="msj-deficit-graph-delta">${escape(result)}</strong></header>
      ${energyBars(day,'msj-deficit-graph')}
    </article>`;
  }).join('');
  return `<section class="msj-deficit-estimate">
    <div class="msj-deficit-week"><div class="msj-deficit-week-top"><b>本週估算赤字</b><span>${x.knownDays}/${x.elapsedDays} 個已結束日可估算</span></div>
      <div class="msj-deficit-total"><strong>${x.knownDays?signed(x.knownSum):'—'}</strong><span>／ ${fmt.format(weekly)} kcal（全週計畫）</span></div>
      <div class="msj-deficit-track" role="progressbar" aria-label="本週赤字估算進度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(weekPercent)}"><i style="width:${weekPercent}%"></i></div>
      <p>${escape(x.status)}。${x.elapsedDays&&x.target>0?`截至已結束日期，計畫進度參考 ${fmt.format(x.elapsedDays*x.target)} kcal。`:''} 本週 ${appleCount} 天使用 Apple TOTAL。</p>
    </div>
    <div class="msj-deficit-daily-heading"><b>每日赤字圖</b><small>消耗與飲食同刻度 · 每日計畫 ${fmt.format(dailyTarget)} kcal</small></div>
    <div class="msj-deficit-graph-list">${rows}</div>
    <p class="msj-deficit-graph-disclaimer">每天直接比較「總消耗」與「飲食」。數字為 kcal，今日尚未結束，暫不判定達標；缺少資料不當成 0。</p>
    <details class="msj-deficit-day-details"><summary>計算方式與資料來源</summary>
      <p><strong>優先：Apple Fitness TOTAL − 已記錄飲食。</strong> TOTAL 已含日常活動與運動，不額外加入 Move 或運動消耗。</p>
      <p>若沒有 Apple TOTAL，已結束日期採<strong>久坐基準 TDEE ＋ 去重後運動 − 飲食</strong>，久坐基準為 BMR × 1.2（約 ${x.baselineTdee===null?'—':fmt.format(x.baselineTdee)+' kcal'}）；原依活動係數設定的 TDEE 約 ${x.tdee===null?'—':fmt.format(x.tdee)+' kcal'}，不重複加總。</p>
      <p>本週 ${appleCount} 天採 Apple TOTAL；${deduped} 筆相似運動排除重複計算。熱量均為估算；即使食物都有熱量數字，也可能有漏記餐點，須自行核對完整性。</p>
      <p>每日計畫赤字只是原有減重階段的進度參考，不代表需要因單日差距而刻意額外節食或運動。</p>
    </details>
  </section>`;
}

export async function mountHomeDeficit(db, uid, goal, day) {
  const weeklySlot=document.getElementById('msjHomeDeficit');
  const dailySlot=document.getElementById('msjHomeDailyBalance');
  if (!weeklySlot && !dailySlot) return;
  const isCurrent=()=>Boolean((!weeklySlot || weeklySlot.isConnected) &&
    (!dailySlot || (dailySlot.isConnected && dailySlot.dataset.date===day)));
  try {
    const x=await loadWeekDeficit(db,uid,goal,day);
    if(!isCurrent())return;
    if(dailySlot) dailySlot.innerHTML=renderHomeDailyBalance(x.current,x.target);
    if(!weeklySlot)return;
    if(!goal?.ready || goal.goalMode!=='lose' || !goal.targetDate){
      weeklySlot.textContent='設定減脂階段後，即可在 Coach 查看每日及每週目標。';return;
    }
    weeklySlot.innerHTML=`<p class="msj-home-deficit-number">${x.knownDays?`${signed(x.knownSum)} <small>kcal</small>`:'—'}<span>本週已結束日估算赤字 · 全週計畫 ${fmt.format(x.fullWeekTarget)} kcal</span></p>
      <p class="msj-home-deficit-meta">${escape(x.status)} · ${x.knownDays}/${x.elapsedDays} 天有資料 · Apple TOTAL ${x.days.filter(d=>d.estimate!==null&&d.source==='apple_total').length} 天</p>`;
  } catch(error) {
    console.warn('[Home] calorie balance unavailable',error?.name||'UnknownError');
    if(!isCurrent())return;
    if(dailySlot)dailySlot.textContent='熱量收支暫時無法讀取；請確認網路或按「更新」。';
    if(weeklySlot)weeklySlot.textContent='本週進度暫時無法取得，請至 Coach 重試。';
  }
}

export const __test={mondayOf,summarizeWeekDeficit,readableBalance,readableEnergy};
