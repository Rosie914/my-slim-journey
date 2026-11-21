// Lightweight, accessible SVG line charts. Missing dates remain gaps.
export function trendLineChart(points, {unit = '', target = null, color = '#b58bc4', label = '變化趨勢', height = 160} = {}) {
  const clean = points.map(p => ({ date: String(p.date), value: p.value == null || !Number.isFinite(Number(p.value)) ? null : Number(p.value) }));
  const known = clean.filter(p => p.value !== null);
  if (!known.length) return `<p class="msj-trend-empty">尚無可顯示的${label}紀錄</p>`;
  const nums = known.map(p => p.value);
  if (Number.isFinite(Number(target)) && target !== null) nums.push(Number(target));
  const lo = Math.min(...nums), hi = Math.max(...nums), pad = Math.max((hi-lo)*.16, unit === '%' ? .35 : unit === 'kg' ? .3 : 20);
  const min = Math.max(0, lo-pad), max = hi+pad, range = Math.max(.001,max-min);
  const W=340, L=35, R=13, T=15, B=29, bottom=height-B, chartH=bottom-T;
  const x = i => L+(W-L-R)*(clean.length === 1 ? .5 : i/(clean.length-1));
  const y = v => bottom-(v-min)/range*chartH;
  const fmt = v => Number(v).toLocaleString('zh-TW',{maximumFractionDigits:1});
  const safe = v => String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const lines=[];let segment=[];
  for(let i=0;i<clean.length;i++){
    if(clean[i].value===null){if(segment.length)lines.push(segment);segment=[];}
    else segment.push(`${x(i).toFixed(1)},${y(clean[i].value).toFixed(1)}`);
  }
  if(segment.length)lines.push(segment);
  const targetLine=target!=null&&Number.isFinite(Number(target))?`<line x1="${L}" x2="${W-R}" y1="${y(Number(target))}" y2="${y(Number(target))}" stroke="#b6a6b8" stroke-dasharray="5 4" stroke-width="1.5"/>`:'';
  return `<div class="msj-trend-graph"><svg viewBox="0 0 ${W} ${height}" role="img" aria-label="${safe(label)}折線圖，${known.length} 筆有效資料" preserveAspectRatio="xMidYMid meet">
    <line x1="${L}" x2="${W-R}" y1="${bottom}" y2="${bottom}" stroke="#e8e0e8"/>
    <text x="${L-5}" y="${T+3}" text-anchor="end" class="msj-chart-axis">${fmt(max)}</text><text x="${L-5}" y="${bottom}" text-anchor="end" class="msj-chart-axis">${fmt(min)}</text>
    ${targetLine}
    ${lines.map(a=>a.length>1?`<polyline points="${a.join(' ')}" fill="none" stroke="${color}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`:'').join('')}
    ${clean.map((p,i)=>p.value===null?'':`<circle cx="${x(i)}" cy="${y(p.value)}" r="4" fill="white" stroke="${color}" stroke-width="2.3"><title>${safe(p.date)}：${fmt(p.value)} ${safe(unit)}</title></circle>`).join('')}
    <text x="${L}" y="${height-5}" class="msj-chart-axis">${safe(clean[0].date.slice(5).replace('-','/'))}</text><text x="${W-R}" y="${height-5}" text-anchor="end" class="msj-chart-axis">${safe(clean.at(-1).date.slice(5).replace('-','/'))}</text>
  </svg></div>`;
}

export function goalProgress(start,current,target,unit,lowerIsBetter=true){
  if (![start,current,target].every(v=>v!=null&&Number.isFinite(Number(v)))) return '<p class="msj-trend-empty">設定目標並記錄數值後，即可顯示進度</p>';
  start=Number(start);current=Number(current);target=Number(target);
  const span=lowerIsBetter?start-target:target-start;
  const progress=span>0?Math.max(0,Math.min(100,(lowerIsBetter?start-current:current-start)/span*100)):current===target?100:0;
  const remaining=lowerIsBetter?Math.max(0,current-target):Math.max(0,target-current);
  return `<div class="msj-goal-progress"><div class="msj-goal-progress-label"><span>目標進度 ${Math.round(progress)}%</span><span>${remaining===0?'已達目標':`還差 ${remaining.toFixed(1)} ${unit}`}</span></div><div class="msj-goal-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><span style="width:${progress}%"></span></div></div>`;
}

export async function mountWeightTrends(db,uid,profile){
  const anchor=document.getElementById('anWeightTrend');
  if(!anchor)return;
  const existing=document.getElementById('msjWeightTrendPanel');
  if(existing)existing.remove();
  const panel=document.createElement('section');panel.id='msjWeightTrendPanel';panel.className='card msj-trends-panel';
  panel.innerHTML='<div class="msj-trend-heading"><h2>體重與體脂趨勢</h2><span>實際紀錄 · 未測量不補值</span></div><div class="msj-trend-period" role="group" aria-label="趨勢期間"><button type="button" data-period="7">7 天</button><button type="button" data-period="30" class="active">30 天</button><button type="button" data-period="90">90 天</button></div><div id="msjWeightTrendContent">正在載入…</div>';
  anchor.closest('section.card')?.before(panel);
  let period=30,rows=[],error=null;
  try {
    const since=new Date();since.setHours(0,0,0,0);since.setDate(since.getDate()-89);
    const {data,error:e}=await db.from('weight_logs').select('weight_kg,body_fat_pct,logged_at').eq('user_id',uid).gte('logged_at',since.toISOString()).order('logged_at',{ascending:true}).limit(1000);
    if(e)throw e;rows=data||[];
  }catch(e){error=e;}
  if(!panel.isConnected)return;
  function draw(){
    const content=panel.querySelector('#msjWeightTrendContent');
    if(error){content.textContent='趨勢資料載入失敗：'+error.message;return;}
    const dates=Array.from({length:period},(_,i)=>{const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-period+1+i);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;});
    const byDay=new Map();for(const r of rows){const d=new Date(r.logged_at);const day=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;const p=byDay.get(day)||{};if(Number(r.weight_kg)>0)p.weight=Number(r.weight_kg);if(r.body_fat_pct!=null&&Number(r.body_fat_pct)>0)p.fat=Number(r.body_fat_pct);byDay.set(day,p);}
    const weights=dates.map(date=>({date,value:byDay.get(date)?.weight??null}));
    const fats=dates.map(date=>({date,value:byDay.get(date)?.fat??null}));
    const targetFat=profile?.target_body_fat_pct==null?null:Number(profile.target_body_fat_pct);
    content.innerHTML=`<div class="msj-trend-section"><h3>體重 <small>kg</small></h3>${trendLineChart(weights,{unit:'kg',label:'體重',color:'#a795c6'})}</div><div class="msj-trend-section"><h3>體脂 <small>%</small></h3>${trendLineChart(fats,{unit:'%',label:'體脂',color:'#d5a2b8',target:targetFat})}${targetFat!=null?`<p class="msj-trend-foot">目標體脂 ${targetFat.toFixed(1)}% · 虛線為目標</p>`:''}</div>`;
  }
  panel.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{period=Number(b.dataset.period);panel.querySelectorAll('[data-period]').forEach(x=>x.classList.toggle('active',x===b));draw();});
  draw();
}
