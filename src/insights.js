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
const delta = (now,previous,unit='') => previous==null||now==null?'資料不足':`${now-previous>0?'+':''}${fmt(now-previous)}${unit}`;
function card(title,html){return `<section class="card insight-card"><h3>${esc(title)}</h3>${html}</section>`}
function bars(data,unit='kcal'){const max=Math.max(1,...data.map(x=>x.value));return `<div class="insight-bars">${data.map(x=>`<div class="insight-bar-row"><span>${esc(x.label)}</span><div class="insight-track"><div class="insight-fill" style="width:${Math.min(100,Math.max(0,x.value/max*100))}%"></div></div><b>${Math.round(x.value)} ${unit}</b></div>`).join('')}</div>`}
function insertAfter(anchor,html,id){document.getElementById(id)?.remove();const div=document.createElement('div');div.id=id;div.innerHTML=html;anchor?.insertAdjacentElement('afterend',div)}
function weeklyWeight(logs){const grouped=new Map();for(const x of logs){const d=dateTW(x.logged_at),w=monday(d);if(!grouped.has(w))grouped.set(w,new Map());const day=grouped.get(w);const old=day.get(d);if(!old||new Date(x.logged_at)>new Date(old.logged_at))day.set(d,x)}return [...grouped].sort((a,b)=>a[0].localeCompare(b[0])).map(([week,days])=>({week,weight:avg([...days.values()].map(x=>val(x.weight_kg))),days:days.size}))}
export async function renderWeightInsights(db,uid,profile){
 const anchor=$('anWeightChart');if(!anchor)return;
 const [from,to]=bounds(datePlus(dateTW(),-112),113);
 const logs=await all(db.from('weight_logs').select('weight_kg,logged_at').eq('user_id',uid).gte('logged_at',from).lt('logged_at',to).order('logged_at',{ascending:false}));
 if(!$('anWeightChart'))return;
 const weekly=weeklyWeight(logs),last=weekly.at(-1),prev=weekly.at(-2),target=profile?.target_weight_kg;
 const rows=weekly.slice(-8).reverse().map(x=>`<tr><td>${esc(x.week)}</td><td>${fmt(x.weight)} kg</td><td>${x.days} 天</td></tr>`).join('');
 const chart=weekly.length?bars(weekly.slice(-8).map(x=>({label:x.week.slice(5),value:x.weight})),'kg'):'<p class="muted">尚無足夠紀錄。</p>';
 insertAfter(anchor,card('每週平均體重（最近 16 週）',`<p><b>最近一週平均：</b>${fmt(last?.weight)} kg</p><p><b>與前一個有紀錄的週相比：</b>${delta(last?.weight,prev?.weight,' kg')}</p><p><b>距離長期目標：</b>${target!=null&&last?`${Math.max(0,last.weight-val(target)).toFixed(1)} kg`:'尚未設定或沒有紀錄'}</p>${chart}<table class="insight-table"><thead><tr><th>週一日期</th><th>平均體重</th><th>紀錄天數</th></tr></thead><tbody>${rows}</tbody></table><p class="muted">每天只取最新一筆體重計算週平均；不足一週的紀錄仍會顯示。長條長度以絕對體重比較，數值差異請以表格為準。</p>`),'insightWeight');
}
export async function renderMealInsights(db,uid,profile,latestWeight){
 const anchor=$('msManualForm');if(!anchor)return;
 const [from,to]=bounds(dateTW());const meals=actual(await all(db.from('meals').select('id,meal_type,source,eaten_at,meal_items(calories,protein_g,carbs_g,fat_g)').eq('user_id',uid).gte('eaten_at',from).lt('eaten_at',to)));
 if(!$('msManualForm'))return;
 const total=sumItems(meals),types={breakfast:'早餐',lunch:'午餐',dinner:'晚餐',snack:'點心',other:'其他'};
 const groups=new Map();for(const m of meals){const k=m.meal_type||'other';groups.set(k,(groups.get(k)||0)+sumItems([m]).calories)}
 const goal=calculateNutrition(profile,latestWeight?.weight_kg),pct=goal.ready&&goal.protein?Math.round(total.protein/goal.protein*100):null;
 const breakdown=[...groups].map(([k,v])=>({label:types[k]||k,value:v}));
 insertAfter(anchor,card('今日飲食快速分析',`<div class="insight-summary"><div><b>${Math.round(total.calories)}</b><small>已記錄 kcal</small></div><div><b>${fmt(total.protein)}</b><small>蛋白質 g</small></div><div><b>${pct==null?'—':pct+'%'}</b><small>蛋白質目標達成</small></div></div>${breakdown.length?bars(breakdown):'<p class="muted">今天尚無實際飲食紀錄。</p>'}<p class="muted">以已記錄的實際飲食計算，不含預計餐點；未記錄的食物不會自動補入。</p>`),'insightMeal');
}
export async function renderReportInsights(db,uid){
 const anchor=$('anReport'),picker=$('anWeekStart');if(!anchor||!picker)return;
 const chosen=picker.value||dateTW(),start=monday(chosen),previous=datePlus(start,-7),[from,to]=bounds(previous,14);
 const meals=actual(await all(db.from('meals').select('id,source,eaten_at,meal_items(calories,protein_g,carbs_g,fat_g)').eq('user_id',uid).gte('eaten_at',from).lt('eaten_at',to)));
 const weights=await all(db.from('weight_logs').select('weight_kg,logged_at').eq('user_id',uid).gte('logged_at',from).lt('logged_at',to));
 if(!$('anReport')||picker.value!==chosen)return;
 const weekly=s=>{const e=datePlus(s,7);const ms=meals.filter(x=>dateTW(x.eaten_at)>=s&&dateTW(x.eaten_at)<e);const ws=weeklyWeight(weights).find(x=>x.week===s);const days=new Set(ms.map(x=>dateTW(x.eaten_at))).size;const t=sumItems(ms);return {...t,meals:ms.length,days,dayAverage:days?t.calories/days:null,weight:ws?.weight??null}};
 const current=weekly(start),prior=weekly(previous);
 const line=(label,a,b,unit='')=>`<tr><th>${esc(label)}</th><td>${a==null?'—':fmt(a)}</td><td>${b==null?'—':fmt(b)}</td><td>${delta(a,b,unit)}</td></tr>`;
 const html=card('本週 vs 上週',`<div class="insight-scroll"><table class="insight-table"><thead><tr><th>指標</th><th>本週</th><th>上週</th><th>變化</th></tr></thead><tbody>${line('實際餐次',current.meals,prior.meals)}${line('記錄天數',current.days,prior.days)}${line('飲食總熱量 kcal',current.calories,prior.calories)}${line('有紀錄日均 kcal',current.dayAverage,prior.dayAverage)}${line('蛋白質總量 g',current.protein,prior.protein)}${line('週平均體重 kg',current.weight,prior.weight,' kg')}</tbody></table></div><p class="muted">本週：${esc(start)}–${esc(datePlus(start,6))}；上週：${esc(previous)}–${esc(datePlus(previous,6))}。以台灣日期分組，週一開始；有紀錄日均值不是完整飲食日均值。沒有體重資料時不推估變化。</p>`);
 insertAfter(anchor,html,'insightReport');
 if(!picker.dataset.insightBound){picker.dataset.insightBound='1';picker.addEventListener('change',()=>renderReportInsights(db,uid).catch(e=>{const el=$('insightReport');if(el)el.textContent='跨週比較讀取失敗：'+e.message}));}
}
