// Meal history module for existing Supabase meals + meal_items tables.
const esc = v => String(v ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const n = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const labels = {breakfast:"早餐",lunch:"午餐",dinner:"晚餐",snack:"點心",other:"其他"};
const today = () => { const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10); };
const total = xs => xs.reduce((a,x)=>({k:a.k+n(x.calories),p:a.p+n(x.protein_g),c:a.c+n(x.carbs_g),f:a.f+n(x.fat_g)}),{k:0,p:0,c:0,f:0});
export function renderMealHistory(){return `<section class="card meal-history" id="mealHistory"><div class="mh-head"><h2>飲食歷史</h2><button type="button" id="mhReload" class="mh-secondary">重新整理</button></div><label>選擇日期<input id="mhDate" type="date" value="${today()}"></label><div id="mhTotals" class="mh-totals"></div><p id="mhStatus" class="muted">讀取中…</p><div id="mhList"></div><div id="mhEditor"></div></section>`;}
export function initMealHistory(db,uid,onSaved=()=>{}){
 const date=document.querySelector("#mhDate"),list=document.querySelector("#mhList"),totals=document.querySelector("#mhTotals"),status=document.querySelector("#mhStatus"),editor=document.querySelector("#mhEditor");
 if(!date||!list||!totals||!status||!editor)return;
 let meals=[],items=[];
 async function load(){
  status.textContent="讀取中…";editor.innerHTML="";list.innerHTML="";
  const a=new Date(date.value+"T00:00:00"),b=new Date(date.value+"T23:59:59.999");
  let r=await db.from("meals").select("*").eq("user_id",uid).gte("eaten_at",a.toISOString()).lte("eaten_at",b.toISOString()).order("eaten_at");
  if(r.error){status.textContent="讀取失敗："+r.error.message;return;} meals=r.data||[];items=[];
  if(meals.length){r=await db.from("meal_items").select("*").eq("user_id",uid).in("meal_id",meals.map(x=>x.id)).order("created_at");if(r.error){status.textContent=r.error.message;return;}items=r.data||[];}
  const t=total(items);totals.innerHTML=[["熱量",Math.round(t.k)+" kcal"],["蛋白質",t.p.toFixed(1)+" g"],["碳水",t.c.toFixed(1)+" g"],["脂肪",t.f.toFixed(1)+" g"]].map(x=>`<div><b>${x[1]}</b><small>${x[0]}</small></div>`).join("");
  status.textContent=meals.length?`共 ${meals.length} 筆餐點`:"這一天還沒有飲食紀錄。";
  list.innerHTML=Object.keys(labels).map(type=>{const group=meals.filter(m=>m.meal_type===type);return group.length?`<div class="mh-group"><h3>${labels[type]}</h3>${group.map(m=>{const its=items.filter(i=>i.meal_id===m.id),s=total(its);return `<button class="mh-entry" data-id="${m.id}"><span><b>${esc(its.map(i=>i.food_name).join("、")||m.notes||"餐點")}</b><small>${new Date(m.eaten_at).toLocaleTimeString("zh-TW",{hour:"2-digit",minute:"2-digit"})} · ${its.length} 項</small></span><b>${Math.round(s.k)} kcal</b></button>`}).join("")}</div>`:""}).join("");
  list.querySelectorAll("[data-id]").forEach(el=>el.onclick=()=>edit(el.dataset.id));
 }
 function row(x={}){return `<div class="mh-item" data-id="${esc(x.id||"")}"><div class="mh-head"><b>食物項目</b><button type="button" class="mh-remove mh-secondary">移除</button></div>${field("food_name","食物名稱",x.food_name||"","text")}${field("quantity","份量",x.quantity||"","text")}${["calories","protein_g","carbs_g","fat_g"].map((k,i)=>field(k,["熱量 kcal","蛋白質 g","碳水 g","脂肪 g"][i],n(x[k]),"number")).join("")}</div>`}
 function field(k,label,v,type){return `<label>${label}<input data-field="${k}" type="${type}" min="${type==="number"?0:""}" step="${k==="calories"?1:0.1}" value="${esc(v)}" ${k==="food_name"?"required":""}></label>`}
 async function edit(id){
  const m=meals.find(x=>x.id===id);if(!m)return;const its=items.filter(x=>x.meal_id===id);
  let photo="";if(m.photo_path){const q=await db.storage.from("meal-photos").createSignedUrl(m.photo_path,1800);if(q.data?.signedUrl)photo=`<img class="mh-photo" src="${esc(q.data.signedUrl)}" alt="餐點照片">`;}
  const dt=new Date(new Date(m.eaten_at).getTime()-new Date(m.eaten_at).getTimezoneOffset()*60000).toISOString().slice(0,16);
  editor.innerHTML=`<div class="mh-editor"><div class="mh-head"><h3>編輯餐點</h3><button id="mhClose" type="button" class="mh-secondary">關閉</button></div>${photo}<form id="mhForm"><label>餐別<select name="meal_type">${Object.entries(labels).map(([v,l])=>`<option value="${v}" ${m.meal_type===v?"selected":""}>${l}</option>`).join("")}</select></label><label>日期時間<input name="eaten_at" type="datetime-local" required value="${dt}"></label><label>備註<input name="notes" value="${esc(m.notes||"")}"></label><div id="mhItems">${its.map(row).join("")}</div><button type="button" id="mhAdd" class="mh-secondary">＋ 新增食物</button><button type="submit">儲存修改</button><button type="button" id="mhDelete" class="mh-danger">刪除整筆餐點</button></form></div>`;
  editor.querySelector("#mhClose").onclick=()=>editor.innerHTML="";
  const box=editor.querySelector("#mhItems");editor.querySelector("#mhAdd").onclick=()=>box.insertAdjacentHTML("beforeend",row());
  box.onclick=e=>{if(e.target.classList.contains("mh-remove"))e.target.closest(".mh-item").remove();};
  editor.querySelector("#mhForm").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),when=new Date(f.get("eaten_at"));if(isNaN(when))return alert("日期時間格式錯誤");
   let q=await db.from("meals").update({meal_type:f.get("meal_type"),eaten_at:when.toISOString(),notes:f.get("notes")||null}).eq("id",id).eq("user_id",uid);if(q.error)return alert(q.error.message);
   const els=[...box.querySelectorAll(".mh-item")],keep=els.map(x=>x.dataset.id).filter(Boolean),remove=its.map(x=>x.id).filter(x=>!keep.includes(x));
   if(remove.length){q=await db.from("meal_items").delete().eq("user_id",uid).in("id",remove);if(q.error)return alert(q.error.message);}
   for(const el of els){const get=k=>el.querySelector(`[data-field="${k}"]`).value;const payload={food_name:get("food_name").trim(),quantity:get("quantity").trim()||null,calories:n(get("calories")),protein_g:n(get("protein_g")),carbs_g:n(get("carbs_g")),fat_g:n(get("fat_g"))};if(!payload.food_name)return alert("食物名稱不可空白");q=el.dataset.id?await db.from("meal_items").update(payload).eq("id",el.dataset.id).eq("meal_id",id).eq("user_id",uid):await db.from("meal_items").insert({...payload,meal_id:id,user_id:uid});if(q.error)return alert(q.error.message);}
   alert("餐點已更新");await load();editor.innerHTML="";onSaved();
  };
  editor.querySelector("#mhDelete").onclick=async()=>{if(!confirm("確定刪除整筆餐點及明細？"))return;let q=await db.from("meal_items").delete().eq("meal_id",id).eq("user_id",uid);if(q.error)return alert(q.error.message);q=await db.from("meals").delete().eq("id",id).eq("user_id",uid);if(q.error)return alert(q.error.message);alert("已刪除");editor.innerHTML="";await load();onSaved();};
 }
 date.onchange=load;document.querySelector("#mhReload").onclick=load;load();
}
