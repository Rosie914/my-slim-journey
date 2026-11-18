const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localDate = (date = new Date()) => { const d = new Date(date); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,10); };
const n = (v) => Number(v || 0);
const fmt = (v, digits = 1) => n(v).toFixed(digits);

export function renderAnalytics(tab) {
  if (tab === 'weight') return `<section class="card"><h2>體重趨勢</h2><p class="muted">記錄體重，觀察長期變化；單日波動不代表脂肪增減。</p><form id="anWeightForm" class="an-form"><label>體重（kg）<input name="weight_kg" type="number" min="25" max="250" step="0.1" required></label><label>日期<input name="logged_at" type="date" value="${localDate()}" required></label><label>備註（選填）<input name="notes" maxlength="300" placeholder="例如：起床、上完廁所後"></label><button type="submit">新增體重紀錄</button></form></section><section class="card"><div class="an-section-head"><h3>最近 30 筆紀錄</h3><span id="anWeightCount" class="muted"></span></div><div id="anWeightChart" class="an-chart-wrap"><p class="muted">讀取中…</p></div><div id="anWeightHistory"></div></section>`;
  if (tab === 'activity') return `<section class="card"><h2>運動與活動</h2><p class="muted">運動熱量是估算值；沒有可靠數值時可以留白。</p><form id="anActivityForm" class="an-form"><label>活動類型<input name="activity_type" required maxlength="80" placeholder="例如：快走、飛輪、重量訓練"></label><label>日期<input name="logged_at" type="date" value="${localDate()}" required></label><label>時間（分鐘）<input name="duration_minutes" type="number" min="0" max="1440" value="30" required></label><label>消耗熱量（kcal，選填）<input name="calories_burned" type="number" min="0" step="1"></label><label>步數（選填）<input name="steps" type="number" min="0" step="1"></label><label>備註（選填）<input name="notes" maxlength="300" placeholder="例如：輕鬆強度"></label><button type="submit">儲存活動</button></form></section><section class="card"><h3>最近活動</h3><div id="anActivityStats" class="an-stats"></div><div id="anActivityHistory"></div></section>`;
  if (tab === 'reports') return `<section class="card"><h2>每週回顧</h2><label>選擇週一日期<input id="anWeekStart" type="date" value="${weekStart(localDate())}"></label><div id="anReport" class="an-report"><p class="muted">讀取中…</p></div></section>`;
  if (tab === 'coach') return `<section class="card"><h2>Journey Coach</h2><p class="muted">根據你已儲存的紀錄整理趨勢，不會把單日體重或熱量當成診斷。</p><div id="anCoach" class="an-coach"><p class="muted">正在整理近期紀錄…</p></div></section>`;
  return '';
}
function weekStart(date) { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() - ((d.getDay()+6)%7)); return localDate(d); }
function dateTime(date) { return new Date(`${date}T12:00:00`).toISOString(); }
async function rows(db, table, uid, column, from, to) {
  let q = db.from(table).select('*').eq('user_id', uid).order(column, {ascending:false}).limit(500);
  if (from) q = q.gte(column, from);
  if (to) q = q.lt(column, to);
  const {data,error} = await q; if (error) throw error; return data || [];
}
function lineChart(data) {
  if (!data.length) return '<p class="muted">還沒有體重紀錄。</p>';
  const ordered = [...data].reverse(); const vals = ordered.map(x => n(x.weight_kg));
  const min = Math.min(...vals)-0.5, max = Math.max(...vals)+0.5, span = Math.max(0.5,max-min);
  const pts = vals.map((v,i) => `${24 + i* (252/Math.max(1,vals.length-1))},${116-(v-min)/span*88}`).join(' ');
  return `<svg class="an-chart" viewBox="0 0 300 145" role="img" aria-label="體重變化折線圖"><line x1="24" y1="116" x2="276" y2="116"/><line x1="24" y1="20" x2="24" y2="116"/><polyline points="${pts}"/><text x="24" y="136">${esc(ordered[0].logged_at.slice(0,10))}</text><text x="276" y="136" text-anchor="end">${esc(ordered.at(-1).logged_at.slice(0,10))}</text><text x="26" y="15">${fmt(max)} kg</text><text x="26" y="108">${fmt(min)} kg</text></svg><p class="an-chart-summary">最新 ${fmt(data[0].weight_kg)} kg${data.length>1 ? `・較前次 ${n(data[0].weight_kg)-n(data[1].weight_kg)>0?'+':''}${fmt(n(data[0].weight_kg)-n(data[1].weight_kg))} kg` : ''}</p>`;
}
function historyRow(item, type) {
  const title = type === 'weight' ? `${fmt(item.weight_kg)} kg` : esc(item.activity_type);
  const sub = type === 'weight' ? (item.notes || '') : `${n(item.duration_minutes)} 分鐘${item.calories_burned != null ? `・${n(item.calories_burned)} kcal` : ''}${item.steps != null ? `・${n(item.steps)} 步` : ''}${item.notes ? `・${esc(item.notes)}` : ''}`;
  return `<div class="an-history-row"><div><b>${title}</b><small>${esc(item.logged_at.slice(0,10))}${sub ? `・${esc(sub)}` : ''}</small></div><button type="button" class="an-delete" data-id="${item.id}" data-kind="${type}" aria-label="刪除紀錄">刪除</button></div>`;
}
export async function initAnalytics(db, uid, tab, onSaved = () => {}) {
  const bindDelete = (root) => root?.querySelectorAll('.an-delete').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('確定刪除這筆紀錄？')) return;
    const table = btn.dataset.kind === 'weight' ? 'weight_logs' : 'activity_logs';
    const {error} = await db.from(table).delete().eq('id',btn.dataset.id).eq('user_id',uid);
    if (error) return alert(`刪除失敗：${error.message}`); await onSaved();
  }));
  if (tab === 'weight') {
    const list = await rows(db,'weight_logs',uid,'logged_at');
    $('anWeightCount').textContent = `${list.length} 筆`;
    $('anWeightChart').innerHTML = lineChart(list);
    $('anWeightHistory').innerHTML = list.length ? list.map(x=>historyRow(x,'weight')).join('') : '<p class="muted">尚無紀錄，新增第一筆吧。</p>';
    bindDelete($('anWeightHistory'));
    $('anWeightForm').onsubmit = async e => { e.preventDefault(); const f=new FormData(e.currentTarget); const {error}=await db.from('weight_logs').insert({user_id:uid,weight_kg:n(f.get('weight_kg')),logged_at:dateTime(f.get('logged_at')),notes:f.get('notes')||null}); if(error)return alert(error.message); alert('體重紀錄已新增'); await onSaved(); };
  }
  if (tab === 'activity') {
    const list = await rows(db,'activity_logs',uid,'logged_at');
    const totalMin=list.reduce((s,x)=>s+n(x.duration_minutes),0), totalSteps=list.reduce((s,x)=>s+n(x.steps),0);
    $('anActivityStats').innerHTML = `<div><b>${list.length}</b><small>次活動</small></div><div><b>${totalMin}</b><small>累積分鐘</small></div><div><b>${totalSteps.toLocaleString('zh-TW')}</b><small>紀錄步數</small></div>`;
    $('anActivityHistory').innerHTML = list.length ? list.map(x=>historyRow(x,'activity')).join('') : '<p class="muted">尚無活動紀錄。</p>';
    bindDelete($('anActivityHistory'));
    $('anActivityForm').onsubmit = async e => { e.preventDefault(); const f=new FormData(e.currentTarget); const {error}=await db.from('activity_logs').insert({user_id:uid,activity_type:String(f.get('activity_type')).trim(),duration_minutes:n(f.get('duration_minutes')),calories_burned:f.get('calories_burned')?n(f.get('calories_burned')):null,steps:f.get('steps')?n(f.get('steps')):null,logged_at:dateTime(f.get('logged_at')),notes:f.get('notes')||null}); if(error)return alert(error.message); alert('活動紀錄已儲存'); await onSaved(); };
  }
  if (tab === 'reports' || tab === 'coach') {
    const render = async () => {
      const start = tab==='reports' ? $('anWeekStart').value : weekStart(localDate());
      const endDate = new Date(`${start}T12:00:00`); endDate.setDate(endDate.getDate()+7); const end=localDate(endDate);
      const [weights,activities,meals] = await Promise.all([rows(db,'weight_logs',uid,'logged_at',dateTime(start),dateTime(end)),rows(db,'activity_logs',uid,'logged_at',dateTime(start),dateTime(end)),rows(db,'meals',uid,'eaten_at',dateTime(start),dateTime(end))]);
      const mealIds=meals.map(m=>m.id); let items=[];
      if(mealIds.length){const {data,error}=await db.from('meal_items').select('*').eq('user_id',uid).in('meal_id',mealIds);if(error)throw error;items=data||[];}
      const totals=items.reduce((a,x)=>({cal:a.cal+n(x.calories),p:a.p+n(x.protein_g),c:a.c+n(x.carbs_g),f:a.f+n(x.fat_g)}),{cal:0,p:0,c:0,f:0});
      const mins=activities.reduce((s,x)=>s+n(x.duration_minutes),0), steps=activities.reduce((s,x)=>s+n(x.steps),0);
      if(tab==='reports') $('anReport').innerHTML=`<div class="an-stats"><div><b>${meals.length}</b><small>餐次</small></div><div><b>${Math.round(totals.cal)}</b><small>飲食 kcal</small></div><div><b>${mins}</b><small>活動分鐘</small></div><div><b>${weights.length}</b><small>體重紀錄</small></div></div><h3>營養紀錄合計</h3><p>蛋白質 ${fmt(totals.p)} g ・碳水 ${fmt(totals.c)} g ・脂肪 ${fmt(totals.f)} g</p><p>活動步數合計：${steps.toLocaleString('zh-TW')}</p><p class="muted">統計期間：${start} 至 ${localDate(new Date(new Date(`${end}T12:00:00`).getTime()-86400000))}。以上是紀錄合計，不等同每日平均或完整攝取量。</p>`;
      else { const recent=await rows(db,'weight_logs',uid,'logged_at'); const delta=recent.length>1?n(recent[0].weight_kg)-n(recent[1].weight_kg):null; const tips=[]; tips.push(meals.length?`這週已記錄 ${meals.length} 餐，營養合計約 ${Math.round(totals.cal)} kcal。`:'這週還沒有飲食紀錄，可以先從完整記錄一餐開始。'); tips.push(activities.length?`完成 ${activities.length} 次活動，累積 ${mins} 分鐘。`:'這週活動紀錄較少，可從舒服且可持續的散步開始。'); tips.push(delta===null?'累積至少兩筆體重紀錄後，才能比較前後變化。':`最近兩筆體重相差 ${delta>0?'+':''}${fmt(delta)} kg；請觀察數週平均，不必因單次變化調整飲食。`); $('anCoach').innerHTML=`<ul>${tips.map(t=>`<li>${esc(t)}</li>`).join('')}</ul><p class="muted">Coach 目前是依資料產生的規則式摘要，並非生成式 AI、醫療診斷或營養師處方。</p>`; }
    };
    if(tab==='reports') $('anWeekStart').addEventListener('change',()=>render().catch(e=>alert(e.message)));
    await render();
  }
}
