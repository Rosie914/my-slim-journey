// Coach energy estimate: conservative sedentary baseline TDEE + *logged, deduped*
// individual workout energy - logged meals. Never add Apple Move daily active energy
// to workouts. This is an estimate, not directly measured total daily energy.
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

  const cutoff = reference < now ? reference : now;
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = shift(monday, i);
    const food = byMealDay.get(date);
    const activity = summarizeDay(byActivityDay.get(date) || []);
    const exerciseMissing = activity.workouts.some(row => !positive(row.calories_burned));
    const loggedWorkout = activity.workoutCalories === null ? 0 : Math.round(activity.workoutCalories);
    const workoutCount = activity.workouts.length;
    const future = date > cutoff;
    const isToday = date === now;
    const mealCompleteFields = Boolean(food && food.complete && food.count > 0);
    const intake = mealCompleteFields ? Math.round(food.calories) : null;
    const estimate = !future && !isToday && intake !== null && baseline !== null && !exerciseMissing
      ? Math.round(baseline + loggedWorkout - intake) : null;
    const status = future ? '尚未到日期'
      : !food ? '尚無飲食紀錄'
      : !mealCompleteFields ? '熱量資料不完整'
      : isToday ? '今天尚未結束'
      : exerciseMissing ? '部分運動缺少熱量'
      : target <= 0 ? '僅供參考'
      : estimate >= target ? '估算達參考' : '估算低於參考';
    return { date, future, isToday, intake, estimate, status,
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
    loadAll(db, 'activity_logs', uid, 'activity_type,calories_burned,duration_minutes,logged_at,created_at,notes,steps', monday, nextMonday)
  ]);
  return summarizeWeekDeficit(meals, goal, referenceDate, today(), activities);
}

const progress = (value, max) => max > 0 ? upTo(value / max * 100) : 0;
const weekday = day => ['日', '一', '二', '三', '四', '五', '六'][new Date(`${day}T00:00:00Z`).getUTCDay()];
const currentSummary = x => {
  const d = x.current;
  if (!d || d.future) return '尚未到日期';
  const work = d.workoutCalories == null ? '沒有已記錄運動熱量' : `已記錄運動 ${kcal(d.workoutCalories)}`;
  if (d.isToday) return `今日已記錄飲食 ${d.intake === null ? '資料待補' : kcal(d.intake)}、${work}；今天尚未結束，暫不判定。`;
  if (d.estimate === null) return d.status;
  return `基準 TDEE ${kcal(x.baselineTdee)} ＋ 已記錄運動 ${kcal(d.workoutCalories || 0)} − 飲食 ${kcal(d.intake)} ＝ 估算赤字 ${kcal(d.estimate)}（${d.status}）`;
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
    const label = !dataReady ? day.status : day.status;
    const tone = !dataReady ? 'pending' : estimate >= dailyTarget && dailyTarget > 0 ? 'met' : 'below';
    return `<div class="msj-deficit-day-row ${tone}" aria-label="${escape(day.date)} ${escape(label)} ${dataReady ? escape(value + ' kcal') : ''}">
      <time datetime="${day.date}">${day.date.slice(5).replace('-', '/')} <small>${weekday(day.date)}</small></time>
      <div class="msj-deficit-day-meter"><span class="msj-deficit-day-track" aria-hidden="true"><i style="width:${percent}%"></i></span><small>${escape(label)}</small></div>
      <strong>${dataReady ? escape(value) : '—'}<small>${dataReady ? ' kcal' : ''}</small></strong>
    </div>`;
  }).join('');
  const deduped = x.days.reduce((s, d) => s + d.suppressedCount, 0);
  return `<section class="msj-deficit-estimate">
    <div class="msj-deficit-week"><div class="msj-deficit-week-top"><b>本週估算赤字</b><span>${x.knownDays}/${x.elapsedDays} 個已結束日可估算</span></div>
      <div class="msj-deficit-total"><strong>${x.knownDays ? signed(x.knownSum) : '—'}</strong><span>／ ${fmt.format(weekly)} kcal（全週計畫）</span></div>
      <div class="msj-deficit-track" role="progressbar" aria-label="本週赤字估算進度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(weekPercent)}"><i style="width:${weekPercent}%"></i></div>
      <p>${escape(x.status)}。${x.elapsedDays && x.target > 0 ? `截至已結束日期應有參考 ${fmt.format(x.elapsedDays * x.target)} kcal。` : ''} 未記錄的運動不會憑空補值；請確認飲食是否有漏記。</p>
    </div>
    <div class="msj-deficit-today"><b>${escape(x.referenceDate)} · 當日估算</b><p>${escape(currentSummary(x))}</p></div>
    <div class="msj-deficit-daily-heading"><b>每日赤字</b><small>每日計畫 ${fmt.format(dailyTarget)} kcal · 達標只代表估算</small></div>
    <div class="msj-deficit-day-chart">${rows}</div>
    <details class="msj-deficit-day-details"><summary>計算方式與資料來源</summary>
      <p><strong>估算每日赤字 = 久坐基準 TDEE ＋ 已記錄運動 − 已記錄飲食。</strong> 久坐基準 TDEE 為 BMR × 1.2，約 ${x.baselineTdee === null ? '—' : fmt.format(x.baselineTdee) + ' kcal'}；原先依活動程度設定的 TDEE 約 ${x.tdee === null ? '—' : fmt.format(x.tdee) + ' kcal'}，兩者不要再相加。</p>
      <p>運動消耗取自當天的運動紀錄，先去除高度相似的 Apple 健康與手動重複紀錄；<strong>不另加 Apple Fitness 的全天活動熱量摘要</strong>。沒有運動紀錄代表「沒有可加計資料」，不代表沒有日常活動；日常活動以久坐基準概略涵蓋。</p>
      <p>本週有 ${deduped} 筆高度相似的運動紀錄被排除重複計算（原始紀錄不會刪除）。運動熱量和 TDEE 皆為估算，且漏記任何餐點都會高估赤字；已結束日期的「估算達參考」並非確認實際達標。今天尚未結束、飲食缺漏或運動熱量欄位缺少時不判定。</p>
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
      <p class="msj-home-deficit-meta">${escape(x.status)} · ${x.knownDays}/${x.elapsedDays} 天有資料</p>`;
  } catch {
    if (slot.isConnected) slot.textContent = '本週資料暫時無法取得，請至 Coach 重試。';
  }
}

export const __test = { mondayOf, summarizeWeekDeficit };
