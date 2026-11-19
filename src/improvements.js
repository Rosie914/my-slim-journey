// My Slim Journey: progressive UI enhancements; no schema changes.
import { calculateNutrition } from './nutrition.js';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localDate = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const number = x => Number(x ?? 0);
const monday = date => {const d=new Date(date+'T12:00:00+08:00');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10)};
const dayRange = date => {const a=new Date(date+'T00:00:00+08:00');return [a.toISOString(),new Date(a.getTime()+86400000).toISOString()]};
const weekRange = date => {const a=new Date(monday(date)+'T00:00:00+08:00');return [a.toISOString(),new Date(a.getTime()+7*86400000).toISOString()]};
const toLocal = iso => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
async function fetchAll(query, pageSize=500){let result=[];for(let i=0;i<10;i++){const {data,error}=await query.range(i*pageSize,(i+1)*pageSize-1);if(error)throw error;result.push(...(data||[]));if(!data||data.length<pageSize)break;}return result}
export async function enhanceHome(db,uid,profile,latestWeight){
 const card=document.querySelector('.nutrition-card');if(!card)return;
 const date=localDate();const [from,to]=dayRange(date);
 const meals=await fetchAll(db.from('meals').select('id,source,meal_items(calories,protein_g,carbs_g,fat_g)').eq('user_id',uid).gte('eaten_at',from).lt('eaten_at',to));
 const total={calories:0,protein:0,carbs:0,fat:0};let count=0;
 for(const meal of meals){if(meal.source==='planned')continue;count++;for(const item of meal.meal_items||[]){total.calories+=number(item.calories);total.protein+=number(item.protein_g);total.carbs+=number(item.carbs_g);total.fat+=number(item.fat_g)}}
 // Re-render the nutrition summary and today's actual total from the same underlying meals.
 const {renderNutritionSummary}=await import('./nutrition.js');
 card.outerHTML=renderNutritionSummary(profile,latestWeight?.weight_kg == null?null:Number(latestWeight.weight_kg),total);
 const summary=[...document.querySelectorAll('.card')].find(x=>x.textContent.includes("TODAY'S NUTRITION SUMMARY"));
 if(summary){summary.querySelector('h2').textContent=`${Math.round(total.calories)} kcal`;const vals=summary.querySelectorAll('.macros b');[total.protein,total.carbs,total.fat].forEach((v,i)=>{if(vals[i])vals[i].textContent=v.toFixed(1)+'g'});summary.insertAdjacentHTML('beforeend',`<p class="muted">${esc(date)} · 已記錄 ${count} 餐（不含預計飲食）</p>`)}
 const weightCard=[...document.querySelectorAll('.card')].find(x=>x.textContent.includes('MY WEIGHT JOURNEY'));
 if(weightCard){const logs=await fetchAll(db.from('weight_logs').select('weight_kg,logged_at').eq('user_id',uid).order('logged_at',{ascending:false}).limit(90));const current=logs[0]?.weight_kg;const target=profile?.target_weight_kg;const weekFrom=weekRange(date)[0];const prior=logs.find(x=>new Date(x.logged_at)<new Date(weekFrom));if(current!=null){const delta=prior?number(current)-number(prior.weight_kg):null;weightCard.insertAdjacentHTML('beforeend',`<p><b>距離長期目標：</b>${target!=null?Math.max(0,number(current)-number(target)).toFixed(1)+' kg':'尚未設定'}</p><p class="muted">${delta==null?'尚無足夠的跨週體重紀錄':`相較本週開始前最近一筆：${delta>0?'+':''}${delta.toFixed(1)} kg`}。單週變化不代表純脂肪變化。</p>`)}}
}
export function enhanceMeals(){
 const form=$('#msManualForm'),favorites=$('#msFavoriteList');if(!form||!favorites)return;
 if(!$('#msFavoriteSearch')){const box=document.createElement('label');box.textContent='搜尋常吃食物';box.innerHTML='<span>搜尋常吃食物</span><input id="msFavoriteSearch" type="search" placeholder="輸入食物名稱或品牌">';favorites.before(box);box.querySelector('input').addEventListener('input',e=>{const q=e.target.value.trim().toLocaleLowerCase();favorites.querySelectorAll('.ms-fav').forEach(row=>row.hidden=!row.textContent.toLocaleLowerCase().includes(q))});}
 const search=$('#msFavoriteSearch');const observer=new MutationObserver(()=>{if(search?.value){const q=search.value.trim().toLocaleLowerCase();favorites.querySelectorAll('.ms-fav').forEach(row=>row.hidden=!row.textContent.toLocaleLowerCase().includes(q))}});observer.observe(favorites,{childList:true});
 const note=document.createElement('p');note.className='muted';note.textContent='提示：在「我的常吃食物」按「帶入」，就能把營養數值填入上方手動飲食表單。';favorites.before(note);
}
export async function enhanceReport(db,uid){
 const holder=$('#anReport'),picker=$('#anWeekStart');if(!holder||!picker)return;
 const render=async()=>{const date=picker.value||localDate();const [from,to]=weekRange(date);const [meals,weights,activities]=await Promise.all([
 fetchAll(db.from('meals').select('id,source,eaten_at,meal_items(calories,protein_g,carbs_g,fat_g)').eq('user_id',uid).gte('eaten_at',from).lt('eaten_at',to)),
 fetchAll(db.from('weight_logs').select('weight_kg,logged_at').eq('user_id',uid).gte('logged_at',from).lt('logged_at',to)),
 fetchAll(db.from('activity_logs').select('duration_minutes,steps,logged_at').eq('user_id',uid).gte('logged_at',from).lt('logged_at',to))]);
 const actual=meals.filter(x=>x.source!=='planned');const sum={calories:0,protein:0,carbs:0,fat:0};for(const m of actual)for(const i of m.meal_items||[]){sum.calories+=number(i.calories);sum.protein+=number(i.protein_g);sum.carbs+=number(i.carbs_g);sum.fat+=number(i.fat_g)}
 const days=new Set(actual.map(x=>toLocal(x.eaten_at))).size;const avg=weights.length?weights.reduce((s,x)=>s+number(x.weight_kg),0)/weights.length:null;
 const last=new Date(new Date(to).getTime()-86400000);holder.innerHTML=`<div class="an-stats"><div><b>${actual.length}</b><small>實際餐次</small></div><div><b>${Math.round(sum.calories)}</b><small>總熱量 kcal</small></div><div><b>${days?Math.round(sum.calories/days):0}</b><small>有記錄日平均 kcal</small></div><div><b>${activities.reduce((s,x)=>s+number(x.duration_minutes),0)}</b><small>活動分鐘</small></div></div><h3>本週營養統計</h3><p>蛋白質 ${sum.protein.toFixed(1)} g · 碳水 ${sum.carbs.toFixed(1)} g · 脂肪 ${sum.fat.toFixed(1)} g</p><p>有飲食紀錄的天數：${days} / 7 天</p><p>體重紀錄：${weights.length} 筆${avg!=null?' · 平均 '+avg.toFixed(1)+' kg':''}</p><p>運動紀錄：${activities.length} 次 · 步數 ${activities.reduce((s,x)=>s+number(x.steps),0).toLocaleString('zh-TW')}</p><p class="muted">統計：${esc(monday(date))} 至 ${esc(toLocal(last.toISOString()))}（台灣時間 00:00–24:00）。平均熱量只除以有記錄飲食的天數，並非完整 7 日平均。預計飲食不計入。</p>`;
 };picker.addEventListener('change',()=>render().catch(e=>holder.textContent=e.message));await render();
}
