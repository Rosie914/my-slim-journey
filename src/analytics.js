const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localDate = (date=new Date()) => {const d=new Date(date);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,10)};
const n=v=>Number(v||0);
const fmt=(v,digits=1)=>n(v).toFixed(digits);
const weekStart=date=>{const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()-((d.getDay()+6)%7));return localDate(d)};
const dateTime=date=>new Date(`${date}T12:00:00`).toISOString();
const dateStart=date=>new Date(`${date}T00:00:00`).toISOString();
const shiftDay=(date,offset)=>{const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()+offset);return localDate(d)};
const shiftMonth=(month,offset)=>{const d=new Date(`${month}-01T12:00:00`);d.setMonth(d.getMonth()+offset);return localDate(d).slice(0,7)};
async function rows(db,table,uid,column,from,to){let q=db.from(table).select('*').eq('user_id',uid).order(column,{ascending:false}).limit(500);if(from)q=q.gte(column,from);if(to)q=q.lt(column,to);const {data,error}=await q;if(error)throw error;return data||[]}
export function renderAnalytics(tab){
 if(tab==='weight')return `<section class="card an-activity-calendar-card"><div class="an-calendar-toolbar"><button type="button" id="anWeightPrevious" aria-label="上一個月">‹</button><button type="button" id="anWeightMonth" aria-expanded="true" aria-controls="anWeightCalendar"></button><button type="button" id="anWeightNext" aria-label="下一個月">›</button></div><div id="anWeightCalendar" class="an-calendar-grid" aria-label="選擇體重紀錄日期"></div><div class="an-calendar-footer"><span id="anWeightSelected" aria-live="polite"></span><button type="button" id="anWeightToday">回到今天</button></div><p class="muted an-calendar-legend">● 有體重紀錄</p></section><section class="card"><div class="an-section-head"><h2 id="anWeightDayTitle">當日體重</h2><details id="anWeightEditor" class="an-activity-editor"><summary>＋ 新增體重</summary><form id="anWeightForm" class="an-form an-weight-form"><label>體重（kg）<input name="weight_kg" type="number" min="25" max="250" step="0.1" required></label><label>日期<input name="logged_at" type="date" required readonly></label><label>備註（選填）<input name="notes" maxlength="300" placeholder="例如：起床、上完廁所後"></label><button type="submit">儲存體重</button><button type="button" id="anWeightCancel" class="an-secondary" hidden>取消修改</button><p id="anWeightStatus" class="muted" role="status"></p></form></details></div><div id="anWeightStats" class="an-stats an-weight-stats"></div><div id="anWeightHistory"></div></section><section class="card"><details id="anWeightTrend"><summary>查看體重折線趨勢</summary><div class="an-section-head"><h3>最近紀錄</h3><span id="anWeightCount" class="muted"></span></div><div id="anWeightChart" class="an-chart-wrap"><p class="muted">讀取中…</p></div></details><p class="muted">單日體重波動不代表脂肪增減，請搭配長期趨勢觀察。</p></section>`;
 if(tab==='activity')return `<section class="card an-activity-calendar-card"><div class="an-calendar-toolbar"><button type="button" id="anActivityPrevious" aria-label="上一個月">‹</button><button type="button" id="anActivityMonth" aria-expanded="true" aria-controls="anActivityCalendar"></button><button type="button" id="anActivityNext" aria-label="下一個月">›</button></div><div id="anActivityCalendar" class="an-calendar-grid" aria-label="選擇運動日期"></div><div class="an-calendar-footer"><span id="anActivitySelected" aria-live="polite"></span><button type="button" id="anActivityToday">回到今天</button></div><p class="muted an-calendar-legend">● 有活動紀錄</p></section><section class="card"><div class="an-section-head"><h2 id="anActivityDayTitle">當日運動</h2><details id="anActivityEditor" class="an-activity-editor"><summary>＋ 新增運動</summary><form id="anActivityForm" class="an-form"><label>活動類型<input name="activity_type" required maxlength="80" placeholder="例如：快走、飛輪、重量訓練"></label><label>日期<input name="logged_at" type="date" required readonly></label><label>時間（分鐘）<input name="duration_minutes" type="number" min="1" max="1440" value="30" required></label><label>消耗熱量（kcal，選填）<input name="calories_burned" type="number" min="0" step="1"></label><label>步數（選填）<input name="steps" type="number" min="0" step="1"></label><label>備註（選填）<input name="notes" maxlength="300" placeholder="例如：輕鬆強度"></label><button type="submit">儲存活動</button><button type="button" id="anActivityCancel" class="an-secondary" hidden>取消修改</button><p id="anActivityStatus" class="muted" role="status"></p></form></details></div><div id="anActivityStats" class="an-stats"></div><div id="anActivityHistory"></div></section><section class="card an-activity-week-card" aria-labelledby="anActivityWeekTitle"><div class="an-section-head"><div><h2 id="anActivityWeekTitle">本週運動</h2><p id="anActivityWeekRange" class="muted"></p></div></div><div id="anActivityWeekStats" class="an-stats an-activity-week-stats"></div><div id="anActivityWeekDays" class="an-activity-week-days" aria-live="polite"></div><p class="muted an-activity-week-note">週統計依目前選取日期所在的週計算。</p></section>`;
 if(tab==='reports')return `<section class="card"><h2>每週回顧</h2><label>選擇週一日期<input id="anWeekStart" type="date" value="${weekStart(localDate())}"></label><div id="anReport" class="an-report"><p class="muted">讀取中…</p></div></section>`;
 if(tab==='coach')return `<section class="card"><h2>Journey Coach</h2><p class="muted">根據你已儲存的紀錄整理趨勢，不會把單日體重或熱量當成診斷。</p><div id="anCoach" class="an-coach"><p class="muted">正在整理近期紀錄…</p></div></section>`;
 return '';
}
function lineChart(data){if(!data.length)return '<p class="muted">還沒有體重紀錄。</p>';const ordered=[...data].reverse(),vals=ordered.map(x=>n(x.weight_kg)),min=Math.min(...vals)-.5,max=Math.max(...vals)+.5,span=Math.max(.5,max-min);const pts=vals.map((v,i)=>`${24+i*(252/Math.max(1,vals.length-1))},${116-(v-min)/span*88}`).join(' ');return `<svg class="an-chart" viewBox="0 0 300 145" role="img" aria-label="體重變化折線圖"><line x1="24" y1="116" x2="276" y2="116"/><line x1="24" y1="20" x2="24" y2="116"/><polyline points="${pts}"/><text x="24" y="136">${esc(ordered[0].logged_at.slice(0,10))}</text><text x="276" y="136" text-anchor="end">${esc(ordered.at(-1).logged_at.slice(0,10))}</text><text x="26" y="15">${fmt(max)} kg</text><text x="26" y="108">${fmt(min)} kg</text></svg><p class="an-chart-summary">最新 ${fmt(data[0].weight_kg)} kg${data.length>1?`・較前次 ${n(data[0].weight_kg)-n(data[1].weight_kg)>0?'+':''}${fmt(n(data[0].weight_kg)-n(data[1].weight_kg))} kg`:''}</p>`}
function activityCalendar(month,selected,today,records,recordLabel='有運動紀錄'){
 const [year,monthNumber]=month.split('-').map(Number),firstWeekday=new Date(Date.UTC(year,monthNumber-1,1)).getUTCDay(),lastDay=new Date(Date.UTC(year,monthNumber,0)).getUTCDate();
 const weekdays=['日','一','二','三','四','五','六'].map(x=>`<span class="an-calendar-weekday">${x}</span>`).join('');
 const blanks='<span aria-hidden="true"></span>'.repeat(firstWeekday);
 const active=new Set(records.map(item=>localDate(item.logged_at)));
 const days=Array.from({length:lastDay},(_,i)=>{const date=`${month}-${String(i+1).padStart(2,'0')}`,has=active.has(date);return `<button type="button" class="an-calendar-day" data-date="${date}" aria-pressed="${date===selected}" ${date===today?'aria-current="date"':''} aria-label="${date}${has?'，'+recordLabel:''}">${i+1}${has?'<i aria-hidden="true"></i>':''}</button>`}).join('');
 return weekdays+blanks+days;
}
export async function initAnalytics(db,uid,tab){
 if(tab==='weight'){
  const calendar=$('anWeightCalendar'),monthButton=$('anWeightMonth'),selectedLabel=$('anWeightSelected');
  const form=$('anWeightForm'),editor=$('anWeightEditor'),history=$('anWeightHistory'),stats=$('anWeightStats'),status=$('anWeightStatus'),today=localDate();
  let selected=today,month=today.slice(0,7),calendarOpen=true,list=[],request=0,saving=false;
  const dateLabel=value=>`${Number(value.slice(5,7))} 月 ${Number(value.slice(8,10))} 日`;
  function drawDay(){
   const entries=list.filter(item=>localDate(item.logged_at)===selected);
   stats.innerHTML=`<div><b>${entries.length}</b><small>筆紀錄</small></div><div><b>${entries.length?fmt(entries[0].weight_kg):'—'}${entries.length?' kg':''}</b><small>當日最新體重</small></div>`;
   $('anWeightDayTitle').textContent=selected===today?'今日體重':`${dateLabel(selected)}體重`;
   history.innerHTML=entries.length?entries.map(item=>`<div class="an-history-row"><div><b>${fmt(item.weight_kg)} kg</b><small>${item.notes?esc(item.notes):'未填備註'}</small></div><div class="an-activity-actions"><button type="button" class="an-edit-weight" data-id="${esc(item.id)}">編輯</button><button type="button" class="an-delete-weight" data-id="${esc(item.id)}">刪除</button></div></div>`).join(''):'<p class="muted">這一天還沒有體重紀錄。</p>';
  }
  function drawCalendar(){
   monthButton.textContent=`${month.slice(0,4)} 年 ${Number(month.slice(5,7))} 月 ${calendarOpen?'▾':'›'}`;
   monthButton.setAttribute('aria-expanded',String(calendarOpen));calendar.hidden=!calendarOpen;
   $('anWeightToday').hidden=selected===today;selectedLabel.textContent=`${selected.replaceAll('-','/')} · ${selected===today?'今天':dateLabel(selected)}`;
   if(calendarOpen)calendar.innerHTML=activityCalendar(month,selected,today,list,'有體重紀錄');
   drawDay();
  }
  async function loadMonth(focusDate=null){
   const version=++request;stats.innerHTML='<p class="muted" role="status">載入體重紀錄…</p>';history.innerHTML='';
   try{
    const [monthRows,trendRows]=await Promise.all([
     rows(db,'weight_logs',uid,'logged_at',dateStart(`${month}-01`),dateStart(`${shiftMonth(month,1)}-01`)),
     rows(db,'weight_logs',uid,'logged_at')
    ]);
    if(version!==request||!calendar.isConnected)return;
    list=monthRows;$('anWeightCount').textContent=`${Math.min(trendRows.length,30)} 筆`;$('anWeightChart').innerHTML=lineChart(trendRows.slice(0,30));
    drawCalendar();if(focusDate)calendar.querySelector(`[data-date="${focusDate}"]`)?.focus();
   }catch(error){if(version===request&&calendar.isConnected){status.textContent=`讀取體重紀錄失敗：${error.message}`;drawCalendar()}}
  }
  async function selectDate(value,collapse=true,focusDate=false){
   selected=value;form.elements.logged_at.value=selected;status.textContent='';
   const nextMonth=value.slice(0,7);
   if(nextMonth!==month){month=nextMonth;list=[];calendarOpen=true;await loadMonth(focusDate?value:null);return}
   calendarOpen=collapse?false:calendarOpen;drawCalendar();
   if(focusDate)calendar.querySelector(`[data-date="${selected}"]`)?.focus();else if(!calendarOpen)monthButton.focus();
  }
  function changeMonth(offset){month=shiftMonth(month,offset);list=[];if(selected.slice(0,7)!==month)selected=`${month}-01`;form.elements.logged_at.value=selected;calendarOpen=true;void loadMonth(selected)}
  monthButton.onclick=()=>{calendarOpen=!calendarOpen;drawCalendar()};
  $('anWeightPrevious').onclick=()=>changeMonth(-1);$('anWeightNext').onclick=()=>changeMonth(1);
  $('anWeightToday').onclick=()=>void selectDate(today,false);
  calendar.onclick=event=>{const day=event.target.closest('[data-date]');if(day)void selectDate(day.dataset.date,true)};
  calendar.onkeydown=event=>{const day=event.target.closest('[data-date]');if(!day)return;const weekday=new Date(`${day.dataset.date}T00:00:00Z`).getUTCDay();const offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-weekday,End:6-weekday};if(!(event.key in offsets))return;event.preventDefault();void selectDate(shiftDay(day.dataset.date,offsets[event.key]),false,true)};
  form.elements.logged_at.value=selected;
  $('anWeightCancel').onclick=()=>{form.reset();delete form.dataset.editId;form.elements.logged_at.value=selected;form.querySelector('[type="submit"]').textContent='儲存體重';$('anWeightCancel').hidden=true;status.textContent='';editor.open=false};
  form.onsubmit=async event=>{
   event.preventDefault();if(saving)return;const f=new FormData(form),date=f.get('logged_at'),weight=n(f.get('weight_kg'));
   const payload={user_id:uid,weight_kg:weight,logged_at:dateTime(date),notes:String(f.get('notes')||'').trim()||null};
   saving=true;const submit=form.querySelector('[type="submit"]');submit.disabled=true;submit.textContent='儲存中…';status.textContent='正在儲存體重紀錄…';
   try{
    const query=form.dataset.editId?db.from('weight_logs').update(payload).eq('id',form.dataset.editId).eq('user_id',uid):db.from('weight_logs').insert(payload);
    const {error}=await query;if(error)throw error;
    delete form.dataset.editId;form.reset();selected=date;month=date.slice(0,7);form.elements.logged_at.value=selected;form.querySelector('[type="submit"]').textContent='儲存體重';$('anWeightCancel').hidden=true;status.textContent='體重紀錄已儲存。';await loadMonth();editor.open=false;
   }catch(error){status.textContent=`儲存失敗：${error.message}`}
   finally{saving=false;submit.disabled=false;if(!form.dataset.editId)submit.textContent='儲存體重'}
  };
  history.onclick=async event=>{
   const edit=event.target.closest('.an-edit-weight'),remove=event.target.closest('.an-delete-weight');
   if(edit){const item=list.find(entry=>String(entry.id)===edit.dataset.id);if(!item)return;form.dataset.editId=item.id;form.elements.weight_kg.value=item.weight_kg;form.elements.logged_at.value=selected;form.elements.notes.value=item.notes??'';form.querySelector('[type="submit"]').textContent='儲存修改';$('anWeightCancel').hidden=false;status.textContent=`正在編輯 ${fmt(item.weight_kg)} kg`;editor.open=true;form.scrollIntoView({behavior:'smooth',block:'nearest'});return}
   if(remove){if(!confirm('確定刪除這筆體重紀錄？'))return;remove.disabled=true;try{const {error}=await db.from('weight_logs').delete().eq('id',remove.dataset.id).eq('user_id',uid);if(error)throw error;status.textContent='體重紀錄已刪除。';await loadMonth()}catch(error){status.textContent=`刪除失敗：${error.message}`}finally{remove.disabled=false}}
  };
  await loadMonth();
 }
 if(tab==='activity'){
  const calendar=$('anActivityCalendar'),monthButton=$('anActivityMonth'),selectedLabel=$('anActivitySelected');
  const form=$('anActivityForm'),editor=$('anActivityEditor'),history=$('anActivityHistory'),stats=$('anActivityStats');
  const weekRange=$('anActivityWeekRange'),weekStats=$('anActivityWeekStats'),weekDays=$('anActivityWeekDays');
  const status=$('anActivityStatus'),today=localDate();
  let selected=today,month=today.slice(0,7),calendarOpen=true,list=[],request=0,weekRequest=0,saving=false;
  const dateLabel=value=>`${Number(value.slice(5,7))} 月 ${Number(value.slice(8,10))} 日`;
  const summaryName='Apple 健康每日摘要';
  const stepsLabel=value=>value==null?'未記錄':`${Math.round(value).toLocaleString('zh-TW')} 步`;
  function totalsForDay(dayLogs){
   const dailySummary=dayLogs.find(item=>item.activity_type===summaryName);
   const workouts=dayLogs.filter(item=>item.activity_type!==summaryName);
   const stepRows=workouts.filter(item=>item.steps!=null);
   const steps=dailySummary?.steps!=null?Number(dailySummary.steps):stepRows.length?stepRows.reduce((sum,item)=>sum+n(item.steps),0):null;
   const calorieRows=dailySummary?.calories_burned!=null?[dailySummary.calories_burned]:workouts.map(item=>item.calories_burned).filter(value=>value!=null);
   const calories=calorieRows.length?calorieRows.reduce((sum,value)=>sum+n(value),0):null;
   return {workouts,minutes:workouts.reduce((sum,item)=>sum+n(item.duration_minutes),0),steps,calories};
  }
  async function loadWeek(date){
   const version=++weekRequest,week=weekStart(date),end=shiftDay(week,7),weekdays=['一','二','三','四','五','六','日'];
   weekRange.textContent=`${week.slice(5).replace('-','/')}–${shiftDay(week,6).slice(5).replace('-','/')}`;
   weekStats.innerHTML='<p class="muted">讀取本週紀錄…</p>';weekDays.innerHTML='';
   try{
    const weekLogs=await rows(db,'activity_logs',uid,'logged_at',dateStart(week),dateStart(end));
    if(version!==weekRequest||!weekStats.isConnected)return;
    const days=Array.from({length:7},(_,index)=>{const day=shiftDay(week,index),logs=weekLogs.filter(item=>localDate(item.logged_at)===day);return {day,...totalsForDay(logs)}});
    const minutes=days.reduce((sum,item)=>sum+item.minutes,0);
    const stepDays=days.filter(item=>item.steps!=null);
    const steps=stepDays.reduce((sum,item)=>sum+item.steps,0);
    const workoutDays=days.filter(item=>item.workouts.length>0).length;
    weekStats.innerHTML=`<div><b>${minutes}</b><small>運動分鐘</small></div><div><b>${stepDays.length?Math.round(steps).toLocaleString('zh-TW'):'—'}</b><small>紀錄步數</small></div><div><b>${workoutDays}/7</b><small>運動天數</small></div>`;
    weekDays.innerHTML=days.map((item,index)=>`<div class="an-activity-week-row${item.day===date?' is-selected':''}"><span>${weekdays[index]} ${item.day.slice(5).replace('-','/')}</span><span>${item.workouts.length?`${item.minutes} 分`:'—'}</span><b>${stepsLabel(item.steps)}</b></div>`).join('');
   }catch(error){if(version===weekRequest&&weekStats.isConnected)weekStats.innerHTML=`<p class="muted">本週紀錄讀取失敗：${esc(error.message)}</p>`}
  }
  function drawDay(){
   const entries=list.filter(item=>localDate(item.logged_at)===selected);
   const {workouts,minutes,steps,calories}=totalsForDay(entries);
   $('anActivityDayTitle').textContent=selected===today?'今日運動':`${dateLabel(selected)}運動`;
   stats.innerHTML=`<div><b>${workouts.length}</b><small>次運動</small></div><div><b>${minutes}</b><small>運動分鐘</small></div><div><b>${calories==null?'未記錄':Math.round(calories)}${calories==null?'':' kcal'}</b><small>活動熱量</small></div><div><b>${stepsLabel(steps)}</b><small>步數</small></div>`;
   history.innerHTML=workouts.length?workouts.map(item=>`<div class="an-history-row"><div><b>${esc(item.activity_type)}</b><small>${n(item.duration_minutes)} 分鐘${item.calories_burned==null?'':`・${n(item.calories_burned)} kcal`}${item.steps==null?'':`・${n(item.steps)} 步`}${item.notes?`・${esc(item.notes)}`:''}</small></div><div class="an-activity-actions"><button type="button" class="an-edit-activity" data-id="${esc(item.id)}">編輯</button><button type="button" class="an-delete-activity" data-id="${esc(item.id)}">刪除</button></div></div>`).join(''):'<p class="muted">這一天沒有運動紀錄；步數與活動熱量會在同步 Apple 健康資料後顯示。</p>';
  }
  function drawCalendar(){
   monthButton.textContent=`${month.slice(0,4)} 年 ${Number(month.slice(5,7))} 月 ${calendarOpen?'▾':'›'}`;
   monthButton.setAttribute('aria-expanded',String(calendarOpen));
   calendar.hidden=!calendarOpen;
   $('anActivityToday').hidden=selected===today;
   selectedLabel.textContent=`${selected.replaceAll('-','/')} · ${selected===today?'今天':dateLabel(selected)}`;
   if(calendarOpen)calendar.innerHTML=activityCalendar(month,selected,today,list);
   drawDay();
  }
  async function loadMonth(focusDate=null){
   const version=++request;
   stats.innerHTML='<p class="muted" role="status">載入當日運動…</p>';
   history.innerHTML='';
   try{
    list=await rows(db,'activity_logs',uid,'logged_at',dateStart(`${month}-01`),dateStart(`${shiftMonth(month,1)}-01`));
    if(version!==request||!calendar.isConnected)return;
    drawCalendar();
    void loadWeek(selected);
    if(focusDate)calendar.querySelector(`[data-date="${focusDate}"]`)?.focus();
   }catch(error){
    if(version!==request||!calendar.isConnected)return;
    status.textContent=`讀取運動紀錄失敗：${error.message}`;
    drawCalendar();
   }
  }
  async function selectDate(value,collapse=true,focusDate=false){
   selected=value;
   form.elements.logged_at.value=selected;
   status.textContent='';
   void loadWeek(selected);
   const nextMonth=value.slice(0,7);
   if(nextMonth!==month){month=nextMonth;list=[];calendarOpen=true;await loadMonth(focusDate?value:null);return}
   calendarOpen=collapse?false:calendarOpen;
   drawCalendar();
   if(focusDate)calendar.querySelector(`[data-date="${selected}"]`)?.focus();
   else if(!calendarOpen)monthButton.focus();
  }
  function changeMonth(offset){
   month=shiftMonth(month,offset);list=[];
   if(selected.slice(0,7)!==month)selected=`${month}-01`;
   form.elements.logged_at.value=selected;
   calendarOpen=true;
   void loadMonth(selected);
  }
  monthButton.onclick=()=>{calendarOpen=!calendarOpen;drawCalendar()};
  $('anActivityPrevious').onclick=()=>changeMonth(-1);
  $('anActivityNext').onclick=()=>changeMonth(1);
  $('anActivityToday').onclick=()=>void selectDate(today,false);
  calendar.onclick=event=>{const day=event.target.closest('[data-date]');if(day)void selectDate(day.dataset.date,true)};
  calendar.onkeydown=event=>{
   const day=event.target.closest('[data-date]');if(!day)return;
   const weekday=new Date(`${day.dataset.date}T00:00:00Z`).getUTCDay();
   const offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-weekday,End:6-weekday};
   if(!(event.key in offsets))return;
   event.preventDefault();void selectDate(shiftDay(day.dataset.date,offsets[event.key]),false,true);
  };
  form.elements.logged_at.value=selected;
  $('anActivityCancel').onclick=()=>{form.reset();delete form.dataset.editId;form.elements.logged_at.value=selected;form.querySelector('[type="submit"]').textContent='儲存活動';$('anActivityCancel').hidden=true;status.textContent='';editor.open=false};
  form.onsubmit=async event=>{
   event.preventDefault();if(saving)return;
   const f=new FormData(form),date=f.get('logged_at');
   const payload={user_id:uid,activity_type:String(f.get('activity_type')).trim(),duration_minutes:n(f.get('duration_minutes')),calories_burned:f.get('calories_burned')?n(f.get('calories_burned')):null,steps:f.get('steps')?n(f.get('steps')):null,logged_at:dateTime(date),notes:String(f.get('notes')||'').trim()||null};
   saving=true;const submit=form.querySelector('[type="submit"]');submit.disabled=true;submit.textContent='儲存中…';status.textContent='正在儲存運動紀錄…';
   try{
    const query=form.dataset.editId?db.from('activity_logs').update(payload).eq('id',form.dataset.editId).eq('user_id',uid):db.from('activity_logs').insert(payload);
    const {error}=await query;if(error)throw error;
    delete form.dataset.editId;form.reset();selected=date;month=date.slice(0,7);form.elements.logged_at.value=selected;form.querySelector('[type="submit"]').textContent='儲存活動';$('anActivityCancel').hidden=true;status.textContent='運動紀錄已儲存。';
    await loadMonth();editor.open=false;
   }catch(error){status.textContent=`儲存失敗：${error.message}`}
   finally{saving=false;submit.disabled=false;if(!form.dataset.editId)submit.textContent='儲存活動'}
  };
  history.onclick=async event=>{
   const edit=event.target.closest('.an-edit-activity'),remove=event.target.closest('.an-delete-activity');
   if(edit){const item=list.find(entry=>String(entry.id)===edit.dataset.id);if(!item)return;form.dataset.editId=item.id;form.elements.activity_type.value=item.activity_type;form.elements.logged_at.value=selected;form.elements.duration_minutes.value=item.duration_minutes??30;form.elements.calories_burned.value=item.calories_burned??'';form.elements.steps.value=item.steps??'';form.elements.notes.value=item.notes??'';form.querySelector('[type="submit"]').textContent='儲存修改';$('anActivityCancel').hidden=false;status.textContent=`正在編輯 ${item.activity_type}`;editor.open=true;form.scrollIntoView({behavior:'smooth',block:'nearest'});return}
   if(remove){if(!confirm('確定刪除這筆運動紀錄？'))return;remove.disabled=true;try{const {error}=await db.from('activity_logs').delete().eq('id',remove.dataset.id).eq('user_id',uid);if(error)throw error;status.textContent='運動紀錄已刪除。';await loadMonth();void loadWeek(selected)}catch(error){status.textContent=`刪除失敗：${error.message}`}finally{remove.disabled=false}}
  };
  await loadMonth();
 }
}
