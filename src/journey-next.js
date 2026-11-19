// Batch 3: read-only, Taiwan-local wellness insights. No database writes.
import { calculateNutrition } from './nutrition.js';
const tw = (d=new Date()) => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(d));
const add=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const range=(day,n=1)=>[new Date(day+'T00:00:00+08:00').toISOString(),new Date(add(day,n)+'T00:00:00+08:00').toISOString()];
const num=x=>Number.isFinite(Number(x))?Number(x):0;
const safe=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
async function fetchAll(q){const out=[];for(let p=0;p<12;p++){const {data,error}=await q.range(p*500,p*500+499);if(error)throw error;out.push(...(data||[]));if((data||[]).length<500)return out;}throw Error('紀錄量超過本頁讀取上限');}
const actual=m=>m.filter(x=>x.source!=='planned');
function totals(meals){const t={calories:0,protein:0,carbs:0,fat:0};for(const m of meals)for(const x of m.meal_items||[]){t.calories+=num(x.calories);t.protein+=num(x.protein_g);t.carbs+=num(x.carbs_g);t.fat+=num(x.fat_g);}return t;}
const card=(title,body)=>`<section class="card next-card"><h3>${safe(title)}</h3>${body}</section>`;
function place(id,html,anchor,where='afterend'){document.getElementById(id)?.remove();if(!anchor)return;const el=document.createElement('div');el.id=id;el.innerHTML=html;anchor.insertAdjacentElement(where,el);}
function goals(profile,weight){return calculateNutrition(profile,weight?.weight_kg??null)}
function bar(value,target){const p=target>0?Math.max(0,Math.min(100,value/target*100)):0;return `<div class="next-meter" role="progressbar" aria-valuenow="${Math.round(p)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${p}%"></span></div>`}
async function mealsBetween(db,uid,start,days){const [a,b]=range(start,days);return actual(await fetchAll(db.from('meals').select('source,eaten_at,meal_items(calories,protein_g,carbs_g,fat_g)').eq('user_id',uid).gte('eaten_at',a).lt('eaten_at',b)));}
export async function renderDailyBudget(db,uid,profile,weight){
 const anchor=[...document.querySelectorAll('.card')].find(x=>x.textContent.includes("TODAY'S NUTRITION SUMMARY"));if(!anchor)return;
 const day=tw(),week=add(day,-6),meals=await mealsBetween(db,uid,week,7);if(!document.contains(anchor))return;
 const todayMeals=meals.filter(m=>tw(m.eaten_at)===day),t=totals(todayMeals),g=goals(profile,weight);
 const budget=g.ready?`<div class="next-stats"><div><strong>${g.calorieTarget}</strong><small>今日目標 kcal</small></div><div><strong>${Math.round(t.calories)}</strong><small>已攝取 kcal</small></div><div><strong>${Math.round(g.calorieTarget-t.calories)}</strong><small>${t.calories>g.calorieTarget?'超出目標 kcal':'剩餘 kcal'}</small></div></div>${bar(t.calories,g.calorieTarget)}<p>蛋白質 ${t.protein.toFixed(1)} / ${g.protein} g，${t.protein>=g.protein?'已達目標':`尚差 ${(g.protein-t.protein).toFixed(1)} g`}</p>${bar(t.protein,g.protein)}`:'<p class="muted">請先在設定完成個人資料，並記錄體重，才能計算每日預算。</p>';
 const days=Array.from({length:7},(_,i)=>add(week,i));const cells=days.map(d=>{const m=meals.filter(x=>tw(x.eaten_at)===d),s=totals(m);return `<div class="next-day ${d===day?'next-today':''}"><b>${safe(d.slice(5))}</b><small>${m.length?Math.round(s.calories)+' kcal':'未紀錄'}</small><small>${m.length?s.protein.toFixed(0)+'g 蛋白質':'—'}</small></div>`}).join('');
 place('nextHome',card('今日熱量預算',budget+'<p class="muted">依個人設定估算；剩餘熱量不代表必須吃滿。未紀錄餐點不會自動估算。</p>')+card('最近七日飲食日曆',`<div class="next-calendar">${cells}</div><p class="muted">以台灣時間分日；只統計實際飲食，不含預計餐點。</p>`),anchor);
}
async function recentWeight(db,uid){const [a,b]=range(add(tw(),-90),91);return fetchAll(db.from('weight_logs').select('weight_kg,logged_at').eq('user_id',uid).gte('logged_at',a).lt('logged_at',b).order('logged_at',{ascending:true}));}
function trend(logs){const byDay=new Map();for(const l of logs)byDay.set(tw(l.logged_at),num(l.weight_kg));const points=[...byDay].sort((a,b)=>a[0].localeCompare(b[0]));if(points.length<8)return null;const first=points[0],last=points.at(-1);const days=(Date.parse(last[0])-Date.parse(first[0]))/86400000;if(days<21)return null;const slope=(last[1]-first[1])/days*7;return {slope,days,points:points.length,last:last[1]};}
export async function renderWeightForecast(db,uid,profile){const anchor=document.getElementById('insightWeight');if(!anchor)return;const logs=await recentWeight(db,uid);if(!document.contains(anchor))return;const t=trend(logs),target=Number(profile?.target_weight_kg);let body='<p class="muted">需要至少 8 個不同日期、涵蓋至少 21 天的體重紀錄，才顯示初步趨勢。</p>';
 if(t){body=`<p>近 ${t.days} 天（${t.points} 個紀錄日）觀察到的粗略趨勢：<b>${t.slope>0?'+':''}${t.slope.toFixed(2)} kg／週</b></p>`;if(Number.isFinite(target)&&target>0&&t.last>target&&t.slope<-0.05){const weeks=(t.last-target)/(-t.slope);body+=weeks<=104?`<p>若相同趨勢持續，約 <b>${Math.ceil(weeks)} 週</b>可能接近 ${target} kg。</p>`:'<p>依目前趨勢，目標時間無法可靠估計。</p>';}else{body+='<p>目前趨勢不適合推算達標日期（可能已達標、趨勢持平或體重上升）。</p>';}body+='<p class="muted">僅為簡易線性推估，會受水分、月經週期、測量時間等影響；不是保證，也不建議為趕上日期而過度限制飲食。</p>';}
 place('nextForecast',card('減重進度預測',body),anchor);
}
export async function renderCoachGuidance(db,uid,profile,weight){const anchor=document.querySelector('#anCoach')||[...document.querySelectorAll('.card')].find(x=>x.textContent.includes('Coach'));if(!anchor)return;const start=add(tw(),-6),meals=await mealsBetween(db,uid,start,7);if(!document.contains(anchor))return;const g=goals(profile,weight);const days=new Set(meals.map(m=>tw(m.eaten_at))).size;const s=totals(meals),avgCalories=days?s.calories/days:0,avgProtein=days?s.protein/days:0;const tips=[];
 if(days<4)tips.push(`最近七天只有 ${days} 天有飲食紀錄；先增加紀錄完整度，再判斷熱量是否合適。`);
 if(g.ready&&days>=4){if(avgProtein<g.protein*.8)tips.push(`有紀錄日的平均蛋白質約 ${avgProtein.toFixed(0)} g，低於目標 ${g.protein} g；可優先增加正餐蛋白質來源。`);else tips.push(`有紀錄日的平均蛋白質約 ${avgProtein.toFixed(0)} g，接近或達到設定目標。`);if(avgCalories<g.calorieTarget*.75)tips.push('有紀錄日熱量明顯低於目標；先確認是否漏記，不要只追求更低的熱量。');else if(avgCalories>g.calorieTarget*1.15)tips.push('有紀錄日熱量高於設定目標；可先查看飲料、點心和份量，不需要極端節食。');}
 if(!g.ready)tips.push('完成個人設定並新增體重後，才能產生更具體的熱量與蛋白質建議。');if(!tips.length)tips.push('目前紀錄與目標沒有明顯偏差；持續規律記錄並觀察每週平均體重即可。');
 place('nextCoach',card('本週個人化建議',`<p>最近七天：<b>${days}/7</b> 天有飲食紀錄，實際餐次 <b>${meals.length}</b>。</p><ul>${tips.map(x=>`<li>${safe(x)}</li>`).join('')}</ul><p class="muted">這是依現有紀錄產生的規則式建議，不是 AI 醫療判斷；沒有紀錄的日子不視為零攝取。</p>`),anchor);
}
