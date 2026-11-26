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
const currentSummary = x => {
  const d = x.current;
  if (!d || d.future) return '尚未到日期';
  const work = d.workoutCalories == null ? '沒有已記錄運動熱量' : `已記錄運動 ${kcal(d.workoutCalories)}`;
  if (d.isToday) return `今天尚未結束：${d.totalCalories !== null ? 'Apple TOTAL 目前累積 ' + kcal(d.totalCalories) : '全天總消耗尚未完整同步'}、飲食 ${d.intake === null ? '資料待補' : kcal(d.intake)}；暫不判定整日赤字。`;
  if (d.estimate === null) return d.status;
  return d.source === 'apple_total'
    ? `Apple TOTAL ${kcal(d.totalCalories)} − 飲食 ${kcal(d.intake)} ＝ 估算赤字 ${kcal(d.estimate)}（${d.status}）`
    : `基準 TDEE ${kcal(x.baselineTdee)} ＋ 已記錄運動 ${kcal(d.workoutCalories || 0)} − 飲食 ${kcal(d.intake)} ＝ 估算赤字 ${kcal(d.estimate)}（${d.status}）`;
};

export function renderCoachDeficitDetails(x) {
  const dailyTarget = x.target;
  const weekly = x.fullWeekTarget;
  const weekPercent = progress(x.knownSum, weekly);
  const rows = x.days.map(day => {
    const estimate = day.estimate;
    const dataReady = estimate !== null;
    const percent = dataReady ? progress(estimate, dailyTarget) : 0;
    const value = !dataReady ? '—' : estimate < 0 ? `盈餘 ${fmt.format(-estimate)}` : `${signed(estimate)}`;
    const label = day.status;
    const tone = !dataReady ? 'pending' : estimate >= dailyTarget && dailyTarget > 0 ? 'met' : 'below';
    const energy = day.future ? '消耗待記錄' : day.totalCalories !== null ? `Apple TOTAL ${fmt.format(day.totalCalories)}` :
      day.estimatedEnergy !== null ? `公式估算 ${fmt.format(day.estimatedEnergy)}` : '消耗待同步';
    const intake = day.intake === null ? '飲食待補' : `飲食 ${fmt.format(day.intake)}`;
    return `<div class="msj-deficit-day-row ${tone}" aria-label="${escape(day.date)} ${escape(energy)} ${escape(intake)} ${escape(label)} ${dataReady ? escape(value + ' kcal') : ''}">
      <time datetime="${day.date}">${day.date.slice(5).replace('-', '/')} <small>${weekday(day.date)}</small></time>
      <div class="msj-deficit-day-meter"><span class="msj-deficit-day-track" aria-hidden="true"><i style="width:${percent}%"></i></span>
        <small class="msj-deficit-day-sources">${escape(energy)} − ${escape(intake)}</small>
        <small class="msj-deficit-day-state">${escape(label)}${!dataReady && day.totalCalories !== null ? ' · TOTAL 已同步' : ''}</small></div>
      <strong>${dataReady ? escape(value) : '—'}<small>${dataReady ? ' kcal' : ''}</small></strong>
    </div>`;
  }).join('');
  const deduped = x.days.reduce((s, d) => s + d.suppressedCount, 0);
  const appleCount = x.days.filter(d => d.estimate !== null && d.source === 'apple_total').length;
  const current=x.current;
  const dayEnergy=current?.estimatedEnergy;
  const dayIntake=current?.intake;
  const dayEstimate=current?.estimate;
  const displayEnergy=dayEnergy===null||dayEnergy===undefined?'—':fmt.format(dayEnergy);
  const displayIntake=dayIntake===null||dayIntake===undefined?'—':fmt.format(dayIntake);
  const displayDeficit=dayEstimate===null||dayEstimate===undefined?'—':signed(dayEstimate);
  const energySource=current?.source==='apple_total'?'Apple Fitness · TOTAL':dayEnergy!=null?'TDEE＋運動估算':'尚無總消耗資料';
  return `<section class="msj-deficit-estimate">
    <div class="msj-deficit-week"><div class="msj-deficit-week-top"><b>本週估算赤字</b><span>${x.knownDays}/${x.elapsedDays} 個已結束日可估算</span></div>
      <div class="msj-deficit-total"><strong>${x.knownDays ? signed(x.knownSum) : '—'}</strong><span>／ ${fmt.format(weekly)} kcal（全週計畫）</span></div>
      <div class="msj-deficit-track" role="progressbar" aria-label="本週赤字估算進度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(weekPercent)}"><i style="width:${weekPercent}%"></i></div>
      <p>${escape(x.status)}。${x.elapsedDays && x.target > 0 ? `截至已結束日期應有參考 ${fmt.format(x.elapsedDays * x.target)} kcal。` : ''} 本週 ${appleCount} 天使用 Apple TOTAL，其餘可估算日期使用公式與已記錄運動；請確認飲食是否有漏記。</p>
    </div>
    <div class="msj-deficit-today"><b>${escape(x.referenceDate)} · 熱量收支</b>
      <div class="msj-coach-energy-ledger" aria-label="當日總消耗減飲食等於估算赤字">
        <div><span>全日總消耗</span><strong>${displayEnergy}<small> kcal</small></strong><small>${escape(energySource)}</small></div>
        <div><span>飲食攝取</span><strong>${displayIntake}<small> kcal</small></strong><small>已記錄食物</small></div>
        <div><span>估算赤字</span><strong>${displayDeficit}<small>${dayEstimate==null?'':' kcal'}</small></strong><small>${current?.isToday?'今天未結束':escape(current?.status||'待確認')}</small></div>
      </div>
      <p>${escape(currentSummary(x))}</p>
    </div>
    <div class="msj-deficit-daily-heading"><b>每日赤字</b><small>每一天都顯示總消耗與飲食 · 計畫 ${fmt.format(dailyTarget)} kcal</small></div>
    <div class="msj-deficit-day-chart">${rows}</div>
    <details class="msj-deficit-day-details"><summary>計算方式與資料來源</summary>
      <p><strong>首選：Apple Fitness TOTAL − 已記錄飲食。</strong> Apple TOTAL 是全天活動能量加靜態能量，已包含單次運動，不可再加上 Move 或運動熱量。</p>
      <p>尚未同步 Apple TOTAL 時才用<strong>久坐基準 TDEE ＋ 已記錄運動 − 飲食</strong>。久坐基準為 BMR × 1.2（約 ${x.baselineTdee === null ? '—' : fmt.format(x.baselineTdee) + ' kcal'}）；原來依活動係數設定的 TDEE 約 ${x.tdee === null ? '—' : fmt.format(x.tdee) + ' kcal'}，兩種 TDEE 不相加。</p>
      <p>在備用公式中，運動消耗取自當天的運動紀錄，先去除高度相似的 Apple 健康與手動重複紀錄。若當天已有 Apple TOTAL，運動紀錄僅供查看，<strong>絕不額外加計</strong>。</p>
      <p>本週 ${appleCount} 天使用 Apple TOTAL；另有 ${deduped} 筆高度相似的運動紀錄被排除重複計算（原始紀錄不會刪除）。運動熱量和 TDEE 皆為估算，且漏記任何餐點都會高估赤字；已結束日期的「估算達參考」並非確認實際達標。今天尚未結束、飲食缺漏或運動熱量欄位缺少時不判定。</p>
      <p>已記錄不等於全天飲食完整：請自行核對當日是否有漏記餐點，否則赤字可能被高估。這是依你原本減重階段計算的參考，不會因為某天未達標而要求你額外節食或運動。</p>
    </details>
  </section>`;
}

export async function mountHomeDeficit(db, uid, goal, day) {
  const slot = document.getElementById('msjHomeDeficit');
  if (!slot) return;
  if (!goal?.ready || goal.goalMode !== 'lose' || !goal.targetDate) {
    slot.textContent = '設定減脂階段後，即可在 Coach 查看每日與每週進度。'; return;
  }
  try {
    const x = await loadWeekDeficit(db, uid, goal, day);
    if (!slot.isConnected) return;
    slot.innerHTML = `<p class="msj-home-deficit-number">${x.knownDays ? `${signed(x.knownSum)} <small>kcal</small>` : '—'}<span>本週已結束日估算赤字 · 全週計畫 ${fmt.format(x.fullWeekTarget)} kcal</span></p>
      <p class="msj-home-deficit-meta">${escape(x.status)} · ${x.knownDays}/${x.elapsedDays} 天有資料 · Apple TOTAL ${x.days.filter(d => d.estimate !== null && d.source === 'apple_total').length} 天</p>`;
  } catch {
    if (slot.isConnected) slot.textContent = '本週資料暫時無法取得，請至 Coach 重試。';
  }
}

export const __test = { mondayOf, summarizeWeekDeficit };
