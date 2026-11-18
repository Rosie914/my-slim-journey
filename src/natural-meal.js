
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const mealNames = {breakfast:"早餐",lunch:"午餐",dinner:"晚餐",snack:"點心"};

export function renderNaturalMeal() {
 return `<section class="card"><h2>AI 文字飲食記錄</h2>
 <p class="muted">輸入自然語言，例如：今天早餐吃兩片吐司、一杯無糖拿鐵。AI 會拆分食物與營養估算，確認後才會儲存。</p>
 <form id="naturalMealForm">
 <label>飲食日期<input name="date" type="date" value="${new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10)}" required></label>
 <label>描述餐點<textarea name="text" rows="4" required maxlength="2000" placeholder="例如：今天早餐吃兩片吐司、一杯無糖拿鐵，中午吃一個肉包、一顆茶葉蛋"></textarea></label>
 <button id="parseMealButton" type="submit">AI 解析餐點</button></form>
 <p id="parseMealStatus" class="muted" aria-live="polite"></p><div id="parseMealPreview"></div></section>`;
}

export function initNaturalMeal(db, uid, onSaved=()=>{}) {
 const form=$("#naturalMealForm");
 if(!form)return;
 const status=$("#parseMealStatus"), preview=$("#parseMealPreview"), button=$("#parseMealButton");

 form.onsubmit=async e=>{
  e.preventDefault();
  button.disabled=true;
  status.textContent="正在解析食物與營養…";
  preview.innerHTML="";

  try {
   const fd=new FormData(form);
   const date=String(fd.get("date"));
   const text=String(fd.get("text")).trim();

   const {data,error}=await db.functions.invoke("parse-meal-text",{
     body:{text,selectedDate:date}
   });

   if(error)throw error;
   if(!data?.success||!Array.isArray(data.items)||!data.items.length)
     throw new Error(data?.error||"沒有辨識到食物，請補充描述。");

   status.textContent=data.is_future
    ?"這是未來日期，將存為「預計飲食」，不會計入實際攝取。"
    :"解析完成。以下營養為 AI 估算，請逐項核對後儲存。";

   preview.innerHTML=`<form id="parsedMealConfirm">
   ${data.items.map((x,i)=>`<div class="nm-item">
    <h3>食物 ${i+1}</h3>
    <label>餐別<select name="meal_${i}">
    ${Object.entries(mealNames).map(([k,v])=>`<option value="${k}" ${x.meal_type===k?"selected":""}>${v}</option>`).join("")}
    </select></label>
    <label>食物名稱<input name="name_${i}" required value="${esc(x.food_name)}"></label>
    <label>份量<input name="qty_${i}" value="${esc(x.quantity||"")}"></label>
    <div class="nm-grid">
    ${[["calories","熱量 kcal",1],["protein_g","蛋白質 g",0.1],["carbs_g","碳水 g",0.1],["fat_g","脂肪 g",0.1],["fiber_g","纖維 g",0.1],["sugar_g","糖 g",0.1],["sodium_mg","鈉 mg",1]].map(([k,l,step])=>`<label>${l}<input name="${k}_${i}" type="number" min="0" step="${step}" value="${Number(x[k])||0}"></label>`).join("")}
    </div>
    <small>資料來源：AI 估算｜信心：${esc(x.confidence||"未提供")}</small>
    </div>`).join("")}
    <p class="muted">${esc(data.note||"估算值可能與實際份量及品牌標示不同。")}</p>
    <button id="saveParsedMeals" type="submit">確認並儲存飲食</button>
    <button id="cancelParsedMeals" type="button" class="nm-cancel">取消</button>
    </form>`;

   $("#parsedMealConfirm").onsubmit=async ev=>{
    ev.preventDefault();
    const save=$("#saveParsedMeals");
    save.disabled=true;

    try{
     const f=new FormData(ev.currentTarget);
     const grouped={};

     data.items.forEach((x,i)=>{
      const type=f.get("meal_"+i);
      (grouped[type]??=[]).push({
       food_name:String(f.get("name_"+i)).trim(),
       quantity:String(f.get("qty_"+i)||""),
       calories:Number(f.get("calories_"+i)),
       protein_g:Number(f.get("protein_g_"+i)),
       carbs_g:Number(f.get("carbs_g_"+i)),
       fat_g:Number(f.get("fat_g_"+i)),
       fiber_g:Number(f.get("fiber_g_"+i)),
       sugar_g:Number(f.get("sugar_g_"+i)),
       sodium_mg:Number(f.get("sodium_mg_"+i)),
       nutrition_source:"ai_estimate",
       confidence:x.confidence||null
      });
     });

     for(const [type,items] of Object.entries(grouped)){
      if(items.some(x=>!x.food_name||
       Object.entries(x).some(([k,v])=>
        ["calories","protein_g","carbs_g","fat_g","fiber_g","sugar_g","sodium_mg"].includes(k)&&
        (!Number.isFinite(v)||v<0))))
       throw new Error("請確認所有食物名稱及營養數值。");

      const {data:meal,error:me}=await db.from("meals").insert({
       user_id:uid,
       meal_type:type,
       source:data.is_future?"planned":"ai_text",
       eaten_at:new Date(date+"T12:00:00+08:00").toISOString(),
       notes:"AI 文字解析："+text
      }).select().single();

      if(me)throw me;

      const {error:ie}=await db.from("meal_items").insert(
       items.map(x=>({...x,meal_id:meal.id,user_id:uid}))
      );

      if(ie){
       await db.from("meals").delete().eq("id",meal.id).eq("user_id",uid);
       throw ie;
      }
     }

     status.textContent="飲食已儲存。";
     preview.innerHTML="";
     form.reset();
     await onSaved();
    }catch(err){
     save.disabled=false;
     alert("儲存失敗："+err.message);
    }
   };

   $("#cancelParsedMeals").onclick=()=>{
    preview.innerHTML="";
    status.textContent="已取消，尚未儲存。";
   };

  }catch(err){
   status.textContent="解析失敗："+err.message;
  }finally{
   button.disabled=false;
  }
 };
}
