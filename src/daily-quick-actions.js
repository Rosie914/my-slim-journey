import {summarizeDay,shiftDate} from './activity-dedupe.js';

const h = v => String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
const mealTypes={breakfast:'早餐',lunch:'午餐',dinner:'晚餐',snack:'點心',other:'其他'};
const mealFields=['food_name','quantity','serving_weight_g','nutrition_source','confidence','calories','protein_g','carbs_g','fat_g','fiber_g','sugar_g','sodium_mg'];
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const start = day => new Date(`${day}T00:00:00+08:00`).toISOString();
const end = day => start(shiftDate(day,1));
const timeNow = () => new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
const amount = v => v===null||v===''||v===undefined?null:Number(v);
async function ensureRows(query) {const {data,error}=await query;if(error)throw error;return data||[];}
function dialogHost() {
  const dialog=document.createElement('dialog');dialog.className='msj-quick-dialog';
  dialog.setAttribute('aria-label','快速記錄確認');document.body.append(dialog);
  dialog.addEventListener('close',()=>dialog.remove());return dialog;
}
function showDialog(dialog,inner){dialog.innerHTML=inner;dialog.showModal();dialog.querySelector('[data-quick-cancel]')?.addEventListener('click',()=>dialog.close());}
function status(dialog,message){const el=dialog.querySelector('[data-quick-status]');if(el)el.textContent=message;}
const pretty=(v,unit='')=>v==null?'待補':`${Math.round(v*10)/10}${unit}`;

// Home shortcuts: preview then explicit confirmation; no implicit inserts.
export function mountDailyQuickActions({db,uid,selectedDate,onSaved,goWeight}) {
  const home=document.querySelector('.home-dashboard');if(!home)return;
  let host=home.querySelector('#msjDailyQuick');if(host)return;
  host=document.createElement('section');host.id='msjDailyQuick';host.className='card msj-daily-quick';
  host.innerHTML=`<div class="msj-quick-title"><h2>快速記錄</h2><small>今天吃過的、做過的，少打幾個字</small></div>
    <div class="msj-quick-grid"><button type="button" data-quick="meal"><span aria-hidden="true">🥐</span><b>記錄飲食</b><small>最近／常吃食物</small></button>
    <button type="button" data-quick="workout"><span aria-hidden="true">♡</span><b>最近運動</b><small>再記錄一次</small></button>
    <button type="button" data-quick="weight"><span aria-hidden="true">⚖</span><b>記錄體重</b><small>立即填寫</small></button></div>
    <p class="msj-quick-hint">快速複製前會確認日期與內容，不會直接重複新增。</p>`;
  const anchor=home.querySelector('.home-nutrition');if(anchor)anchor.insertAdjacentElement('afterend',host);else home.prepend(host);
  let busy=false;
  host.addEventListener('click',async event=>{
    const button=event.target.closest('[data-quick]');if(!button||busy)return;
    if(button.dataset.quick==='weight'){goWeight?.();return;}
    busy=true;button.disabled=true;
    try{
      if(button.dataset.quick==='meal')await previewMeals();
      else if(button.dataset.quick==='workout')await previewWorkout();
    }catch(error){showError(error?.message||'讀取失敗，請重試。');}
    finally{busy=false;button.disabled=false;}
  });
  function showError(message){const note=host.querySelector('.msj-quick-hint');if(note)note.textContent=message;}
  async function previewMeals(){
    // One food entry point for all meal types: history and user-curated favorites.
    // Never silently record a planned or future meal as food already eaten.
    const [recentResult,favoritesResult]=await Promise.allSettled([
      ensureRows(db.from('meals').select('id,meal_type,eaten_at,source,meal_items(*)')
        .eq('user_id',uid).lt('eaten_at',end(selectedDate)).order('eaten_at',{ascending:false}).limit(60)),
      ensureRows(db.from('user_favorite_foods').select('id,food_name,serving_label,serving_weight_g,nutrition_source,calories,protein_g,carbs_g,fat_g,fiber_g,sugar_g,sodium_mg,updated_at')
        .eq('user_id',uid).order('updated_at',{ascending:false}).limit(18))
    ]);
    if(recentResult.status==='rejected'&&favoritesResult.status==='rejected')
      throw new Error('最近餐點及常吃食物暫時無法載入，請到飲食頁記錄。');
    const recent=(recentResult.status==='fulfilled'?recentResult.value:[])
      .filter(row=>row.source!=='planned'&&row.meal_items?.length).slice(0,12);
    const favorites=(favoritesResult.status==='fulfilled'?favoritesResult.value:[]).slice(0,12);
    const dayOf=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
    const foodsFor=row=>row.meal_items.map(item=>item.food_name).filter(Boolean).join('、')||'餐點';
    const suggestedType=()=>{const hour=Number(timeNow().slice(0,2));return hour<11?'breakfast':hour<15?'lunch':hour<21?'dinner':'snack';};
    const dlg=dialogHost();
    showDialog(dlg,`<div class="msj-quick-form msj-quick-picker">
      <h3>快速記錄飲食</h3><p>選擇之前吃過的餐點，或從常吃食物加入。日期：${h(selectedDate)}</p>
      <h4>最近餐點</h4>
      <div class="msj-quick-pick-list">${recent.length?recent.map((m,i)=>`<button type="button" data-meal-reuse="${i}">
        <b>${h(mealTypes[m.meal_type]||'餐點')} <small>${h(dayOf(m.eaten_at))}</small></b>
        <span>${h(foodsFor(m))}</span></button>`).join(''):'<p>尚無可複製的歷史餐點。</p>'}</div>
      <h4>常吃食物</h4>
      <div class="msj-quick-pick-list">${favorites.length?favorites.map((item,i)=>`<button type="button" data-favorite-reuse="${i}">
        <b>${h(item.food_name)}</b><span>${h(item.serving_label||'原紀錄份量')} · ${pretty(amount(item.calories),' kcal')}</span></button>`).join(''):'<p>尚未收藏常吃食物，之後可從飲食頁收藏。</p>'}</div>
      <div class="msj-quick-buttons"><button type="button" data-quick-cancel>取消</button><button type="button" data-quick-new>新增其他飲食</button></div>
      <p class="msj-quick-hint">選擇後可改餐別、用餐時間及整筆份量。必須確認才會儲存。</p></div>`);
    dlg.addEventListener('click',ev=>{
      if(ev.target.closest('[data-quick-cancel]')){dlg.close();return;}
      if(ev.target.closest('[data-quick-new]')){
        dlg.close();home.querySelector('[data-tab="meals"]')?.click();return;
      }
      const mealButton=ev.target.closest('[data-meal-reuse]');
      if(mealButton){
        const chosen=recent[Number(mealButton.dataset.mealReuse)];
        showMealConfirmation(chosen.meal_items,chosen.meal_type,`來源：${dayOf(chosen.eaten_at)} ${mealTypes[chosen.meal_type]||'餐點'}`);
        return;
      }
      const favoriteButton=ev.target.closest('[data-favorite-reuse]');
      if(favoriteButton){
        const favorite=favorites[Number(favoriteButton.dataset.favoriteReuse)];
        const item={...favorite,quantity:favorite.serving_label||'1 份',nutrition_source:favorite.nutrition_source||'favorite'};
        showMealConfirmation([item],suggestedType(),`常吃食物：${favorite.food_name}`);
      }
    });
    function showMealConfirmation(originals,defaultType,origin){
      const selectedItems=originals.map(item=>Object.fromEntries(mealFields.map(key=>[key,item[key]??null])));
      const kind=mealTypes[defaultType]?defaultType:'other';
      const defaultHour={breakfast:'08:00',lunch:'12:00',dinner:'19:00',snack:'15:00',other:'12:00'};
      const foodList=selectedItems.map(item=>`<li>${h(item.food_name||'食物')}${item.quantity?` · ${h(item.quantity)}`:''}<small>${pretty(amount(item.calories),' kcal')}</small></li>`).join('');
      dlg.innerHTML=`<form class="msj-quick-form"><h3>確認快速記錄</h3><p>${h(origin)} · 新增到 ${h(selectedDate)}</p>
        <ul>${foodList}</ul><label>這次記成哪一餐？<select name="meal_type" required>${Object.entries(mealTypes).map(([value,label])=>`<option value="${value}" ${kind===value?'selected':''}>${label}</option>`).join('')}</select></label>
        <label>用餐時間<input name="meal_time" type="time" value="${selectedDate===today()?timeNow():defaultHour[kind]}" required></label>
        <label>整筆份量倍率（1 = 原份量；0.5 = 半份）<input name="portion_factor" type="number" min="0.1" max="5" step="0.1" value="1" required></label>
        <p class="msj-quick-hint" data-portion-preview>熱量及營養維持原紀錄，若食物份量不同請調整。</p>
        <div class="msj-quick-buttons"><button type="button" data-quick-cancel>取消</button><button type="submit">確認新增</button></div>
        <p data-quick-status role="status"></p></form>`;
      const form=dlg.querySelector('form');
      const factorEl=form.elements.portion_factor;
      const formatPreview=()=>{
        const factor=Number(factorEl.value),known=selectedItems.every(item=>amount(item.calories)!==null);
        const kcal=known?selectedItems.reduce((sum,item)=>sum+Number(item.calories),0)*factor:null;
        form.querySelector('[data-portion-preview]').textContent=
          Number.isFinite(factor)&&factor>=.1&&factor<=5
            ? `本次約 ${pretty(kcal,' kcal')}（倍率 ${factor}；缺失營養資料不補 0）。整筆按相同比例調整。`
            : '請輸入 0.1～5 之間的份量倍率。';
      };
      factorEl.addEventListener('input',formatPreview);formatPreview();
      form.addEventListener('submit',async ev=>{
        ev.preventDefault();const submit=form.querySelector('[type=submit]');submit.disabled=true;
        try{
          const mealType=form.elements.meal_type.value;
          if(!mealTypes[mealType])throw new Error('請選擇正確餐別。');
          const factor=Number(factorEl.value);
          if(!(factor>=.1&&factor<=5))throw new Error('請確認份量倍率在 0.1～5 之間。');
          const existing=await ensureRows(db.from('meals').select('id').eq('user_id',uid)
            .eq('meal_type',mealType).gte('eaten_at',start(selectedDate)).lt('eaten_at',end(selectedDate)).limit(1));
          if(existing.length&&!confirm(`${selectedDate} 已經有${mealTypes[mealType]}紀錄，仍要再新增一筆嗎？`)){
            submit.disabled=false;return;
          }
          const items=selectedItems.map(item=>{
            const out={...item};
            if(factor!==1){
              for(const field of ['calories','protein_g','carbs_g','fat_g','fiber_g','sugar_g','sodium_mg','serving_weight_g']){
                if(out[field]!==null&&Number.isFinite(Number(out[field])))out[field]=Math.round(Number(out[field])*factor*100)/100;
              }
              out.quantity=`${item.quantity||'原份量'} × ${factor}`;
            }
            return out;
          });
          const when=new Date(`${selectedDate}T${form.elements.meal_time.value}:00+08:00`).toISOString();
          const payload={meal_type:mealType,source:selectedDate>today()?'planned':'manual',eaten_at:when,
            notes:`快速記錄｜${origin}${factor!==1?`｜份量 × ${factor}`:''}`,items};
          status(dlg,'儲存中…');const {error}=await db.rpc('save_meals_with_items',{p_meals:[payload]});if(error)throw error;
          dlg.close();await onSaved?.();
        }catch(error){status(dlg,`儲存失敗：${error.message||'請重試'}`);submit.disabled=false;}
      });
    }
  }
  async function previewWorkout(){
    const rows=await ensureRows(db.from('activity_logs').select('id,activity_type,duration_minutes,calories_burned,steps,logged_at,notes')
      .eq('user_id',uid).neq('activity_type','Apple 健康每日摘要').lt('logged_at',start(selectedDate)).order('logged_at',{ascending:false}).limit(45));
    const chosen=rows.find(row=>row.activity_type && !(String(row.notes||'').match(/Apple.*(?:匯入|同步)|HealthKit/i)));
    if(!chosen){showError('先記錄一筆運動，之後就能快速重新記錄。');return;}
    const dlg=dialogHost();
    showDialog(dlg,`<form class="msj-quick-form"><h3>快速記錄最近運動</h3><p>新增到 ${h(selectedDate)} · 請確認這次真的有做這項運動</p>
      <label>活動名稱<input name="activity_type" maxlength="80" required value="${h(chosen.activity_type)}"></label>
      <div class="msj-quick-pair"><label>分鐘<input name="minutes" type="number" min="1" max="1440" step="1" required value="${h(chosen.duration_minutes||30)}"></label>
      <label>消耗熱量（選填）<input name="calories" type="number" min="0" step="1" value="${h(chosen.calories_burned??'')}"></label></div>
      <p class="msj-quick-hint">消耗數值沿用上次估算，請依這次實際運動調整；不會自動增加可吃熱量。</p>
      <div class="msj-quick-buttons"><button type="button" data-quick-cancel>取消</button><button type="submit">確認新增</button></div><p data-quick-status role="status"></p></form>`);
    const form=dlg.querySelector('form');form.onsubmit=async ev=>{
      ev.preventDefault();const btn=form.querySelector('[type=submit]');btn.disabled=true;
      try{
        const type=form.elements.activity_type.value.trim();const minutes=Number(form.elements.minutes.value);
        const kcal=amount(form.elements.calories.value);
        if(!type||!(minutes>=1&&minutes<=1440))throw Error('請確認活動名稱與分鐘數。');
        const existing=await ensureRows(db.from('activity_logs').select('id,activity_type,duration_minutes,calories_burned,logged_at,notes')
          .eq('user_id',uid).gte('logged_at',start(selectedDate)).lt('logged_at',end(selectedDate)).limit(150));
        const similar=existing.filter(x=>x.activity_type===type&&Math.abs(Number(x.duration_minutes)-minutes)<=2&&
          (kcal===null&&x.calories_burned===null||kcal!==null&&x.calories_burned!=null&&Math.abs(Number(x.calories_burned)-kcal)<=12));
        if(similar.length&&!confirm('當天已經有非常相近的運動紀錄。確認這是另一場不同的運動，仍要新增嗎？')){btn.disabled=false;return;}
        status(dlg,'儲存中…');const when=new Date(`${selectedDate}T${selectedDate===today()?timeNow():'12:00'}:00+08:00`).toISOString();
        const {error}=await db.from('activity_logs').insert({user_id:uid,activity_type:type,duration_minutes:minutes,
          calories_burned:kcal,steps:null,logged_at:when,notes:'快速記錄｜參考最近一次運動'});
        if(error)throw error;dlg.close();await onSaved?.();
      }catch(error){status(dlg,`儲存失敗：${error.message||'請稍後再試'}`);btn.disabled=false;}
    };
  }
}

// Open the correct day's diary group, not a second copy of meal details on Home.
export function openMealGroupAfterRender(type){
  if(!type)return;
  const root=document.getElementById('diaryMeals');if(!root)return;
  let done=false;const timeout=setTimeout(()=>observer.disconnect(),7000);
  const labels={breakfast:'早餐',lunch:'午餐',dinner:'晚餐',snack:'點心',other:'其他'};
  const open=()=>{
    if(done)return;
    const groups=[...root.querySelectorAll('.diary-meal-group')];
    const match=groups.find(g=>g.querySelector('.diary-meal-heading h3')?.textContent===labels[type]);
    if(match){done=true;match.querySelector('details')?.setAttribute('open','');match.scrollIntoView({block:'start',behavior:'smooth'});clearTimeout(timeout);observer.disconnect();}
  };
  const observer=new MutationObserver(open);observer.observe(root,{childList:true});open();
}

// Display a de-duplicated workout subtotal in Activity, leaving source records
// intact for auditing and editing. The existing activity Move metric stays separate.
export function mountActivityDedupeView(db,uid){
  const stats=document.getElementById('anActivityStats');if(!stats)return;
  const week=document.getElementById('anActivityWeekStats');
  const notice=document.createElement('p');notice.className='msj-activity-dedupe-notice';
  stats.insertAdjacentElement('afterend',notice);
  let seq=0,weekSeq=0;
  const getSelected=()=>{
    const m=(document.getElementById('anActivitySelected')?.textContent||'').match(/\d{4}[/-]\d\d[/-]\d\d/);
    return m?m[0].replaceAll('/','-'):today();
  };
  async function loadRows(from,to){return await ensureRows(db.from('activity_logs')
    .select('id,activity_type,duration_minutes,calories_burned,steps,logged_at,created_at,notes,total_calories,resting_calories')
    .eq('user_id',uid).gte('logged_at',start(from)).lt('logged_at',end(to)).order('logged_at').limit(700));}
  async function patchDay(){
    const version=++seq,day=getSelected();
    try{
      const rows=await loadRows(day,day);if(version!==seq||!stats.isConnected||getSelected()!==day)return;
      const result=summarizeDay(rows);
      // Apple TOTAL belongs to the daily summary, not workout rows.
      const totals=rows.filter(row=>row.activity_type==='Apple 健康每日摘要' && row.total_calories!==null && row.total_calories!==undefined &&
        Number.isFinite(Number(row.total_calories)) && Number(row.total_calories)>=0)
        .sort((a,b)=>Date.parse(b.created_at||b.logged_at)-Date.parse(a.created_at||a.logged_at));
      const total=totals.length?Number(totals[0].total_calories):null;
      const activityMetrics=stats.querySelector('.an-activity-metrics');
      if(activityMetrics){
        let totalTile=stats.querySelector('.msj-activity-day-total');
        if(!totalTile){totalTile=document.createElement('div');totalTile.className='msj-activity-day-total';activityMetrics.before(totalTile);}
        const html=`<span><b>${day===today()?'今日目前累積總消耗':'Apple Fitness 全天總消耗'}</b><small>Apple TOTAL · 靜態＋活動（不再加運動）</small></span><strong>${total===null?'尚未同步':Math.round(total).toLocaleString('zh-TW')+' <small>kcal</small>'}</strong>`;
        if(totalTile.innerHTML!==html)totalTile.innerHTML=html;
      }
      const metrics=stats.querySelectorAll('.an-activity-metrics > div');
      if(metrics.length>=4){
        metrics[0].querySelector('b').textContent=String(result.workouts.length);
        metrics[1].querySelector('b').textContent=`${Math.round(result.minutes)} 分`;
        metrics[3].querySelector('small').textContent='單次運動消耗（去重）';
        metrics[3].querySelector('b').textContent=result.workoutCalories===null?'—':`${Math.round(result.workoutCalories).toLocaleString('zh-TW')} kcal`;
      }
      notice.textContent=result.suppressed.length?`已辨識 ${result.suppressed.length} 筆與 Apple 健康重疊的運動；統計只計一次，原始紀錄仍保留於明細。`:
        'Apple 健康全天活動熱量已含運動，不會與單次運動消耗直接相加。';
    }catch(e){if(version===seq)notice.textContent='無法驗證運動去重；請勿將全天活動熱量與運動熱量相加。';}
  }
  async function patchWeek(){
    const version=++weekSeq,day=getSelected();
    const dow=new Date(`${day}T00:00:00Z`).getUTCDay();
    const monday=shiftDate(day,-((dow+6)%7)),sunday=shiftDate(monday,6);
    try{
      const rows=await loadRows(monday,sunday);if(version!==weekSeq||!week?.isConnected||getSelected()!==day)return;
      const sums=new Map();
      for(const row of rows){const d=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(row.logged_at));
        if(!sums.has(d))sums.set(d,[]);sums.get(d).push(row);}
      const dailies=[...sums.values()].map(summarizeDay);
      const calories=dailies.map(d=>d.workoutCalories).filter(x=>x!==null);
      const nodes=week.querySelectorAll(':scope > div');
      if(nodes.length>=5){
        nodes[0].querySelector('b').textContent=Math.round(dailies.reduce((a,d)=>a+d.minutes,0));
        nodes[3].querySelector('small').textContent=`單次運動消耗（去重，${calories.length} 天）`;
        nodes[3].querySelector('b').textContent=calories.length?`${Math.round(calories.reduce((a,b)=>a+b,0)).toLocaleString('zh-TW')} kcal`:'—';
        nodes[4].querySelector('b').textContent=`${dailies.filter(d=>d.workouts.length).length}/7`;
      }
    }catch{/* Main Activity view still shows source-by-source values. */}
  }
  const ob=new MutationObserver(()=>void patchDay());ob.observe(stats,{childList:true});
  const wb=new MutationObserver(()=>void patchWeek());if(week)wb.observe(week,{childList:true});
  void patchDay();void patchWeek();
  // Disconnect automatically when navigating; no background polling.
  const disconnectObserver=new MutationObserver(()=>{if(!stats.isConnected){ob.disconnect();wb.disconnect();disconnectObserver.disconnect();}});
  const app=document.getElementById('app');if(app)disconnectObserver.observe(app,{childList:true});
}
