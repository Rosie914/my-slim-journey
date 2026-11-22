// My Slim Journey — 智慧飲食輸入。優先讀取使用者紀錄；不必為了日常份量先問克數。
// 不保存任何 AI 推測為「真實測量」；所有推算均可在儲存前修改。
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const nf = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1 });
const dateTaipei = () => new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Taipei", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date());
const timeTaipei = () => new Intl.DateTimeFormat("en-GB", { timeZone:"Asia/Taipei", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).format(new Date());
const fields = ["calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugar_g", "sodium_mg"];
const labels = { calories:"熱量 kcal", protein_g:"蛋白質 g", carbs_g:"碳水 g", fat_g:"脂肪 g", fiber_g:"纖維 g", sugar_g:"糖 g", sodium_mg:"鈉 mg" };
const mealTypes = { breakfast:"早餐", lunch:"午餐", dinner:"晚餐", snack:"點心", other:"其他" };
const n = value => value === "" || value == null ? null : Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const round = value => Math.round(value * 10) / 10;

// 常見簡單食物的「參考估算」：份量為可食部或標準份，非秤重結果。
// 複雜料理不套用這個表；一律優先使用使用者已確認的同份量紀錄。
const basics = [
  { key:"香蕉", units:["根"], portionG:100, kcal:89, p:1.1, c:22.8, f:.3 },
  { key:"水煮蛋", units:["顆","個"], portionG:50, kcal:145, p:12.6, c:1.1, f:9.5 },
  { key:"雞蛋", units:["顆","個"], portionG:50, kcal:143, p:12.6, c:.7, f:9.5 },
  { key:"蘋果", units:["顆","個"], portionG:160, kcal:52, p:.3, c:13.8, f:.2 },
  { key:"白飯", units:["碗"], portionG:150, kcal:130, p:2.7, c:28.2, f:.3 },
  { key:"地瓜", units:["條"], portionG:150, kcal:86, p:1.6, c:20.1, f:.1 }
];
const counts = {"半":.5,"半個":.5,"半根":.5,"半顆":.5,"半條":.5,"半碗":.5,"1/2":.5,"½":.5,"一":1,"1":1,"一個":1,"一顆":1,"一根":1,"一條":1,"一碗":1,"兩":2,"二":2,"2":2,"三":3,"3":3,"四分之一":.25,"1/4":.25};
const clean = text => String(text || "").trim().replace(/^(?:今天|昨天|早上|中午|晚上|宵夜|早餐|午餐|晚餐|點心|吃了|我吃了|吃|食用|大約|約)+\s*/g, "").replace(/\s+/g, "");
function commonPortion(segment) {
  const s = clean(segment);
  for (const spec of basics) {
    if (!s.endsWith(spec.key)) continue;
    const prefix = s.slice(0, -spec.key.length);
    const match = prefix.match(/^(四分之一|1\/4|1\/2|½|半|一|兩|二|三|1|2|3)?(小)?(根|顆|個|碗|條)$/);
    if (!match || !spec.units.includes(match[3])) continue;
    const factor = counts[match[1] || "一"] ?? 1;
    const sizeFactor = match[2] === "小" ? .7 : 1;
    const grams = round(spec.portionG * factor * sizeFactor);
    const multiplier = grams / 100;
    return {
      food_name:spec.key, quantity:prefix || `一${match[3]}`, serving_weight_g:grams,
      calories:round(spec.kcal * multiplier), protein_g:round(spec.p * multiplier),
      carbs_g:round(spec.c * multiplier), fat_g:round(spec.f * multiplier),
      fiber_g:null, sugar_g:null, sodium_mg:null,
      nutrition_source:"ai_estimate", confidence:"medium", _from:"常見份量參考（非實測）"
    };
  }
  return null;
}
function splitFoods(text) {
  return String(text || "").split(/[，,、；;\n]+|\s+和\s+/).map(clean).filter(Boolean).slice(0, 12);
}
function cloneRecord(item, from) {
  return {
    food_name:String(item.food_name || ""), quantity:item.quantity || item.serving_label || "",
    serving_weight_g:n(item.serving_weight_g),
    ...Object.fromEntries(fields.map(key => [key, n(item[key])])),
    nutrition_source:item.nutrition_source || (from === "常吃食物" ? "favorite" : "manual"),
    confidence:item.confidence || "medium", _from:from
  };
}
function identifyMemory(segment, memory) {
  const s = clean(segment).toLowerCase();
  for (const record of memory) {
    const name = clean(record.food_name).toLowerCase();
    const portion = clean(record.quantity || record.serving_label || "").toLowerCase();
    if (!name) continue;
    // 必須份量也匹配，避免把「一根」的熱量誤套用到「半根」。
    if (s === (portion + name) || s === (name + portion) || (!portion && s === name)) {
      if (n(record.calories) !== null) return cloneRecord(record, record._memoryFrom);
    }
  }
  return null;
}
function localInterpret(text, memory) {
  const segments = splitFoods(text);
  if (!segments.length) return [];
  const results = segments.map(segment => identifyMemory(segment, memory) || commonPortion(segment));
  return results.every(Boolean) ? results : null;
}
// 桌菜共食的份量依據只用來輔助 AI 判斷本人吃多少，不對營養數值重複除以人數。
const sharedNumbers = {"一":1,"二":2,"兩":2,"三":3,"四":4,"五":5,"六":6,"七":7,"八":8,"九":9,"十":10};
function sharingContext(text, settings = null) {
  const raw = String(text || "");
  if (settings?.enabled) {
    const count = Number(settings.count);
    if (!Number.isInteger(count) || count < 2 || count > 12) return null;
    const mode = settings.mode === "actual" ? "actual" : "average";
    return {count, mode, explicit:true, instruction:sharedInstruction(count, mode)};
  }
  // 若使用者直接輸入「四人桌菜／4個人共食」，不必額外切換設定。
  const hint = raw.match(/(?:^|[\s，、：:；;])(?:我們|跟朋友|全家|這桌)?\s*([一二兩三四五六七八九十]|\d{1,2})\s*(?:個)?(?:人|位)(?:一起|共食|分食|吃|份|桌菜|合菜|聚餐)?/);
  const wantsShare = /(?:桌菜|合菜|共食|分食|一起吃|多人|分成.+人份|大家(?:一起)?吃|分菜|分給|用餐)/.test(raw);
  const portions = raw.match(/(?:分成|分為|分作|平均分(?:成)?|總共|一共|共做|做了|煮了)\s*([一二兩三四五六七八九十]|\d{1,2})\s*份/);
  const count = hint ? (sharedNumbers[hint[1]] ?? Number(hint[1])) : portions ? (sharedNumbers[portions[1]] ?? Number(portions[1])) : null;
  if (!wantsShare && !portions && !(hint && /(?:人|位)(?:吃|份|桌菜|合菜|用餐)/.test(raw))) return null;
  if (!(count >= 2 && count <= 12)) {
    return {count:null, mode:"actual", explicit:false,
      instruction:"【共食提示】這是桌菜／多人共食。只估算使用者本人吃到的食物；未指明人數或本人份量時請標示不確定性，絕對不可把整桌份量當成一人食用。"};
  }
  const explicitActual = /(?:我(?:只)?吃|我夾|我分到|我自己|自己吃|吃了.{0,12}(?:口|筷|碗|片|塊)|實際吃)/.test(raw);
  const mode = explicitActual ? "actual" : "average";
  return {count, mode, explicit:false, instruction:sharedInstruction(count, mode)};
}
function sharedInstruction(count, mode) {
  const rule = mode === "average"
    ? `若沒說明某道菜自己吃多少，暫按該道菜平均分給 ${count} 人（每人 1/${count}）估算；若有明確的本人份量，優先依本人份量，不可再除以人數。`
    : "依使用者逐道說明的本人食用量估算；不應把整桌的份量直接算給本人，也不要在未指定均分時對每道菜機械地除以人數。";
  return `【多人分食設定】同桌 ${count} 人，${rule} AI 回傳的每一筆 food item 熱量和蛋白質都必須是使用者本人吃到的份量，絕非整盤或整桌總量；保留生活化份量，並在 note 說明估算前提。禁止二次分攤。`;
}
function suggestType(text) {
  if (/早餐|早上/.test(text)) return "breakfast";
  if (/午餐|中午/.test(text)) return "lunch";
  if (/晚餐|晚上/.test(text)) return "dinner";
  const hour = Number(timeTaipei().slice(0,2));
  return hour < 11 ? "breakfast" : hour < 16 ? "lunch" : hour < 21 ? "dinner" : "snack";
}
async function compressedPhoto(file) {
  if (!file || !["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(file.type)) {
    throw Error("請選擇 JPG、PNG 或 WebP 照片；HEIC 照片需裝置支援轉檔。");
  }
  if (file.size > 18 * 1024 * 1024) throw Error("圖片超過 18 MB，請改用較小照片。");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(Error("無法讀取照片，請改選 JPG 或 PNG。"));
      element.src = url;
    });
    const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw Error("瀏覽器無法處理照片。請改用文字記錄。");
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .72));
    if (!blob) throw Error("照片壓縮失敗，請改用文字記錄。");
    const converted = new File([blob], "meal.jpg", { type:"image/jpeg" });
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(Error("照片讀取失敗。"));
      reader.readAsDataURL(converted);
    });
    return { file:converted, base64:dataUrl.split(",")[1] };
  } finally { URL.revokeObjectURL(url); }
}
function blankItem(text = "") {
  return { food_name:clean(text).slice(0,100) || "", quantity:"", serving_weight_g:null,
    ...Object.fromEntries(fields.map(key => [key,null])), nutrition_source:"manual", confidence:"low", _from:"待自行補充" };
}

export function mountSmartMeal({ db, uid, getDate, onSaved }) {
  const diary = document.getElementById("mealDiary");
  const overview = diary?.querySelector(".diary-overview");
  if (!overview || overview.querySelector("#msjSmartMeal")) return;
  const host = document.createElement("section");
  host.id = "msjSmartMeal";
  host.className = "msj-smart-meal";
  host.setAttribute("aria-label", "智慧飲食記錄");
  host.innerHTML = `<div class="msj-smart-top"><div><strong>智慧記錄飲食</strong><small>直接描述份量，優先找你的常吃與歷史紀錄</small></div><span aria-hidden="true">✦</span></div>
    <form id="msjSmartForm" novalidate>
      <label class="msj-smart-entry-label" for="msjSmartText">吃了什麼？</label>
      <textarea id="msjSmartText" rows="2" maxlength="2000" placeholder="例如：四人桌菜，我吃清蒸魚 1/4、青菜兩筷、白飯半碗"></textarea>
      <details id="msjSmartSharing" class="msj-smart-sharing">
        <summary><span>🍲 桌菜／多人共食</span><small>選填，也能直接在上方輸入「四個人吃」</small></summary>
        <div class="msj-smart-sharing-fields">
          <label>共食人數<select id="msjSmartDiners" aria-label="共食人數">
            ${Array.from({length:11},(_,i)=>i+2).map(value=>`<option value="${value}" ${value===4?"selected":""}>${value} 人</option>`).join("")}
          </select></label>
          <label>我吃的比例<select id="msjSmartShareMode" aria-label="分食方式">
            <option value="average">大致平均分食（可修改）</option>
            <option value="actual">以我描述的實際份量為準</option>
          </select></label>
        </div>
        <p>例如「四人吃三菜一湯，我只吃魚 1/4、青菜兩筷」。會依每道菜估算你吃的份量，而非整桌總量。</p>
      </details>
      <div class="msj-smart-formtools">
        <label class="msj-smart-photo" for="msjSmartPhoto">📷 拍照或選圖</label>
        <input id="msjSmartPhoto" type="file" accept="image/*" aria-label="拍照或選擇食物照片">
        <span id="msjSmartFile" class="msj-smart-filename" aria-live="polite"></span>
        <button type="submit" id="msjSmartAnalyze">智慧辨識</button>
      </div>
      <p id="msjSmartStatus" role="status" aria-live="polite" class="msj-smart-note">例如「半根香蕉」會先用常見份量估算；有完全相符的紀錄時會優先沿用。</p>
    </form>
    <div id="msjSmartReview" hidden></div>`;
  const heading = overview.querySelector(".diary-title");
  if (heading) heading.insertAdjacentElement("afterend", host);
  else overview.prepend(host);
  const textInput = host.querySelector("#msjSmartText");
  const photoInput = host.querySelector("#msjSmartPhoto");
  const status = host.querySelector("#msjSmartStatus");
  const form = host.querySelector("#msjSmartForm");
  const review = host.querySelector("#msjSmartReview");
  const submit = host.querySelector("#msjSmartAnalyze");
  const sharingUI = host.querySelector("#msjSmartSharing");
  const shareCount = host.querySelector("#msjSmartDiners");
  const shareMode = host.querySelector("#msjSmartShareMode");
  const date = () => getDate?.() || dateTaipei();
  let memory = [], parsed = [], photo = null, origin = "manual", loading = false;
  let currentText = "", reviewDate = null;
  const say = message => { status.textContent = message; };
  const setLoading = value => { loading = value; submit.disabled = value; submit.textContent = value ? "辨識中…" : "智慧辨識"; };

  // 快取僅限本人資料；查詢失敗不阻塞文字輸入和 AI。
  Promise.allSettled([
    db.from("user_favorite_foods").select("food_name,serving_label,serving_weight_g,nutrition_source,calories,protein_g,carbs_g,fat_g,fiber_g,sugar_g,sodium_mg")
      .eq("user_id", uid).order("updated_at", { ascending:false }).limit(150),
    db.from("meals").select("id,eaten_at,meal_items(food_name,quantity,serving_weight_g,nutrition_source,confidence,calories,protein_g,carbs_g,fat_g,fiber_g,sugar_g,sodium_mg)")
      .eq("user_id",uid).order("eaten_at", { ascending:false }).limit(45)
  ]).then(results => {
    if (!host.isConnected) return;
    const [favorites, history] = results;
    if (favorites.status === "fulfilled" && !favorites.value.error) {
      memory.push(...(favorites.value.data || []).map(item => ({...item, _memoryFrom:"常吃食物"})));
    }
    if (history.status === "fulfilled" && !history.value.error) {
      for (const meal of history.value.data || []) {
        memory.push(...(meal.meal_items || []).map(item => ({...item, _memoryFrom:"歷史紀錄"})));
      }
    }
  }).catch(() => {});

  const addButton = diary.querySelector("#diaryAdd");
  if (addButton) {
    addButton.textContent = "＋ 智慧記錄";
    addButton.onclick = () => { textInput.focus(); host.scrollIntoView({ behavior:"smooth", block:"center" }); };
  }
  diary.querySelector('[data-msj-quick="add"] b')?.replaceChildren(document.createTextNode("智慧記錄"));
  const quickHint = diary.querySelector('[data-msj-quick="add"] small');
  if (quickHint) quickHint.textContent = "文字或拍照一站完成";

  photoInput.onchange = () => {
    photo = null;
    const file = photoInput.files?.[0];
    host.querySelector("#msjSmartFile").textContent = file ? `已選：${file.name}` : "";
    if (file) say("照片會先縮小後再辨識；也可以輸入文字補充食材和份量。");
  };
  textInput.addEventListener("input", () => { if (!loading) review.hidden = true; });

  function renderReview(items, note) {
    parsed = items.map(item => ({...item}));
    review.hidden = false;
    review.innerHTML = `<div class="msj-smart-review-head"><strong>請確認這餐的內容</strong><small>直接以「半根／一碗」確認，不必自行猜克數。所有數字都可調整。</small></div>
      <form id="msjSmartConfirm">
        <div class="msj-smart-review-headline"><label>餐別<select name="meal_type">${Object.entries(mealTypes).map(([key,label])=>`<option value="${key}" ${key === suggestType(currentText) ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        <label>用餐時間<input name="meal_time" type="time" value="${timeTaipei()}" required></label></div>
        <div class="msj-smart-items">${items.map((item,i) => `<div class="msj-smart-item" data-smart-index="${i}">
          <div class="msj-smart-item-title"><b>食物 ${i+1}</b><small>${esc(item._from || (origin === "ai_photo" ? "AI 拍照估算" : "AI 文字估算"))}</small></div>
          <label>食物名稱<input data-key="food_name" required value="${esc(item.food_name)}"></label>
          <label>份量（用日常描述就好）<input data-key="quantity" placeholder="例如：半根、一小碗" value="${esc(item.quantity)}"></label>
          <div class="msj-smart-nutrition">${["calories","protein_g"].map(key=>`<label>${labels[key]}<input data-key="${key}" type="number" min="0" step="any" value="${esc(item[key] ?? "")}"></label>`).join("")}</div>
          <details><summary>調整重量與其他營養（選填）</summary>
            <label>估計重量 g（不必填）<input data-key="serving_weight_g" type="number" min="0" step="any" value="${esc(item.serving_weight_g ?? "")}"></label>
            <div class="msj-smart-nutrition">${fields.filter(key=>!["calories","protein_g"].includes(key)).map(key=>`<label>${labels[key]}<input data-key="${key}" type="number" min="0" step="any" value="${esc(item[key] ?? "")}"></label>`).join("")}</div>
          </details>
        </div>`).join("")}</div>
        <p class="msj-smart-review-note">${esc(note)}</p>
        <p class="msj-smart-summary" aria-live="polite"></p>
        <div class="msj-smart-review-actions"><button type="button" data-smart-reedit>返回修改輸入</button><button type="submit" class="msj-smart-save">確認儲存</button></div>
        <p data-save-status class="msj-smart-note" role="status"></p>
      </form>`;
    review.scrollIntoView({ behavior:"smooth", block:"nearest" });
    const reviewForm = review.querySelector("#msjSmartConfirm");
    const getRows = () => [...reviewForm.querySelectorAll(".msj-smart-item")].map(row => {
      const value = key => row.querySelector(`[data-key="${key}"]`)?.value;
      return {
        food_name:String(value("food_name") || "").trim(),
        quantity:String(value("quantity") || "").trim() || null,
        serving_weight_g:n(value("serving_weight_g")),
        ...Object.fromEntries(fields.map(key => [key, n(value(key))])),
        nutrition_source:parsed[Number(row.dataset.smartIndex)]?.nutrition_source || "manual",
        confidence:parsed[Number(row.dataset.smartIndex)]?.confidence || "low"
      };
    });
    const summary = reviewForm.querySelector(".msj-smart-summary");
    const showSummary = () => {
      const items = getRows();
      const total = key => items.every(item => item[key] !== null) ? nf.format(items.reduce((s,item)=>s+item[key],0)) : "資料不完整";
      summary.textContent = `合計熱量 ${total("calories")} kcal · 蛋白質 ${total("protein_g")} g`;
    };
    reviewForm.addEventListener("input", event => {
      // 「半根」改成「一根」時，同步調整常見食物的參考值；不要求填克數。
      if (event.target.dataset.key === "quantity") {
        const row = event.target.closest(".msj-smart-item");
        const original = parsed[Number(row?.dataset.smartIndex)];
        if (row && original?._from?.startsWith("常見份量")) {
          const food = row.querySelector('[data-key="food_name"]').value.trim();
          const next = commonPortion(`${event.target.value}${food}`);
          if (next) {
            for (const key of ["serving_weight_g", ...fields]) {
              const input = row.querySelector(`[data-key="${key}"]`);
              if (input) input.value = next[key] ?? "";
            }
          }
        }
      }
      showSummary();
    });
    showSummary();
    reviewForm.querySelector("[data-smart-reedit]").onclick = () => { review.hidden = true; textInput.focus(); };
    reviewForm.onsubmit = async event => {
      event.preventDefault();
      if (loading) return;
      const saveStatus = reviewForm.querySelector("[data-save-status]");
      const saveButton = reviewForm.querySelector(".msj-smart-save");
      const items = getRows();
      if (items.some(item => !item.food_name)) { saveStatus.textContent = "請先填寫食物名稱。"; return; }
      const when = reviewDate || date();
      const rawTime = reviewForm.elements.meal_time.value;
      if (!/^\d\d:\d\d$/.test(rawTime)) { saveStatus.textContent = "請選擇用餐時間。"; return; }
      const eatenAt = new Date(`${when}T${rawTime}:00+08:00`);
      if (!Number.isFinite(eatenAt.getTime())) { saveStatus.textContent = "日期格式不正確。"; return; }
      saveButton.disabled = true;
      saveStatus.textContent = "儲存餐點中…";
      let photoPath = null;
      try {
        if (photo?.file && origin === "ai_photo") {
          photoPath = `${uid}/${Date.now()}-${crypto.randomUUID()}.jpg`;
          const {error} = await db.storage.from("meal-photos").upload(photoPath, photo.file, {contentType:"image/jpeg"});
          if (error) throw error;
        }
        const source = when > dateTaipei() ? "planned" : origin;
        const {error} = await db.rpc("save_meals_with_items", { p_meals:[{
          meal_type:reviewForm.elements.meal_type.value, source, eaten_at:eatenAt.toISOString(),
          photo_path:photoPath, notes:currentText ? `智慧記錄：${currentText}` : "智慧照片記錄", items
        }] });
        if (error) throw error;
        saveStatus.textContent = "已儲存。";
        await onSaved?.();
      } catch (error) {
        if (photoPath) await db.storage.from("meal-photos").remove([photoPath]).catch(()=>{});
        saveStatus.textContent = `儲存失敗：${error.message || "請稍後重試"}`;
        saveButton.disabled = false;
      }
    };
  }

  form.onsubmit = async event => {
    event.preventDefault();
    if (loading) return;
    const raw = textInput.value.trim();
    const file = photoInput.files?.[0];
    if (!raw && !file) { say("請輸入食物或選擇照片。"); textInput.focus(); return; }
    currentText = raw;
    const share = sharingContext(raw, {enabled:sharingUI.open, count:shareCount.value, mode:shareMode.value});
    reviewDate = date();
    setLoading(true);
    review.hidden = true;
    let fallback = null;
    try {
      if (!file) {
        // 桌菜不走單品簡易份量查表，否則可能把整道菜算成自己吃完。
        const quick = share ? null : localInterpret(raw, memory);
        if (quick?.length) {
          origin = "manual";
          renderReview(quick, "已優先套用你自己的紀錄或常見份量參考；重量是估計值，沒有秤重也能記錄。");
          say("已完成快速辨識，不必等待 AI。");
          return;
        }
        fallback = share
          ? [blankItem(raw || "桌菜（請填寫自己吃到的食物）")]
          : splitFoods(raw).map(segment => identifyMemory(segment,memory) || commonPortion(segment) || blankItem(segment));
      }
      origin = file ? "ai_photo" : "ai_text";
      let payload;
      if (file) {
        say("照片正在壓縮並分析，會保留你的原始輸入供失敗時修正…");
        photo = await compressedPhoto(file);
        payload = { imageBase64:photo.base64, mimeType:"image/jpeg",
          hint:[raw.slice(0,450),share?.instruction].filter(Boolean).join("\n").slice(0,900) };
      } else {
        say("正在比對食物並分析，若服務繁忙會讓你直接修改儲存…");
        payload = { text:[raw.slice(0,1350),share?.instruction].filter(Boolean).join("\n"), selectedDate:reviewDate };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 23000);
      let result, error;
      try {
        ({data:result,error} = await db.functions.invoke(file ? "analyze-food" : "parse-meal-text", {body:payload,signal:controller.signal}));
      } finally { clearTimeout(timer); }
      if (error) throw error;
      if (result?.success === false) throw Error(result?.error || "AI 分析未成功。");
      const items = file ? result?.analysis?.items : result?.items;
      if (!Array.isArray(items) || !items.length) throw Error("AI 未能辨識出食物。");
      const mapped = items.map(item => {
        const known = identifyMemory(`${item.quantity || ""}${item.food_name || ""}`, memory);
        if (known) return known;
        return {...item, _from:"AI 估算（請確認）", nutrition_source:"ai_estimate", confidence:item.confidence || "low"};
      });
      const shareNote = share
        ? `桌菜分食：${share.count ? share.count + " 人" : "人數未指定"} · ${share.mode === "average" ? "未明說的菜色暫以平均分食估算" : "依本人描述估算"}。每項數值應為你吃的份量，請留意取菜比例及烹調用油。`
        : "";
      renderReview(mapped, [shareNote, file ? "照片已縮小後分析；料理用油、食材份量可能有誤差，請確認。" : "AI 營養數值是估算；份量可保留「半根、一小碗」，不必填克數。"].filter(Boolean).join(" "));
      say("辨識完成，確認後儲存。");
    } catch (error) {
      origin = file ? "ai_photo" : "manual";
      const msg = error?.name === "AbortError" || /abort/i.test(error?.message || "") ? "AI 等待超過 23 秒" : (error?.message || "AI 暫時無法使用");
      const recovered = fallback?.length ? fallback : [blankItem(raw)];
      renderReview(recovered, `AI 未完成（${msg}）。${share ? "桌菜無法可靠拆解，請逐項確認自己吃了什麼；" : ""}已保留輸入與可用的資料；缺少的熱量不會填成 0。可直接修改並儲存。`);
      say("AI 暫時失敗，但你不需要重新輸入，請直接確認或補充下方資訊。");
    } finally { setLoading(false); }
  };
}

// 供簡易單元測試使用：不暴露使用者資料。
export const __test = { commonPortion, localInterpret, splitFoods, identifyMemory, sharingContext };
