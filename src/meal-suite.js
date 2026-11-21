const $ = s => document.querySelector(s);
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day = () => dateFormatter.format(new Date());
const num = x => x === '' || x == null ? null : Number(x);
const keys=['calories','protein_g','carbs_g','fat_g','fiber_g','sugar_g','sodium_mg'];
const names=['熱量 kcal','蛋白質 g','碳水 g','脂肪 g','纖維 g','糖 g','鈉 mg'];
const nutritionLabels={calories:'熱量',protein_g:'蛋白質',carbs_g:'碳水',fat_g:'脂肪'};
const types={breakfast:'早餐',lunch:'午餐',dinner:'晚餐',snack:'點心',other:'其他'};
const sourceLabels={ai_estimate:'AI 估算',manual:'手動輸入',favorite:'常吃食物',brand_label:'品牌標示',food_database:'食物資料庫'};
const isoDate = date => new Date(date+'T12:00:00+08:00').toISOString();
const future = date => date > day();
const options=(value='breakfast')=>Object.entries(types).map(([k,v])=>`<option value="${k}" ${k===value?'selected':''}>${v}</option>`).join('');
function numericFields(item, keysToShow) {
  return keysToShow.map(key => {
    const index = keys.indexOf(key);
    return `<label>${names[index]}<input data-n="${key}" type="number" min="0" step="any" value="${esc(item[key])}"></label>`;
  }).join("");
}

function catalogPortion(food, grams) {
  const ids = { calories:1008, protein_g:1003, carbs_g:1005, fat_g:1004, fiber_g:1079, sugar_g:2000, sodium_mg:1093 };
  const item = {food_name:food.description, serving_weight_g:grams, quantity:grams + " g", nutrition_source:"food_database", confidence:"high"};
  for (const [key, id] of Object.entries(ids)) {
    const value = food.foodNutrients?.find(n => n.nutrientId === id)?.value;
    item[key] = Number.isFinite(value) ? Math.round(value * grams / 100 * 100) / 100 : null;
  }
  return item;
}

function brandedPortion(food, amount) {
  const factor = amount / 100;
  const nutrients = food.nutrients || {};
  const map = {calories:"calories", protein_g:"protein_g", carbs_g:"carbs_g", fat_g:"fat_g",
    fiber_g:"fiber_g", sugar_g:"sugar_g", sodium_mg:"sodium_g"};
  const item = {
    food_name: [food.brand, food.name].filter(Boolean).join(" · "),
    quantity: `${amount} ${food.unit}`,
    serving_weight_g: food.unit === "g" ? amount : null,
    nutrition_source: "food_database",
    confidence: "medium"
  };
  for (const [key, nutrient] of Object.entries(map)) {
    const value = nutrients[nutrient];
    item[key] = Number.isFinite(value) ? Math.round(value * factor * (key === "sodium_mg" ? 1000 : 1) * 100) / 100 : null;
  }
  return item;
}

function splitRecipe(items, total, eaten) {
  if (![total, eaten].every(n => Number.isFinite(n) && n > 0) || eaten > total) {
    throw Error("請輸入大於零的份數，食用份數不能超過總份數。");
  }
  return items.map(item => {
    const part = { ...item };
    for (const field of ["serving_weight_g", ...keys]) {
      if (item[field] != null) part[field] = Math.round(item[field] * (eaten / total) * 100) / 100;
    }
    const unit = item.quantity?.endsWith(" ml") ? "ml" : "g";
    const originalAmount = Number.parseFloat(item.quantity);
    const amount = unit === "ml" ? originalAmount * eaten / total : part.serving_weight_g;
    if (Number.isFinite(amount)) part.quantity = `${Math.round(amount * 100) / 100} ${unit}`;
    return part;
  });
}

function itemForm(item = {}, index = 0, chooseType = false) {
  const source = item.nutrition_source || "manual";
  const missing = Object.entries(nutritionLabels).filter(([key]) => item[key] == null || item[key] === "").map(([, label]) => label);
  return `<div class="ms-item" data-original-index="${index}" data-source="${esc(source)}">
    <div class="ms-row"><b>食物</b><button type="button" class="ms-remove diary-link">移除</button></div>
    ${chooseType ? `<label>餐別<select data-n="meal_type">${options(item.meal_type)}</select></label>` : ""}
    <label>食物名稱<input data-n="food_name" required value="${esc(item.food_name)}"></label>
    <label>份量（選填）<input data-n="quantity" value="${esc(item.quantity)}"></label>
    <p class="ms-nutrition-status" data-nutrition-status>營養來源：${esc(sourceLabels[source] || "未標示")}${source === "ai_estimate" ? " · 請核對估算數值" : ""}${missing.length ? " · 待補 " + missing.join("、") : ""}</p>
    <div class="ms-grid">${numericFields(item, keys.slice(0, 4))}</div>
    <details><summary>更多營養欄位</summary>
      <label>重量 g（選填）<input data-n="serving_weight_g" type="number" min="0" step="any" value="${esc(item.serving_weight_g)}"></label>
      <div class="ms-grid">${numericFields(item, keys.slice(4))}</div>
    </details>
  </div>`;
}
function updateNutritionStatus(row) {
  const missing = Object.entries(nutritionLabels).filter(([key]) =>
    row.querySelector(`[data-n="${key}"]`)?.value === "").map(([, label]) => label);
  const source = row.dataset.source || "manual";
  row.querySelector("[data-nutrition-status]").textContent =
    `營養來源：${sourceLabels[source] || "未標示"}${source === "ai_estimate" ? " · 請核對估算數值" : ""}${missing.length ? " · 待補 " + missing.join("、") : ""}`;
}

function bindNutritionStatus(form) {
  form.addEventListener("input", event => {
    const row = event.target.closest(".ms-item");
    if (!row) return;
    if (["quantity", "serving_weight_g", ...keys].includes(event.target.dataset.n)) {
      row.dataset.source = "manual";
      row.dataset.adjusted = "true";
    }
    updateNutritionStatus(row);
  });
}

function readItem(el, original = {}) {
  const value = key => el.querySelector(`[data-n="${key}"]`)?.value;
  const adjusted = el.dataset.adjusted === "true";
  const item = {
    food_name: (value("food_name") || "").trim(),
    quantity: value("quantity") || null,
    serving_weight_g: num(value("serving_weight_g")),
    nutrition_source: adjusted ? "manual" : el.dataset.source || original.nutrition_source || "manual",
    confidence: adjusted ? "medium" : original.confidence || "medium"
  };
  for (const key of keys) item[key] = num(value(key));
  if (!item.food_name) throw Error("請輸入食物名稱");
  for (const key of [...keys, "serving_weight_g"]) {
    if (item[key] != null && (!Number.isFinite(item[key]) || item[key] < 0)) {
      throw Error("營養與重量不能是負數或無效數字");
    }
  }
  return item;
}
const save=async(db,meals)=>{const {data,error}=await db.rpc('save_meals_with_items',{p_meals:meals});if(error)throw error;return data};

const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit"
});
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});
const number = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1 });
const methodNames = { menu: "新增飲食", text: "AI 文字記錄", photo: "AI 拍照辨識", manual: "手動輸入",
  favorites: "常吃食物", favoriteEdit: "管理常吃食物", edit: "編輯餐點", review: "確認飲食紀錄" };

function suggestedMealType() {
  const hour = Number(timeFormatter.format(new Date()).slice(0, 2));
  if (hour >= 5 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 16) return "lunch";
  if (hour >= 16 && hour < 21) return "dinner";
  return "snack";
}

function shiftDay(value, offset) {
  const date = new Date(value + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function shiftMonth(value, offset) {
  const date = new Date(value + "-01T00:00:00Z");
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

function midnight(value) {
  return new Date(value + "T00:00:00+08:00").toISOString();
}

function visibleDate(value) {
  const [, month, date] = value.split("-");
  return Number(month) + " 月 " + Number(date) + " 日";
}

function calendarGrid(month, selected, today, markers) {
  const first = month + "-01";
  const firstWeekday = new Date(first + "T00:00:00Z").getUTCDay();
  const last = Number(shiftDay(shiftMonth(month, 1) + "-01", -1).slice(-2));
  const labels = weekdayLabels.map(name => `<span class="diary-weekday">${name}</span>`).join("");
  const blanks = '<span aria-hidden="true"></span>'.repeat(firstWeekday);
  const days = Array.from({ length: last }, (_, index) => {
    const date = month + "-" + String(index + 1).padStart(2, "0");
    const marker = markers.get(date);
    const context = [date === today ? "今天" : "", marker === "actual" ? "有飲食紀錄" : marker ? "有預計餐點" : ""]
      .filter(Boolean).join("，");
    return `<button type="button" class="diary-day" data-date="${date}" aria-pressed="${date === selected}"
      aria-label="${date}${context ? "，" + context : ""}" ${date === today ? 'aria-current="date"' : ""}>
      ${index + 1}<span class="diary-date-dot ${marker || ""}" aria-hidden="true"></span></button>`;
  }).join("");
  return labels + blanks + days;
}

function renderDaySummary(meals, selected, goal) {
  const planned = future(selected);
  const visibleMeals = meals.filter(meal => planned ? meal.source === "planned" : meal.source !== "planned");
  const items = visibleMeals.flatMap(meal => meal.meal_items || []);
  const total = key => {
    if (!items.length) return 0;
    const values = items.map(item => item[key] == null || !Number.isFinite(Number(item[key])) ? null : Number(item[key]));
    return values.some(value => value === null) ? null : values.reduce((sum, value) => sum + value, 0);
  };
  const compare = selected === day() && goal?.ready;
  const intake = total("calories");
  const target = Number(goal?.calorieTarget);
  const scale = Math.max(intake ?? 0, target * 1.25);
  const macros = [
    { key: "protein_g", target: goal?.protein, label: "蛋白質", tone: "sage" },
    { key: "carbs_g", target: goal?.carbs, label: "碳水", tone: "lavender" },
    { key: "fat_g", target: goal?.fat, label: "脂肪", tone: "rose" }
  ];
  const missingLabels = [["calories", "熱量"], ...macros.map(({ key, label }) => [key, label])]
    .filter(([key]) => total(key) == null).map(([, label]) => label);
  const incompleteMeals = visibleMeals.map(meal => {
    const mealItems = meal.meal_items || [];
    const missing = Object.keys(nutritionLabels).filter(key => mealItems.some(item =>
      item[key] == null || !Number.isFinite(Number(item[key]))));
    return { meal, missing, foods: mealItems.map(item => item.food_name).filter(Boolean).join("、") };
  }).filter(entry => entry.missing.length);
  return `<div class="diary-calorie-summary">
    <div><small>${planned ? "預計攝取熱量" : "當日攝取熱量"}</small><strong>${intake == null ? "資料不完整" : number.format(intake)}${intake == null ? "" : "<span> kcal</span>"}</strong></div>
    ${compare && target > 0 ? `<small>目標 ${number.format(target)} kcal</small>` : ""}
  </div>
  <div class="diary-macro-list">${macros.map(macro => {
    const actual = total(macro.key);
    const macroTarget = compare && Number(macro.target) > 0 ? Number(macro.target) : null;
    const percent = macroTarget && actual != null ? actual / macroTarget * 100 : 0;
    const barScale = Math.max(125, Math.ceil(percent / 25) * 25);
    const fillWidth = Math.min(percent, 100) * 100 / barScale;
    const extraWidth = Math.max(0, percent - 100) * 100 / barScale;
    return `<div class="diary-macro-row">
      <div><b>${macro.label}</b><span>${actual == null ? "資料不完整" : number.format(actual)}${macroTarget ? ` / ${number.format(macroTarget)}` : ""}${actual == null && macroTarget ? "" : " g"}</span></div>
      ${macroTarget && actual != null ? `<div class="diary-macro-meter ${macro.tone}" role="img" aria-label="${macro.label} ${number.format(actual)} 公克，目標 ${number.format(macroTarget)} 公克，${number.format(percent)}%">
        <span class="diary-macro-fill" style="width:${fillWidth}%"></span>
        ${extraWidth ? `<span class="diary-macro-overflow" style="width:${extraWidth}%"></span>` : ""}
        <i style="left:${10000 / barScale}%" aria-hidden="true"></i>
      </div>` : ""}
    </div>`;
  }).join("")}</div>${missingLabels.length ? `<p class="diary-note">部分食物尚未填寫${missingLabels.join("、")}；未填欄位不會當作 0 計算。</p>` : ""}${incompleteMeals.length ? `<details class="diary-missing-meals"><summary>${incompleteMeals.length} 筆餐點營養資料不完整 · 點選補齊</summary>
    <div>${incompleteMeals.map(({ meal, missing, foods }) => `<button type="button" data-fill-meal="${esc(meal.id)}">
      補齊${types[meal.meal_type] || types.other} · ${esc(foods || "餐點")}<small>缺少${missing.map(key => nutritionLabels[key]).join("、")}</small>
    </button>`).join("")}</div></details>` : ""}${compare && target > 0 && Number.isFinite(target) ? `
    ${intake == null ? "" : `<div class="diary-energy" aria-hidden="true">
      <span style="width:${100 * Math.min(intake, target) / scale}%"></span>
      <span class="diary-energy-extra" style="width:${100 * Math.max(0, intake - target) / scale}%"></span>
      <i style="left:${100 * target / scale}%"></i>
    </div>
    <p class="diary-note">已記錄 ${number.format(100 * intake / target)}% · ${intake > target ? "超出 " + number.format(intake - target) + " kcal" : intake === target ? "剛好達到目標" : "距目標 " + number.format(target - intake) + " kcal"}</p>`}` : ""}`;
}

function renderMeals(meals, canConfirmPlanned = false) {
  const groups = new Map(Object.keys(types).map(type => [type, []]));
  for (const meal of meals) groups.get(Object.hasOwn(types, meal.meal_type) ? meal.meal_type : "other").push(meal);
  const emptyTypes = [];
  const populated = [...groups].flatMap(([type, entries]) => {
    if (!entries.length) {
      emptyTypes.push(type);
      return [];
    }
    const count = entries.reduce((sum, meal) => sum + (meal.meal_items || []).length, 0);
    const allItems = entries.flatMap(meal => meal.meal_items || []);
    const completeCalories = allItems.length > 0 && allItems.every(item => item.calories != null && Number.isFinite(Number(item.calories)));
    const calories = completeCalories
      ? number.format(allItems.reduce((sum, item) => sum + Number(item.calories), 0)) + " kcal"
      : "熱量資料不完整";
    return `<article class="diary-meal-group"><div class="diary-meal-heading">
      <div><h3>${types[type]}</h3><small>${count} 項 · ${calories}</small></div>
      <button type="button" class="diary-icon" data-add-type="${type}" aria-label="新增${types[type]}">＋</button>
    </div>
    <details><summary>查看明細</summary>${entries.map(meal => {
      const items = meal.meal_items || [];
      const foods = items.map(item => `${item.food_name || "食物"}${item.quantity ? " · " + item.quantity : ""}`).join("、");
      const completeCalories = items.length > 0 && items.every(item => item.calories != null && Number.isFinite(Number(item.calories)));
      const mealCalories = completeCalories
        ? number.format(items.reduce((sum, item) => sum + Number(item.calories), 0)) + " kcal"
        : "熱量資料不完整";
      const missingNutrition = Object.keys(nutritionLabels).filter(key => items.some(item =>
        item[key] == null || !Number.isFinite(Number(item[key]))));
      const mealTime = timeFormatter.format(new Date(meal.eaten_at));
      return `<div class="diary-entry">
        <span class="diary-entry-content"><b>${esc(mealTime)} · ${esc(foods || "餐點")}</b>
          <small>${meal.source === "planned" ? "預計" : "已記錄"} · ${missingNutrition.length ? "待補 " + missingNutrition.map(key => nutritionLabels[key]).join("、") : mealCalories}</small></span>
        <details class="diary-entry-menu"><summary aria-label="餐點選項">⋯</summary>
          <button type="button" data-meal-action="edit" data-id="${esc(meal.id)}">${missingNutrition.length ? "補齊營養" : "編輯"}</button>
          ${canConfirmPlanned && meal.source === "planned" ? `<button type="button" data-meal-action="consume" data-id="${esc(meal.id)}">標記已吃</button>` : ""}
          <button type="button" data-meal-action="favorite" data-id="${esc(meal.id)}">加入常吃食物</button>
          <button type="button" data-meal-action="copy" data-id="${esc(meal.id)}">複製到指定日期</button>
          <button type="button" data-meal-action="delete" data-id="${esc(meal.id)}">刪除</button>
        </details></div>`;
    }).join("")}</details></article>`;
  });
  return populated.join("") + (emptyTypes.length ? `<div class="diary-empty-meals" aria-label="新增其他餐別">
    <small>${populated.length ? "快速新增其他餐別" : "尚無飲食紀錄，選擇餐別開始記錄"}</small>
    <div>${emptyTypes.map(type => `<button type="button" data-add-type="${type}">＋ ${types[type]}</button>`).join("")}</div>
  </div>` : "");
}

export function renderMealSuite() {
  return `<main class="diary" id="mealDiary">
    <section class="card diary-calendar">
      <div class="diary-calendar-toolbar">
        <button type="button" id="diaryPrevious" class="diary-icon" aria-label="上一個月">‹</button>
        <button type="button" id="diaryCalendarToggle" class="diary-month" aria-expanded="true" aria-controls="diaryCalendarGrid"></button>
        <button type="button" id="diaryNext" class="diary-icon" aria-label="下一個月">›</button>
      </div>
      <div id="diaryCalendarGrid" class="diary-calendar-grid" aria-label="選擇飲食日期；使用方向鍵切換日期"></div>
      <div class="diary-calendar-footer">
        <span id="diarySelected" aria-live="polite"></span>
        <button type="button" id="diaryToday" class="diary-link">回到今天</button>
      </div>
      <p id="diaryLegend" class="diary-note">● 已記錄　<span>◇ 預計餐點</span></p>
    </section>
    <section class="card diary-overview">
      <div class="diary-title"><h2 id="diarySummaryTitle">當日飲食</h2><button type="button" id="diaryAdd">＋ 新增飲食</button></div>
      <p id="diaryMessage" class="diary-note" role="status" hidden></p>
      <div id="diaryCopy" hidden></div>
      <div id="diarySummary"></div>
      <div id="diaryMeals"></div>
      <details><summary>複製餐點</summary>
        <button type="button" id="diaryCopyRecent" class="diary-link">複製最近一餐</button>
        <button type="button" id="diaryCopyYesterday" class="diary-link" hidden>選取前一天餐點</button>
      </details>
    </section>
    <dialog id="diaryDialog" aria-labelledby="diaryDialogTitle">
      <div class="diary-dialog-head">
        <div><h2 id="diaryDialogTitle"></h2><p id="diaryDialogDate" class="diary-note"></p></div>
        <button type="button" id="diaryClose" class="diary-icon" aria-label="關閉">×</button>
      </div>
      <div id="diaryDialogBody"></div>
    </dialog>
  </main>`;
}

function addFields(entries = [], type = "breakfast") {
  const items = entries.length ? entries : [{}];
  return `<label>餐別<select name="meal_type">${options(type)}</select></label>
    <label>時間<input name="meal_time" type="time" value="${timeFormatter.format(new Date())}" required></label>
    <div data-items>${items.map((item, index) => itemForm(item, index)).join("")}</div>
    <button type="button" data-add-item class="diary-link">＋ 新增食物</button>`;
}

function editItemFields(form, originals) {
  const root = form.querySelector("[data-items]");
  bindNutritionStatus(form);
  form.querySelector("[data-add-item]").onclick = () => {
    root.insertAdjacentHTML("beforeend", itemForm({}, -1));
  };
  root.onclick = event => {
    if (event.target.closest(".ms-remove") && root.children.length > 1) event.target.closest(".ms-item").remove();
  };
  return () => [...root.children].map(element => readItem(element, originals[Number(element.dataset.originalIndex)]));
}

function favoriteFields(item={}) {
  const field = (key, label, attrs="") => `<label>${label}<input name="${key}" value="${esc(item[key])}" ${attrs}></label>`;
  return `${field("food_name", "名稱", "required")}${field("brand", "品牌（選填）")}
    ${field("serving_label", "份量（選填）")}${field("serving_weight_g", "重量 g（選填）", 'type="number" min="0" step="0.1"')}
    <div class="ms-grid">${keys.map((key, i) => field(key, names[i], 'type="number" min="0" step="0.1"')).join("")}</div>`;
}

async function mealRows(query) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await query.range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < 500) return rows;
  }
}

export function initMealSuite(db, uid, config = {}) {
  const diary = $("#mealDiary");
  if (!diary) return;
  const get = id => diary.querySelector("#" + id);
  const grid = get("diaryCalendarGrid");
  const calendarToggle = get("diaryCalendarToggle");
  const dialog = get("diaryDialog");
  const body = get("diaryDialogBody");
  const banner = get("diaryMessage");
  let selected = config.selectedDate || day();
  let month = selected.slice(0, 7);
  let calendarOpen = true;
  let markers = new Map(), meals = [], clipboard = null;
  let photoPreviewUrl = null;
  let dateRequest = 0, markerRequest = 0;
  let busy = false;

  function showMessage(message) {
    banner.hidden = !message;
    banner.textContent = message;
  }

  function drawCalendar() {
    const [year, monthNumber] = month.split("-");
    calendarToggle.textContent = calendarOpen ? `${year} 年 ${Number(monthNumber)} 月 ▾` : `${visibleDate(selected)} ▸`;
    calendarToggle.setAttribute("aria-expanded", String(calendarOpen));
    grid.hidden = !calendarOpen;
    get("diaryLegend").hidden = !calendarOpen;
    get("diaryToday").hidden = selected === day();
    if (calendarOpen) grid.innerHTML = calendarGrid(month, selected, day(), markers);
    get("diarySelected").textContent = visibleDate(selected) + (future(selected) ? " · 預計飲食" : "");
  }

  async function loadMarkers() {
    const version = ++markerRequest;
    const visibleMonth = month;
    try {
      const rows = await mealRows(db.from("meals").select("eaten_at,source").eq("user_id", uid)
        .gte("eaten_at", midnight(visibleMonth + "-01")).lt("eaten_at", midnight(shiftMonth(visibleMonth, 1) + "-01"))
        .order("eaten_at").order("id"));
      if (version !== markerRequest || !diary.isConnected) return;
      markers = new Map();
      for (const row of rows) {
        const date = dateFormatter.format(new Date(row.eaten_at));
        if (row.source !== "planned") markers.set(date, "actual");
        else if (!markers.has(date)) markers.set(date, "planned");
      }
      // Keep focus on the selected day when markers arrive.
      const focusDate = grid.contains(document.activeElement) ? document.activeElement.dataset.date : null;
      drawCalendar();
      if (focusDate) grid.querySelector('[data-date="' + focusDate + '"]')?.focus();
    } catch {
      if (version === markerRequest && diary.isConnected) drawCalendar();
    }
  }

  async function loadDay() {
    const version = ++dateRequest;
    const date = selected;
    get("diarySummaryTitle").textContent = future(date) ? "預計飲食" : "當日飲食";
    get("diarySummary").innerHTML = "";
    get("diaryCopyYesterday").hidden = true;
    get("diaryMeals").innerHTML = '<p class="diary-note" role="status">載入餐點中…</p>';
    try {
      const rows = await mealRows(db.from("meals").select("id,meal_type,source,eaten_at,notes,photo_path,meal_items(*)")
        .eq("user_id", uid).gte("eaten_at", midnight(date)).lt("eaten_at", midnight(shiftDay(date, 1)))
        .order("eaten_at").order("id"));
      if (version !== dateRequest || !diary.isConnected) return;
      meals = future(date)
        ? rows.filter(meal => meal.source === "planned")
        : date === day()
          ? rows
          : rows.filter(meal => meal.source !== "planned");
      get("diaryCopyYesterday").hidden = future(date);
      get("diaryMeals").innerHTML = renderMeals(meals, date === day());
      get("diarySummary").innerHTML = renderDaySummary(meals, date);
      if (date === day() && config.goal) {
        const goal = await Promise.resolve(config.goal).catch(() => null);
        if (version === dateRequest && diary.isConnected) get("diarySummary").innerHTML = renderDaySummary(rows, date, goal);
      }
    } catch {
      if (version === dateRequest && diary.isConnected) {
        meals = [];
        get("diaryMeals").innerHTML = '<p class="diary-note">無法載入當日紀錄。<button type="button" class="diary-link" data-retry>重試</button></p>';
      }
    }
  }

  function selectDate(date, collapseCalendar = false) {
    if (busy) return;
    selected = date;
    if (collapseCalendar) calendarOpen = false;
    config.onDateChange?.(date);
    const newMonth = date.slice(0, 7);
    if (month !== newMonth) {
      month = newMonth;
      markers = new Map();
      void loadMarkers();
    }
    showMessage("");
    drawCalendar();
    void loadDay();
    drawCopy();
  }

  function moveMonth(offset) {
    if (busy) return;
    month = shiftMonth(month, offset);
    markers = new Map();
    calendarOpen = true;
    drawCalendar();
    void loadMarkers();
  }

  function refresh(message) {
    showMessage(message);
    void loadDay();
    void loadMarkers();
  }

  function setBusy(value) {
    busy = value;
    get("diaryClose").disabled = value;
    const submit = body.querySelector('button[type="submit"]');
    if (submit) submit.disabled = value;
  }

  function clearPhotoPreview() {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    photoPreviewUrl = null;
  }

  function openView(view, markup, date = selected) {
    clearPhotoPreview();
    get("diaryDialogTitle").textContent = view === "history" ? "搜尋吃過的食物" : view === "copyReview" ? "確認複製餐點" : methodNames[view];
    get("diaryDialogDate").textContent = visibleDate(date) + (future(date) ? " · 預計飲食" : "");
    body.innerHTML = markup;
    dialog.scrollTop = 0;
    if (!dialog.open) dialog.showModal();
    else body.querySelector("input:not([type=hidden]), textarea, button, select")?.focus();
  }

  function formStatus(message) {
    const status = body.querySelector("[data-status]");
    if (status) status.textContent = message;
  }

  function bindForm(action) {
    const form = body.querySelector("form");
    form.onsubmit = async event => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      formStatus("");
      try {
        await action(new FormData(form));
      } catch (error) {
        formStatus(error.message || "操作失敗，請重試。");
      } finally {
        setBusy(false);
      }
    };
    return form;
  }

  function sourceFor(date, source) {
    return future(date) ? "planned" : source;
  }

  function openMenu(type = "") {
    openView("menu", `<div class="diary-methods">
      ${["text", "photo", "manual"].map(view => `<button type="button" data-method="${view}">${methodNames[view]} <span aria-hidden="true">›</span></button>`).join("")}
    </div>`);
    body.querySelectorAll("[data-method]").forEach(button => {
      button.onclick = () => {
        const view = button.dataset.method;
        if (view === "manual") openManualSources(type);
        else openAI(view, type);
      };
    });
  }

  function openManualSources(type) {
    openView("manual", `<div class="diary-methods">
      <button type="button" data-source="blank">直接填寫</button>
      <button type="button" data-source="catalog">搜尋食物資料庫</button>
      <button type="button" data-source="history">搜尋吃過的食物</button>
      <button type="button" data-source="favorites">常吃食物</button>
      <button type="button" data-source="back" class="diary-link">返回記錄方式</button>
    </div>`);
    const actions = {
      blank: () => openManual(type), catalog: () => openCatalog(type),
      history: () => openFoodHistory(type), favorites: () => openFavorites(type),
      back: () => openMenu(type)
    };
    body.querySelectorAll("[data-source]").forEach(button => {
      button.onclick = actions[button.dataset.source];
    });
  }

  function openCatalog(type) {
    openView("manual", `<form><label>搜尋範圍<select name="catalog">
        <option value="brand">市售包裝食品（Open Food Facts）</option>
        <option value="ingredient">一般食材（USDA）</option>
      </select></label><label>食物名稱或條碼<input name="query" type="search" placeholder="例如：牛奶、燕麥、商品條碼" required></label>
      <button type="submit">搜尋食物</button></form>
      <div data-results role="status"></div><section data-basket hidden></section>`);
    get("diaryDialogTitle").textContent = "搜尋食物資料庫";
    const form = body.querySelector("form");
    const results = body.querySelector("[data-results]");
    const basket = body.querySelector("[data-basket]");
    const portions = [];
    function drawBasket() {
      const total = basket.querySelector("[data-servings]")?.value ?? "1";
      const eaten = basket.querySelector("[data-eaten]")?.value ?? "1";
      const expanded = basket.querySelector("details")?.open;
      basket.hidden = portions.length === 0;
      basket.innerHTML = `<h3>這一餐的食物</h3>${portions.map((item, i) =>
        `<div class="diary-entry"><label>${esc(item.label)}（${esc(item.unit)}）<input data-grams="${i}" type="number" min="0.1" step="any" value="${esc(item.grams)}"></label>
        <button type="button" class="diary-link" aria-label="移除 ${esc(item.label)}" data-remove="${i}">移除</button></div>`
      ).join("")}<details ${expanded ? "open" : ""}><summary>自煮分裝（等份）</summary>
        <label>整鍋共幾份<input data-servings type="number" step="any" min="0.01" value="${esc(total)}"></label>
        <label>這餐吃幾份<input data-eaten type="number" step="any" min="0.01" value="${esc(eaten)}"></label>
      </details><p data-split-status role="status"></p><button type="button" data-review>確認 ${portions.length} 項食材與餐別</button>`;
      updatePreview();
    }
    function selectedPortions() {
      const items = portions.map(({food, grams, kind}) => {
        if (!Number.isFinite(Number(grams)) || Number(grams) < 0.1) throw Error("每項食物請填至少 0.1 g／mL。");
        return kind === "brand" ? brandedPortion(food, Number(grams)) : catalogPortion(food, Number(grams));
      });
      return splitRecipe(items, Number(basket.querySelector("[data-servings]").value), Number(basket.querySelector("[data-eaten]").value));
    }
    function updatePreview() {
      const status = basket.querySelector("[data-split-status]");
      const review = basket.querySelector("[data-review]");
      try {
        const items = selectedPortions();
        const total = (field, unit) => items.some(item => item[field] == null) ? "資料不完整" :
          number.format(items.reduce((sum, item) => sum + item[field], 0)) + " " + unit;
        status.textContent = `我的這一份 · 熱量 ${total("calories", "kcal")} · 蛋白質 ${total("protein_g", "g")}`;
        review.disabled = !items.length;
      } catch (error) {
        status.textContent = error.message;
        review.disabled = true;
      }
    }
    basket.oninput = event => {
      if (event.target.hasAttribute("data-grams")) portions[Number(event.target.dataset.grams)].grams = event.target.value;
      updatePreview();
    };
    basket.onclick = event => {
      const remove = event.target.closest("[data-remove]");
      if (remove) {
        portions.splice(Number(remove.dataset.remove), 1);
        drawBasket();
      } else if (event.target.closest("[data-review]") && portions.length) {
        try {
          openManual(type, selectedPortions());
        } catch (error) {
          basket.querySelector("details").open = true;
          basket.querySelector("[data-split-status]").textContent = error.message;
        }
      }
    };
    const aliases = { 雞蛋:"egg", 蛋:"egg", 雞腿:"chicken thigh", 雞胸:"chicken breast", 白飯:"white rice cooked", 地瓜:"sweet potato", 豆腐:"tofu", 牛奶:"milk", 香蕉:"banana", 花椰菜:"broccoli", 鮭魚:"salmon", 燕麥:"oats", 吐司:"bread", 杏仁:"almonds" };
    let revision = 0;
    form.elements.catalog.onchange = () => {
      revision++;
      results.textContent = "";
      form.elements.query.placeholder = form.elements.catalog.value === "brand"
        ? "例如：牛奶、燕麥、商品條碼" : "例如：雞蛋、豆腐，或輸入英文";
    };
    form.onsubmit = async event => {
      event.preventDefault();
      const query = form.elements.query.value.trim();
      const kind = form.elements.catalog.value;
      if (!query) return;
      if (kind === "brand" && query.length < 2 && !/^\d{8,14}$/.test(query)) {
        results.textContent = "請輸入至少兩個字，或完整商品條碼。";
        return;
      }
      const request = ++revision;
      results.textContent = "搜尋中…";
      try {
        let foods;
        if (kind === "brand") {
          const { data, error } = await db.functions.invoke("search-branded-foods", { body: { query } });
          if (error) throw Error("商品搜尋暫時無法使用，請確認 search-branded-foods 已部署，或改查一般食材。");
          if (data?.error) throw Error(data.error);
          foods = data?.products || [];
        } else {
          const alias = Object.entries(aliases).find(([name]) => query.includes(name))?.[1];
          const params = new URLSearchParams({ query: alias || query, dataType:"SR Legacy", pageSize:"12", api_key:"DEMO_KEY" });
          const response = await fetch("https://api.nal.usda.gov/fdc/v1/foods/search?" + params, {referrerPolicy:"no-referrer"});
          if (!response.ok) throw Error(response.status === 429 ? "查詢已達上限，請稍後再試。" : "資料庫目前無法連線。");
          ({ foods = [] } = await response.json());
        }
        if (!results.isConnected || request !== revision) return;
        if (!foods.length) { results.textContent = "查無結果，可改用其他名稱、條碼，或切換搜尋範圍。"; return; }
        const label = food => kind === "brand" ? [food.brand, food.name].filter(Boolean).join(" · ") : food.description;
        results.innerHTML = `<label>搜尋結果<select data-food>${foods.map((food, i) => `<option value="${i}">${esc(label(food))}</option>`).join("")}</select></label>
          <p data-food-detail class="diary-note"></p>
          <form><label>食用量（<span data-unit>g</span>，分裝時填整鍋用量）<input name="grams" type="number" value="100" min="0.1" step="any" required></label><button>加入這一餐</button></form>
          ${kind === "brand" ? '<p class="diary-note">商品資料由 <a href="https://world.openfoodfacts.org/" target="_blank" rel="noopener noreferrer">Open Food Facts</a> 提供（ODbL）。數值可能由社群提供，加入前請對照包裝標示。</p>' : '<p class="diary-note">一般食材資料：USDA FoodData Central。請留意熟重、生重及品種差異。</p>'}`;
        const select = results.querySelector("[data-food]");
        const quantity = results.querySelector('[name="grams"]');
        const showDetail = () => {
          const food = foods[Number(select.value)];
          const unit = kind === "brand" ? food.unit : "g";
          results.querySelector("[data-unit]").textContent = unit;
          quantity.value = kind === "brand" && food.servingAmount > 0 ? food.servingAmount : 100;
          const sample = kind === "brand" ? brandedPortion(food, 100) : catalogPortion(food, 100);
          results.querySelector("[data-food-detail]").textContent = `每 100 ${unit}：熱量 ${sample.calories ?? "未標示"} kcal · 蛋白質 ${sample.protein_g ?? "未標示"} g${kind === "brand" ? ` · 條碼 ${food.code || "未提供"}` : ""}`;
        };
        select.onchange = showDetail;
        showDetail();
        results.querySelector("form").onsubmit = e => {
          e.preventDefault();
          const food = foods[Number(select.value)];
          const grams = Number(e.currentTarget.elements.grams.value);
          if (!Number.isFinite(grams) || grams <= 0) return;
          portions.push({food, grams, kind, label:label(food), unit:kind === "brand" ? food.unit : "g"});
          drawBasket();
          results.textContent = "已加入，可繼續搜尋或確認餐點。";
          form.elements.query.select();
        };
      } catch (error) {
        if (request === revision && results.isConnected) results.textContent = error.message || "無法查詢，請稍後重試。";
      }
    };
  }

  async function recentMeals(cutoff, limit) {
    const { data, error } = await db.from("meals")
      .select("meal_type,source,eaten_at,notes,meal_items!inner(*)")
      .eq("user_id", uid).neq("source", "planned").lt("eaten_at", cutoff)
      .order("eaten_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
    if (error) throw error;
    return data || [];
  }

  async function openFoodHistory(type) {
    openView("history", '<input type="search" aria-label="食物名稱" placeholder="輸入食物名稱"><div data-results role="status">載入食物紀錄中…</div>');
    const input = body.querySelector("input");
    const results = body.querySelector("[data-results]");
    try {
      const rows = await recentMeals(new Date().toISOString(), 100);
      if (!input.isConnected || !dialog.open) return;
      const items = rows.flatMap(meal => meal.meal_items).filter(item => item.food_name?.trim());
      const draw = () => {
        const query = input.value.trim().normalize("NFKC").toLowerCase();
        const seen = new Set();
        const matches = items.filter(item => {
          const name = item.food_name.normalize("NFKC").toLowerCase();
          const signature = JSON.stringify([name, item.quantity, item.serving_weight_g, ...keys.map(key => item[key])]);
          if (!name.includes(query) || seen.has(signature)) return false;
          seen.add(signature);
          return true;
        }).slice(0, 12);
        results.innerHTML = matches.length ? matches.map((item, index) => {
          const serving = [item.quantity, item.serving_weight_g == null ? "" : item.serving_weight_g + " g"].filter(Boolean).join(" · ");
          const protein = item.protein_g == null ? "" : "蛋白質 " + item.protein_g + " g";
          return `<button type="button" class="diary-entry" data-history="${index}">
            <span>${esc(item.food_name)} <small>${esc(serving || "未記錄份量")}</small></span>
            <span>${item.calories == null ? "未記錄熱量" : esc(item.calories) + " kcal"} <small>${esc(protein)}</small></span>
          </button>`;
        }).join("") : "最近 100 筆餐點中沒有符合的食物。";
        results.onclick = event => {
          const index = event.target.closest("[data-history]")?.dataset.history;
          if (index != null) openManual(type, [matches[Number(index)]]);
        };
      };
      input.oninput = draw;
      draw();
    } catch {
      if (results.isConnected) results.textContent = "無法載入食物紀錄，請關閉後重試。";
    }
  }

  function openManual(type, items = []) {
    const date = selected;
    openView("manual", `<form>${addFields(items, type || suggestedMealType())}<div data-meal-preview class="diary-note" aria-live="polite"></div><button type="submit">儲存飲食</button><p data-status role="status"></p></form>`);
    let read;
    const form = bindForm(async data => {
      await save(db, [{ meal_type: data.get("meal_type"), source: sourceFor(date, "manual"),
        eaten_at: new Date(date + "T" + data.get("meal_time") + ":00+08:00").toISOString(), items: read() }]);
      dialog.close();
      refresh("已儲存飲食。");
    });
    read = editItemFields(form, items);
    const preview = form.querySelector("[data-meal-preview]");
    const updatePreview = () => {
      const rows = [...form.querySelectorAll(".ms-item")];
      const values = rows.map(row => Object.fromEntries(keys.map(key => [key, num(row.querySelector(`[data-n="${key}"]`)?.value)])));
      const sum = key => values.some(row => row[key] == null) ? "資料不完整" : number.format(values.reduce((total, row) => total + row[key], 0));
      preview.textContent = `${date} ${form.elements.meal_time.value} · ${types[form.elements.meal_type?.value] || types.other} · 熱量 ${sum("calories")} kcal · 蛋白質 ${sum("protein_g")} g`;
    };
    form.addEventListener("input", updatePreview);
    form.addEventListener("change", updatePreview);
    updatePreview();
  }

  function openAI(view, type) {
    const date = selected;
    const textMode = view === "text";
    const defaultTime = timeFormatter.format(new Date());
    const field = textMode
      ? '<label>吃了什麼？<textarea name="text" required maxlength="2000" rows="4" placeholder="例如：午餐一碗雞肉飯和一杯無糖茶"></textarea></label>'
      : '<label>餐點照片<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required><small class="diary-note">支援 JPG、PNG、WebP，檔案上限 10 MB。</small></label><div data-photo-preview class="diary-photo-preview" aria-live="polite" hidden></div>';
    openView(view, `<form><label>餐別<select name="meal_type">${options(type || suggestedMealType())}</select></label>
      <label>用餐時間<input name="meal_time" type="time" value="${defaultTime}" required></label>
      ${field}<button type="submit">${textMode ? "解析文字" : "辨識照片"}</button><p data-status role="status"></p></form>`);
    const form = bindForm(async data => {
      formStatus("AI 處理中…");
      if (textMode) {
        const text = String(data.get("text")).trim();
        if (!text) throw Error("請輸入飲食內容。");
        const { data: result, error } = await db.functions.invoke("parse-meal-text", { body: { text, selectedDate: date } });
        if (error) throw error;
        if (!result?.success || !result.items?.length) throw Error(result?.error || "未辨識到食物。");
        openReview(result.items, date, "ai_text", data.get("meal_type"), null, "AI 文字解析：" + text, data.get("meal_time"));
        return;
      }
      const file = data.get("photo");
      if (!file?.size || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw Error("請選擇 JPG、PNG 或 WebP 照片。");
      if (file.size > 10 * 1024 * 1024) throw Error("照片不可超過 10 MB。");
      const imageBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(Error("照片讀取失敗。"));
        reader.readAsDataURL(file);
      });
      const { data: result, error } = await db.functions.invoke("analyze-food", { body: { imageBase64, mimeType: file.type } });
      if (error) throw error;
      if (!result?.analysis?.items?.length) throw Error(result?.error || "未辨識到食物。");
      openReview(result.analysis.items, date, "ai_photo", data.get("meal_type"), file, "AI 照片辨識", data.get("meal_time"));
    });
    if (!textMode) {
      const input = form.elements.photo;
      const preview = body.querySelector("[data-photo-preview]");
      input.onchange = () => {
        clearPhotoPreview();
        const file = input.files?.[0];
        preview.hidden = !file;
        if (!file) { preview.replaceChildren(); formStatus(""); return; }
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
          preview.textContent = "檔案格式不支援，請選擇 JPG、PNG 或 WebP。";
          formStatus("請改選 JPG、PNG 或 WebP 照片。");
          return;
        }
        photoPreviewUrl = URL.createObjectURL(file);
        const image = document.createElement("img");
        image.src = photoPreviewUrl;
        image.alt = "所選餐點照片預覽";
        const caption = document.createElement("small");
        caption.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
        preview.replaceChildren(image, caption);
        if (file.size > 10 * 1024 * 1024) {
          formStatus("照片超過 10 MB，請選較小的照片。");
        } else formStatus("");
      };
    }
  }

  function openReview(items, date, source, type, file, notes, mealTime = timeFormatter.format(new Date())) {
    const originals = items.map(item => ({ ...item, nutrition_source: item.nutrition_source || "ai_estimate", confidence: item.confidence || "medium" }));
    openView("review", `<form><p class="diary-note">請核對食物、份量和營養估算。</p>
      <div data-review-items>${originals.map((item, index) => itemForm(item, index, !type)).join("")}</div>
      <p data-review-summary class="diary-note" aria-live="polite"></p>
      <button type="submit">確認並儲存</button><p data-status role="status"></p></form>`, date);
    const form = body.querySelector("form");
    bindNutritionStatus(form);
    const preview = form.querySelector("[data-review-summary]");
    const updateReviewSummary = () => {
      const rows = [...form.querySelector("[data-review-items]").children];
      const totals = Object.fromEntries(["calories", "protein_g"].map(key => {
        const values = rows.map(row => num(row.querySelector(`[data-n="${key}"]`)?.value));
        return [key, values.some(value => value == null) ? null : values.reduce((sum, value) => sum + value, 0)];
      }));
      const mealTypes = new Set(rows.map(row => type || row.querySelector('[data-n="meal_type"]').value));
      const mealLabel = mealTypes.size === 1 ? types[[...mealTypes][0]] : `共 ${mealTypes.size} 個餐別`;
      preview.textContent = `${date} ${mealTime} · ${mealLabel} · 熱量 ${totals.calories == null ? "資料不完整" : number.format(totals.calories) + " kcal"} · 蛋白質 ${totals.protein_g == null ? "資料不完整" : number.format(totals.protein_g) + " g"}`;
    };
    form.addEventListener("input", updateReviewSummary);
    form.addEventListener("change", updateReviewSummary);
    updateReviewSummary();
    bindForm(async () => {
      const grouped = new Map();
      for (const element of form.querySelector("[data-review-items]").children) {
        const mealType = type || element.querySelector('[data-n="meal_type"]').value;
        if (!grouped.has(mealType)) grouped.set(mealType, []);
        grouped.get(mealType).push(readItem(element, originals[Number(element.dataset.originalIndex)]));
      }
      let path = null;
      if (file) {
        const key = `${uid}/${Date.now()}-${crypto.randomUUID()}.${file.type.split("/")[1]}`;
        const { error } = await db.storage.from("meal-photos").upload(key, file, { contentType: file.type });
        if (error) throw error;
        path = key;
      }
      try {
        await save(db, [...grouped].map(([meal_type, foods]) => ({
          meal_type, source: sourceFor(date, source), eaten_at: new Date(date + "T" + mealTime + ":00+08:00").toISOString(), photo_path: path, notes, items: foods
        })));
      } catch (error) {
        if (path) await db.storage.from("meal-photos").remove([path]).catch(() => {});
        throw error;
      }
      dialog.close();
      refresh("已儲存飲食。");
    });
    const root = form.querySelector("[data-review-items]");
    root.onclick = event => {
      if (event.target.closest(".ms-remove") && root.children.length > 1) event.target.closest(".ms-item").remove();
      updateReviewSummary();
    };
  }

  async function openFavorites(type) {
    openView("favorites", '<p class="diary-note" role="status">載入常吃食物…</p>');
    const view = body.firstElementChild;
    try {
      const { data, error } = await db.from("user_favorite_foods").select("*").eq("user_id", uid).order("updated_at", { ascending: false }).limit(100);
      if (error) throw error;
      if (!dialog.open || body.firstElementChild !== view) return;
      const favorites = data || [];
      body.innerHTML = '<div class="diary-title"><input type="search" aria-label="搜尋常吃食物" placeholder="搜尋名稱或品牌"><button type="button" data-favorite-new>＋ 新增</button></div><div data-favorite-list></div>';
      const list = body.querySelector("[data-favorite-list]");
      function draw(query = "") {
        const filtered = favorites.filter(item => (item.food_name + " " + (item.brand || "")).toLocaleLowerCase().includes(query));
        list.innerHTML = filtered.length ? filtered.map(item => `<div class="diary-entry">
          <span>${esc(item.food_name)} <small>${esc(item.serving_label || "")}</small></span>
          <div><button type="button" class="diary-link" data-use="${esc(item.id)}">帶入</button>
          <button type="button" class="diary-link" data-edit="${esc(item.id)}">編輯</button></div></div>`).join("")
          : '<p class="diary-note">沒有符合的常吃食物。</p>';
      }
      draw();
      body.querySelector("input").oninput = event => draw(event.target.value.trim().toLocaleLowerCase());
      body.querySelector("[data-favorite-new]").onclick = () => openFavoriteEditor(type);
      list.onclick = event => {
        const button = event.target.closest("button");
        if (!button) return;
        const item = favorites.find(entry => entry.id === (button.dataset.use || button.dataset.edit));
        if (!item) return;
        if (button.dataset.use) openManual(type, [{ ...item, quantity: item.serving_label, nutrition_source: "favorite", confidence: "high" }]);
        else openFavoriteEditor(type, item);
      };
    } catch {
      if (dialog.open && body.firstElementChild === view) view.textContent = "無法載入常吃食物，請重試。";
    }
  }

  function openFavoriteEditor(type, item = {}) {
    openView("favoriteEdit", `<form>${favoriteFields(item)}<button type="submit">儲存常吃食物</button>
      ${item.id ? '<button type="button" data-delete-favorite class="diary-link">刪除這項食物</button>' : ""}
      <p data-status role="status"></p></form>`);
    const form = bindForm(async data => {
      const payload = { user_id: uid, food_name: String(data.get("food_name")).trim(),
        brand: String(data.get("brand")).trim() || null, serving_label: String(data.get("serving_label")).trim() || null,
        serving_weight_g: num(data.get("serving_weight_g")), nutrition_source: "manual" };
      if (!payload.food_name) throw Error("請輸入食物名稱。");
      for (const key of keys) payload[key] = num(data.get(key));
      const query = item.id ? db.from("user_favorite_foods").update(payload).eq("id", item.id).eq("user_id", uid)
        : db.from("user_favorite_foods").insert(payload);
      const { error } = await query;
      if (error) throw error;
      await openFavorites(type);
    });
    const remove = form.querySelector("[data-delete-favorite]");
    if (remove) remove.onclick = async () => {
      if (busy || !confirm("刪除這項常吃食物？")) return;
      setBusy(true);
      try {
        const { error } = await db.from("user_favorite_foods").delete().eq("id", item.id).eq("user_id", uid);
        if (error) throw error;
        await openFavorites(type);
      } catch (error) { formStatus(error.message || "刪除失敗。"); }
      finally { setBusy(false); }
    };
  }

  function openEdit(meal) {
    const date = selected, originals = meal.meal_items || [];
    const time = timeFormatter.format(new Date(meal.eaten_at));
    openView("edit", `<form><label>時間<input name="time" type="time" value="${time}" required></label>
      <label>備註<input name="notes" value="${esc(meal.notes)}"></label>
      ${addFields(originals, meal.meal_type)}<button type="submit">儲存修改</button><p data-status role="status"></p></form>`, date);
    let read;
    const form = bindForm(async data => {
      const chosenTime = String(data.get("time"));
      const previousTime = timeFormatter.format(new Date(meal.eaten_at));
      const eaten_at = chosenTime === previousTime ? meal.eaten_at : new Date(date + "T" + chosenTime + ":00+08:00").toISOString();
      const payload = { id: meal.id, meal_type: data.get("meal_type"), source: sourceFor(date, meal.source === "planned" ? "manual" : meal.source),
        eaten_at, notes: String(data.get("notes")).trim() || null, items: read() };
      const { error } = await db.rpc("update_meal_with_items", { p_meal: payload });
      if (error) throw error;
      dialog.close();
      refresh("已儲存餐點修改。");
    });
    read = editItemFields(form, originals);
  }

  function drawCopy() {
    const host = get("diaryCopy");
    host.hidden = !clipboard;
    host.innerHTML = clipboard ? `<div class="diary-copy">
      <span>已選取餐點，請在月曆選擇目的日期。</span>
      <button type="button" data-paste>貼到 ${visibleDate(selected)}</button>
      <button type="button" data-cancel-copy class="diary-link">取消</button></div>` : "";
  }

  function copiedMeal(meal, date) {
    return {
      meal_type: meal.meal_type,
      source: sourceFor(date, "manual"),
      eaten_at: new Date(date + "T" + timeFormatter.format(new Date(meal.eaten_at)) + ":00+08:00").toISOString(),
      notes: meal.notes,
      items: (meal.meal_items || []).map(item => Object.fromEntries(
        ["food_name", "quantity", "serving_weight_g", "nutrition_source", "confidence", ...keys].map(key => [key, item[key]])
      ))
    };
  }

  function reviewCopy(entries, date) {
    openView("copyReview", `<form>
      <p>勾選要新增到 ${visibleDate(date)} 的餐點，原有紀錄會保留。</p>
      <ul>${entries.map((meal, index) => {
        const from = dateFormatter.format(new Date(meal.eaten_at));
        const time = timeFormatter.format(new Date(meal.eaten_at));
        const foods = meal.meal_items.map(item => item.food_name).filter(Boolean).join("、");
        return `<li><label style="display:flex;align-items:flex-start;gap:10px">
          <input type="checkbox" name="copyMeal" value="${index}" checked style="width:auto;margin:3px 0 0">
          <span><b>${esc(from)} ${esc(time)} · ${esc(types[meal.meal_type] || types.other)}</b><br>${esc(foods)}</span>
        </label></li>`;
      }).join("")}</ul>
      <button type="submit">確認新增</button><p data-status role="status"></p>
    </form>`, date);
    bindForm(async data => {
      const checked = data.getAll("copyMeal").map(index => entries[Number(index)]).filter(Boolean);
      if (!checked.length) return formStatus("請至少勾選一筆餐點。");
      await save(db, checked.map(meal => copiedMeal(meal, date)));
      dialog.close();
      refresh(`已複製 ${checked.length} 筆餐點。`);
    });
  }

  get("diaryCopyYesterday").onclick = async event => {
    if (busy || future(selected)) return;
    const button = event.currentTarget;
    const date = selected;
    const previous = shiftDay(date, -1);
    busy = true;
    button.disabled = true;
    showMessage("");
    try {
      const rows = await mealRows(db.from("meals").select("meal_type,source,eaten_at,notes,meal_items(*)")
        .eq("user_id", uid).gte("eaten_at", midnight(previous)).lt("eaten_at", midnight(date))
        .order("eaten_at").order("id"));
      if (!diary.isConnected) return;
      const entries = rows.filter(meal => meal.source !== "planned" && meal.meal_items?.length);
      if (!entries.length) return showMessage("前一天沒有可複製的飲食紀錄。");
      reviewCopy(entries, date);
    } catch (error) { showMessage(error.message || "複製失敗。"); }
    finally { busy = false; button.disabled = false; }
  };

  get("diaryCopyRecent").onclick = async event => {
    if (busy) return;
    const button = event.currentTarget;
    const date = selected;
    const now = new Date().toISOString();
    const dayEnd = midnight(shiftDay(date, 1));
    busy = true;
    button.disabled = true;
    showMessage("");
    try {
      const [meal] = await recentMeals(dayEnd < now ? dayEnd : now, 1);
      if (!diary.isConnected) return;
      if (!meal) return showMessage("沒有可複製的餐點紀錄。");
      reviewCopy([meal], date);
    } catch (error) { showMessage(error.message || "複製失敗。"); }
    finally { busy = false; button.disabled = false; }
  };

  get("diaryCopy").onclick = async event => {
    if (event.target.closest("[data-cancel-copy]") && !busy) {
      clipboard = null;
      drawCopy();
    }
    const paste = event.target.closest("[data-paste]");
    if (!paste || !clipboard || busy) return;
    const date = selected, meal = clipboard;
    busy = true;
    paste.disabled = true;
    try {
      await save(db, [{ meal_type: meal.meal_type, source: sourceFor(date, "manual"), eaten_at: isoDate(date),
        notes: meal.notes, items: (meal.meal_items || []).map(item => Object.fromEntries(
          ["food_name", "quantity", "serving_weight_g", "nutrition_source", "confidence", ...keys].map(key => [key, item[key]]
        ))) }]);
      clipboard = null;
      drawCopy();
      refresh("已複製餐點。");
    } catch (error) { showMessage(error.message || "複製失敗。"); }
    finally { busy = false; paste.disabled = false; }
  };

  get("diaryMeals").onclick = async event => {
    const button = event.target.closest("button");
    if (!button || busy) return;
    if (button.hasAttribute("data-retry")) return loadDay();
    if (button.dataset.addType) return openMenu(button.dataset.addType);
    const meal = meals.find(entry => entry.id === button.dataset.id);
    if (!meal) return;
    if (button.dataset.mealAction === "edit") return openEdit(meal);
    if (button.dataset.mealAction === "consume") {
      if (selected !== day() || meal.source !== "planned") return;
      busy = true;
      button.disabled = true;
      try {
        const items = (meal.meal_items || []).map(item => Object.fromEntries(
          ["food_name", "quantity", "serving_weight_g", "nutrition_source", "confidence", ...keys].map(key => [key, item[key]])
        ));
        const { error } = await db.rpc("update_meal_with_items", { p_meal: {
          id: meal.id, meal_type: meal.meal_type, source: "manual", eaten_at: meal.eaten_at,
          notes: meal.notes || null, photo_path: meal.photo_path || null, items
        } });
        if (error) throw error;
        refresh("已標記為已吃，並納入今日攝取統計。");
      } catch (error) {
        showMessage(error.message || "無法更新餐點狀態，請重試。");
      } finally {
        busy = false;
        button.disabled = false;
      }
      return;
    }
    if (button.dataset.mealAction === "favorite") {
      const items = (meal.meal_items || []).filter(item => item.food_name?.trim());
      if (!items.length) return showMessage("這筆餐點沒有可收藏的食物。");
      busy = true;
      button.disabled = true;
      try {
        const { data: existing, error: lookupError } = await db.from("user_favorite_foods")
          .select("food_name").eq("user_id", uid);
        if (lookupError) throw lookupError;
        const names = new Set((existing || []).map(item => item.food_name.trim().toLocaleLowerCase()));
        const fresh = items.filter(item => !names.has(item.food_name.trim().toLocaleLowerCase()));
        if (!fresh.length) return showMessage("餐點中的食物都已收藏。");
        const payload = fresh.map(item => ({
          user_id: uid, food_name: item.food_name.trim(),
          serving_label: item.quantity || null, serving_weight_g: item.serving_weight_g ?? null,
          nutrition_source: item.nutrition_source || "manual",
          ...Object.fromEntries(keys.map(key => [key, item[key] ?? null]))
        }));
        const { error } = await db.from("user_favorite_foods").insert(payload);
        if (error) throw error;
        showMessage(`已將 ${fresh.length} 項食物加入常吃清單。`);
      } catch (error) {
        showMessage(error.message || "收藏失敗，請稍後重試。");
      } finally {
        busy = false;
        button.disabled = false;
      }
      return;
    }
    if (button.dataset.mealAction === "copy") {
      clipboard = meal;
      calendarOpen = true;
      drawCopy();
      drawCalendar();
      get("diaryCopy").scrollIntoView({ block: "nearest" });
      return;
    }
    if (button.dataset.mealAction !== "delete" || !confirm("確定刪除這筆餐點？")) return;
    busy = true;
    button.disabled = true;
    try {
      const { error } = await db.from("meals").delete().eq("id", meal.id).eq("user_id", uid);
      if (error) throw error;
      if (meal.photo_path) await db.storage.from("meal-photos").remove([meal.photo_path]).catch(() => {});
      refresh("已刪除餐點。");
    } catch (error) { showMessage(error.message || "刪除失敗。"); }
    finally { busy = false; button.disabled = false; }
  };
  get("diarySummary").onclick = event => {
    const button = event.target.closest("[data-fill-meal]");
    if (!button || busy) return;
    const meal = meals.find(entry => entry.id === button.dataset.fillMeal);
    if (meal) openEdit(meal);
  };
  get("diaryAdd").onclick = () => { if (!busy) openMenu(); };
  get("diaryPrevious").onclick = () => moveMonth(-1);
  get("diaryNext").onclick = () => moveMonth(1);
  get("diaryToday").onclick = () => selectDate(day());
  calendarToggle.onclick = () => { calendarOpen = !calendarOpen; drawCalendar(); };
  grid.onclick = event => {
    const button = event.target.closest("[data-date]");
    if (!button) return;
    selectDate(button.dataset.date, true);
    if (calendarOpen) grid.querySelector('[data-date="' + selected + '"]')?.focus();
    else calendarToggle.focus();
  };
  grid.onkeydown = event => {
    const button = event.target.closest("[data-date]");
    if (!button || busy) return;
    const date = button.dataset.date;
    const weekday = new Date(date + "T00:00:00Z").getUTCDay();
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
      Home: -weekday, End: 6 - weekday };
    if (!(event.key in offsets)) return;
    event.preventDefault();
    selectDate(shiftDay(date, offsets[event.key]));
    grid.querySelector('[data-date="' + selected + '"]')?.focus();
  };
  get("diaryClose").onclick = () => { if (!busy) dialog.close(); };
  dialog.oncancel = event => { if (busy) event.preventDefault(); };
  dialog.onclose = () => { if (!dialog.open) { clearPhotoPreview(); body.replaceChildren(); } };
  drawCalendar();
  void loadDay();
  void loadMarkers();
}
