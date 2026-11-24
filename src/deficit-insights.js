// My Slim Journey — conservative energy-balance estimates, based on logged meals.
// Do not add Apple Health active calories or exercise to TDEE a second time.
const formatter = new Intl.NumberFormat('zh-TW', {maximumFractionDigits:0});
const calendar = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'});
const today = () => calendar.format(new Date());
const dayOf = timestamp => calendar.format(new Date(timestamp));
const shift = (date, offset) => new Date(Date.parse(date+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
const weekStart = date => shift(date,-((new Date(date+'T00:00:00Z').getUTCDay()+6)%7));
const taipeiMidnight = date => new Date(date+'T00:00:00+08:00').toISOString();
const escape = s => String(s??'').replace(/[&<>"']/g, k=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[k]));
const signed = value => value == null?'—':`${value<0?'−':''}${formatter.format(Math.abs(value))}`;
const finite = value => value!==null && value!=='' && value!==undefined && Number.isFinite(Number(value));

export function summarizeWeekDeficit(meals,goal,referenceDate,now=today()) {
  const monday=weekStart(referenceDate), limit=referenceDate<now?referenceDate:now;
  const target = goal?.ready && goal.goalMode==='lose' && goal.targetDate && goal.tdee>0
    ? Math.max(0,Math.round(goal.tdee-goal.calorieTarget)) : 0;
  const entries=new Map();
  for(const meal of meals||[]){
    if(meal.source==='planned')continue;
    const date=dayOf(meal.eaten_at);
    if(date<monday||date>shift(monday,6))continue;
    const item=entries.get(date)||{calories:0,meals:0,complete:true};
    const parts=meal.meal_items||[];
    item.meals++;
    if(!parts.length||parts.some(p=>!finite(p.calories)||Number(p.calories)<0))item.complete=false;
    else item.calories+=parts.reduce((sum,p)=>sum+Number(p.calories),0);
    entries.set(date,item);
  }
  const days=Array.from({length:7},(_,i)=>{
    const date=shift(monday,i), data=entries.get(date),future=date>limit;
    const complete=Boolean(data?.complete&&data.meals>0),partialToday=date===now;
    const intake=complete?Math.round(data.calories):null;
    const estimate=complete&&!partialToday?Math.round(goal.tdee-data.calories):null;
    const status=future?'尚未到日期':!data?'尚無紀錄':!complete?'熱量資料不完整':partialToday?'今天尚未結束':
      target<=0?'僅供參考':estimate>=target?'估算達參考':'估算未達參考';
    return {date,intake,estimate,complete,future,partialToday,status};
  });
  const elapsed=days.filter(d=>!d.future && !d.partialToday);
  const known=elapsed.filter(d=>d.estimate!==null);
  const current=days.find(d=>d.date===referenceDate)??null;
  const knownSum=known.reduce((sum,d)=>sum+d.estimate,0);
  const observedAll=elapsed.length>0 && known.length===elapsed.length;
  const finishedWeek=now>shift(monday,6) && referenceDate===shift(monday,6);
  const throughLabel=referenceDate===now?"截至昨日":"截至所選日期";
  const status=!known.length?'尚無可估算的完整日期':!observedAll?'部分日期尚未完整記錄，暫不判定':
    target<=0?'本階段沒有飲食赤字目標':finishedWeek?(knownSum>=7*target?'依紀錄估算達到參考':'依紀錄估算低於參考'):
      knownSum>=elapsed.length*target?throughLabel+'估算符合參考':throughLabel+'估算低於參考';
  return {monday,referenceDate,now,target,fullWeekTarget:target*7,totalPlan:Math.max(0,Math.round(goal?.plannedDeficit||0)),
    optionalActivity:Math.max(0,Math.round(goal?.plannedExtraActivity||0)),tdee:goal?.tdee??null,
    calorieTarget:goal?.calorieTarget??null,days,current,knownDays:known.length,elapsedDays:elapsed.length,
    knownSum,observedAll,finishedWeek,status, ready:Boolean(goal?.ready)};
}

export async function loadWeekDeficit(db,uid,goal,referenceDate){
  const monday=weekStart(referenceDate),end=shift(monday,7);
  const result=[];
  for(let offset=0;offset<2000;offset+=250){
    const {data,error}=await db.from('meals')
      .select('eaten_at,source,meal_items(calories)')
      .eq('user_id',uid).gte('eaten_at',taipeiMidnight(monday)).lt('eaten_at',taipeiMidnight(end))
      .order('eaten_at').range(offset,offset+249);
    if(error)throw error;
    result.push(...(data||[]));
    if(!data||data.length<250)break;
  }
  return summarizeWeekDeficit(result,goal,referenceDate);
}

export async function mountHomeDeficit(db,uid,goal,day){
  const slot=document.getElementById('msjHomeDeficit');if(!slot)return;
  if(!goal?.ready||goal.goalMode!=='lose'||!goal.targetDate){slot.textContent='完成目標設定後，Coach 會顯示你的每日與每週進度。';return;}
  try{
    const x=await loadWeekDeficit(db,uid,goal,day);
    if(!slot.isConnected)return;
    slot.innerHTML=`<p class="msj-home-deficit-number">${x.knownDays?`${signed(x.knownSum)} <small>kcal</small>`:'—'}<span>本週已結束日期的飲食側估算能量差</span></p>
      <p class="msj-home-deficit-meta">${x.knownDays}/${x.elapsedDays} 天有完整熱量資料 · ${escape(x.status)}</p>`;
  }catch(e){if(slot.isConnected)slot.textContent='本週紀錄暫時無法讀取，請在 Coach 重試。';}
}

export function renderCoachDeficitDetails(x){
  const daily=x.current;
  const dailyLine=!daily||daily.future?'尚無當日資料':daily.partialToday?
    `今日已記錄 ${daily.intake===null?'部分熱量仍待補':signed(daily.intake)+' kcal'}；一天尚未結束，不能把目前攝取視為整日攝取。`:
    daily.estimate===null?escape(daily.status):`所選日期估算 ${signed(daily.estimate)} kcal · ${escape(daily.status)}`;
  const target=x.target;
  const hasTarget=target>0;
  const progress=hasTarget&&x.knownDays?Math.min(100,Math.max(0,x.knownSum/x.fullWeekTarget*100)):0;
  const rows=x.days.map(d=>`<div class="msj-deficit-day"><time datetime="${d.date}">${d.date.slice(5).replace('-','/')}</time><span>${escape(d.status)}</span><b>${d.estimate===null?'—':signed(d.estimate)+' kcal'}</b></div>`).join('');
  const totalPlanNote=x.totalPlan!==target&&x.totalPlan>0?`原階段總計畫約每日 ${formatter.format(x.totalPlan)} kcal，其中含額外運動規劃 ${formatter.format(x.optionalActivity)} kcal；因無法可靠核對實際額外消耗，本卡不以此判定達標。`:'';
  return `<div class="msj-deficit-summary-grid"><div><span>每日飲食側赤字參考</span><strong>${hasTarget?formatter.format(target):'—'} <small>kcal</small></strong></div>
    <div><span>本週已完成日估算</span><strong>${x.knownDays?signed(x.knownSum):'—'} <small>kcal</small></strong></div></div>
    <div class="msj-deficit-week"><div class="msj-deficit-week-top"><b>本週進度</b><span>${x.knownDays}/${x.elapsedDays} 天可估算</span></div>
      <div class="msj-deficit-track" role="img" aria-label="本週累計估算 ${x.knownDays?signed(x.knownSum)+' kcal':'尚無資料'}；全週飲食側參考 ${formatter.format(x.fullWeekTarget)} kcal"><i style="width:${progress}%"></i></div>
      <p>${hasTarget?`全週飲食側參考 ${formatter.format(x.fullWeekTarget)} kcal`:'目前沒有可比較的飲食赤字參考'} · ${escape(x.status)}</p></div>
    <div class="msj-deficit-today"><b>${escape(x.referenceDate)} · 當日</b><p>${dailyLine}</p></div>
    <details class="msj-deficit-day-details"><summary>查看本週每天的估算</summary>${rows}</details>
    <details class="msj-deficit-day-details"><summary>計算方式與限制</summary>
      <p>每日估算飲食側赤字 = 估算 TDEE ${x.tdee===null?'—':formatter.format(x.tdee)} − 當天已記錄全部食物熱量；目標攝取 ${x.calorieTarget===null?'—':formatter.format(x.calorieTarget)} kcal。</p>
      <p>${totalPlanNote||'此處只比較飲食側參考，不增加額外運動熱量。'} TDEE 本身包含估算的日常活動，不能再直接加上 Apple Fitness 活動熱量或每次運動熱量。</p>
      <p>未記錄的餐點會高估赤字。今天尚未結束、完全沒有記錄或食物熱量缺漏時，不判定達標。所有數值是模型估計，不是生理量測，也不是要求額外節食或運動。</p>
    </details>`;
}

export const __test={weekStart,summarizeWeekDeficit};
