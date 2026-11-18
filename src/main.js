import { renderNaturalMeal, initNaturalMeal } from "./natural-meal.js";
import { renderAnalytics, initAnalytics } from "./analytics.js";
import "./analytics.css";
import { renderMealHistory, initMealHistory } from "./meal-history.js";
import { createClient } from "@supabase/supabase-js";
import "./style.css";
import { renderNutritionSummary } from "./nutrition.js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const app = document.querySelector("#app");

let currentUser = null;
let currentTab = "home";
let profile = null;
let stages = [];
let latestWeight = null;
let pendingFoodPhoto = null;
let pendingFoodMimeType = "image/jpeg";
let pendingFoodAnalysis = null;

const today = () => {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000)
    .toISOString().slice(0, 10);
};

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char])
  );
}

function showMessage(message) {
  alert(message);
}

async function loadProfile() {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (error) throw error;
  profile = data;
}

async function loadStages() {
  const { data, error } = await supabase
    .from("goal_stages")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("sort_order", { ascending: true })
    .order("target_date", { ascending: true });

  if (error) throw error;
  stages = data || [];
}

async function loadLatestWeight() {
  const { data, error } = await supabase
    .from("weight_logs")
    .select("weight_kg, logged_at")
    .eq("user_id", currentUser.id)
    .order("logged_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  latestWeight = data?.[0] || null;
}

async function getRows(table, dateColumn) {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("user_id", currentUser.id)
    .order(dateColumn, { ascending: false })
    .limit(30);

  if (error) throw error;
  return data || [];
}

function showLogin() {
  app.innerHTML = `
    <div class="login-page">
      <h1>♡ My Slim Journey</h1>
      <p>Every day, a healthier me.</p>

      <form id="loginForm">
        <input name="email" type="email"
          placeholder="Email" required>
        <input name="password" type="password"
          placeholder="Password" required minlength="6">
        <button type="submit">登入</button>
        <button type="button" id="signup">建立帳號</button>
      </form>
      <p id="message"></p>
    </div>
  `;

  document.querySelector("#loginForm").onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.target);

    const { error } = await supabase.auth.signInWithPassword({
      email: form.get("email"),
      password: form.get("password")
    });

    if (error) {
      document.querySelector("#message").textContent = error.message;
    } else {
      await refresh();
    }
  };

  document.querySelector("#signup").onclick = async () => {
    const form = new FormData(
      document.querySelector("#loginForm")
    );

    const { error } = await supabase.auth.signUp({
      email: form.get("email"),
      password: form.get("password")
    });

    document.querySelector("#message").textContent =
      error ? error.message : "請到 Email 收取驗證信。";
  };
}

function renderHome(totals) {
  const current = latestWeight
    ? Number(latestWeight.weight_kg)
    : null;

  const target = profile?.target_weight_kg
    ? Number(profile.target_weight_kg)
    : null;

  const activeStage = stages.find(stage =>
    new Date(stage.target_date + "T23:59:59") >= new Date()
  );

  const stageTarget = activeStage
    ? Number(activeStage.target_weight_kg)
    : target;

  const remaining = current !== null && stageTarget !== null
    ? Math.max(0, current - stageTarget)
    : null;
  
  const nutritionPanel = renderNutritionSummary(
    profile,
    current,
    totals
  );
  return `
        ${nutritionPanel}

    <section class="card">
      <p class="eyebrow">TODAY'S NUTRITION SUMMARY</p>
      <h2>${Math.round(totals.calories)} kcal</h2>
      <div class="macros">
        <div><b>${totals.protein.toFixed(1)}g</b><span>蛋白質</span></div>
        <div><b>${totals.carbs.toFixed(1)}g</b><span>碳水</span></div>
        <div><b>${totals.fat.toFixed(1)}g</b><span>脂肪</span></div>
      </div>
    </section>

    <section class="card">
      <p class="eyebrow">MY WEIGHT JOURNEY</p>
      <h3>目前體重</h3>
      <h2>${current !== null ? current.toFixed(1) + " kg" : "尚未紀錄"}</h2>
      <p>長期目標：${target !== null ? target + " kg" : "尚未設定"}</p>
      ${
        activeStage
          ? `<p>目前階段：${escapeHTML(activeStage.stage_name)}</p>
             <p>階段目標：${stageTarget} kg</p>
             <p>距離階段目標：${remaining !== null ? remaining.toFixed(1) + " kg" : "請先紀錄體重"}</p>
             <p>目標日期：${activeStage.target_date}</p>`
          : "<p>請到「設定」新增減重階段。</p>"
      }
    </section>

    <section class="card">
      <h3>今日活動</h3>
      <p class="muted">尚未連接 Apple Health，活動消耗及步數請先手動紀錄。</p>
    </section>

    <section class="card">
      <h3>AI Coach</h3>
      <p>完成飲食、體重及運動紀錄後，才能進行有根據的個人化分析。</p>
      <p class="muted">AI 主動分析功能將於後續版本加入。</p>
    </section>
  `;
}

async function showApp() {
  if (!currentUser) return showLogin();

  let content = "";

  try {
    await Promise.all([
      loadProfile(),
      loadStages(),
      loadLatestWeight()
    ]);

    if (currentTab === "home") {
      const meals = await getRows("meals", "eaten_at");
            const todaysMeals = meals.filter(
        meal =>
          meal.source !== "planned" &&
          meal.eaten_at?.slice(0, 10) === today()
      );

      let items = [];

      if (todaysMeals.length) {
        const { data, error } = await supabase
          .from("meal_items")
          .select("*")
          .eq("user_id", currentUser.id)
          .in("meal_id", todaysMeals.map(m => m.id));

        if (error) throw error;
        items = data || [];
      }

      const totals = items.reduce((a, item) => ({
        calories: a.calories + Number(item.calories || 0),
        protein: a.protein + Number(item.protein_g || 0),
        carbs: a.carbs + Number(item.carbs_g || 0),
        fat: a.fat + Number(item.fat_g || 0)
      }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

      content = renderHome(totals);
    }

    if (currentTab === "meals") {
      content = `
      ${renderNaturalMeal()}
        <section class="card">
          <h2>AI 拍照辨識</h2>
          <p class="muted">拍攝或選擇餐點照片，AI 會估算食物與營養素。請在儲存前確認或修改數值。</p>
          <form id="foodPhotoForm">
            <label>餐別
              <select name="photo_meal_type">
                <option value="breakfast">早餐</option>
                <option value="lunch">午餐</option>
                <option value="dinner">晚餐</option>
                <option value="snack">點心</option>
              </select>
            </label>
            <label>食物照片
              <input id="foodPhotoInput" name="food_photo" type="file"
                accept="image/*" required>
            </label>
            <button type="submit" id="analyzeFoodButton">AI 分析照片</button>
          </form>
          <p id="aiPhotoStatus" class="muted"></p>
          <div id="aiPhotoResult"></div>
        </section>

        <section class="card">
          <h2>手動新增飲食</h2>
          <form id="mealForm">
            <label>餐別
              <select name="meal_type">
                <option value="breakfast">早餐</option>
                <option value="lunch">午餐</option>
                <option value="dinner">晚餐</option>
                <option value="snack">點心</option>
              </select>
            </label>
            <label>食物名稱
              <input name="food_name" required placeholder="例如：雞胸肉">
            </label>
            <label>份量
              <input name="quantity" placeholder="例如：100g">
            </label>
            <label>熱量 kcal
              <input name="calories" type="number" min="0" value="0">
            </label>
            <label>蛋白質 g
              <input name="protein_g" type="number" min="0" step="0.1" value="0">
            </label>
            <label>碳水 g
              <input name="carbs_g" type="number" min="0" step="0.1" value="0">
            </label>
            <label>脂肪 g
              <input name="fat_g" type="number" min="0" step="0.1" value="0">
            </label>
            <button type="submit">儲存飲食</button>
          </form>
        </section>
                ${renderMealHistory()}
      `;
    }

    if (["weight", "activity", "reports", "coach"].includes(currentTab)) {
  content = renderAnalytics(currentTab);
}

    if (currentTab === "settings") {
      content = `
        <section class="card">
          <h2>個人設定</h2>
          
<form id="profileForm">
  <label>顯示名稱
    <input name="display_name"
      value="${escapeHTML(profile?.display_name || "")}"
      placeholder="輸入名稱">
  </label>

  <label>出生日期
    <input name="birth_date" type="date"
      value="${profile?.birth_date ?? ""}" required>
  </label>

  <label>生理性別
    <select name="sex" required>
      <option value="">請選擇</option>
      <option value="female" ${profile?.sex === "female" ? "selected" : ""}>女性</option>
      <option value="male" ${profile?.sex === "male" ? "selected" : ""}>男性</option>
    </select>
  </label>

  <label>身高（cm）
    <input name="height_cm" type="number"
      min="100" max="220" step="0.1"
      value="${profile?.height_cm ?? ""}" required>
  </label>

  <label>起始體重（kg）
    <input name="start_weight_kg" type="number"
      min="25" max="250" step="0.1"
      value="${profile?.start_weight_kg ?? ""}" required>
  </label>

  <label>長期目標體重（kg）
    <input name="target_weight_kg" type="number"
      min="25" max="250" step="0.1"
      value="${profile?.target_weight_kg ?? ""}" required>
  </label>

  <label>目標體脂率（%）
    <input name="target_body_fat_pct" type="number"
      min="5" max="60" step="0.1"
      value="${profile?.target_body_fat_pct ?? ""}"
      placeholder="選填">
  </label>

  <label>活動程度
    <select name="activity_level" required>
      <option value="sedentary" ${profile?.activity_level === "sedentary" ? "selected" : ""}>久坐，幾乎沒有運動</option>
      <option value="light" ${profile?.activity_level === "light" ? "selected" : ""}>輕量活動，每週約 1–3 天</option>
      <option value="moderate" ${profile?.activity_level === "moderate" ? "selected" : ""}>中度活動，每週約 3–5 天</option>
      <option value="active" ${profile?.activity_level === "active" ? "selected" : ""}>高度活動，每週約 6–7 天</option>
      <option value="very_active" ${profile?.activity_level === "very_active" ? "selected" : ""}>非常高活動量</option>
    </select>
  </label>

  <label>管理目標
    <select name="goal_mode" required>
      <option value="lose" ${(!profile?.goal_mode || profile?.goal_mode === "lose") ? "selected" : ""}>減脂</option>
      <option value="maintain" ${profile?.goal_mode === "maintain" ? "selected" : ""}>維持體重</option>
      <option value="gain" ${profile?.goal_mode === "gain" ? "selected" : ""}>增肌</option>
    </select>
  </label>

  <label>目標期限
    <input name="target_date" type="date"
      value="${profile?.target_date ?? ""}">
  </label>

  <label>每週預計減重（kg）
    <input name="weekly_change_kg" type="number"
      min="0" max="1" step="0.05"
      value="${profile?.weekly_change_kg ?? 0.25}">
    <small>減脂模式使用；建議採取循序漸進的速度。</small>
  </label>

  <h3>每日營養目標（選填）</h3>
  <p class="muted">留空時會依體重及熱量目標自動計算。</p>

  <label>自訂熱量（kcal）
    <input name="calorie_target_override" type="number"
      min="1200" max="5000" step="1"
      value="${profile?.calorie_target_override ?? ""}">
  </label>

  <label>蛋白質（g）
    <input name="protein_target_g" type="number"
      min="0" max="400" step="1"
      value="${profile?.protein_target_g ?? ""}">
  </label>

  <label>碳水（g）
    <input name="carbs_target_g" type="number"
      min="0" max="600" step="1"
      value="${profile?.carbs_target_g ?? ""}">
  </label>

  <label>脂肪（g）
    <input name="fat_target_g" type="number"
      min="0" max="250" step="1"
      value="${profile?.fat_target_g ?? ""}">
  </label>

  <button type="submit">儲存個人設定</button>
</form>

          <p class="muted">目前體重會自動讀取最新一筆體重紀錄。</p>
        </section>

        <section class="card">
          <h2>減重階段管理</h2>
          <p class="muted">你可以自行新增、修改及刪除階段。</p>

          <form id="stageForm">
            <input type="hidden" name="stage_id">
            <label>階段名稱
              <input name="stage_name" required placeholder="例如：第一階段">
            </label>
            <label>目標體重（kg）
              <input name="target_weight_kg" type="number"
                min="25" max="250" step="0.1" required>
            </label>
            <label>目標日期
              <input name="target_date" type="date" required>
            </label>
            <button type="submit" id="stageSubmit">新增階段</button>
            <button type="button" id="cancelStage"
              style="display:none;background:#eee;color:#665">
              取消修改
            </button>
          </form>
        </section>

        <section class="card">
          <h3>已設定的階段</h3>
          ${
            stages.length
              ? stages.map((stage, index) => `
                <div class="stage-row">
                  <h3>${escapeHTML(stage.stage_name)}</h3>
                  <p>目標：${stage.target_weight_kg} kg</p>
                  <p>期限：${stage.target_date}</p>
                  <button type="button" class="edit-stage"
                    data-id="${stage.id}">修改</button>
                  <button type="button" class="delete-stage"
                    data-id="${stage.id}"
                    style="background:#eee;color:#80635b">
                    刪除
                  </button>
                </div>
                ${index < stages.length - 1 ? "<hr>" : ""}
              `).join("")
              : "<p class='muted'>尚未新增階段目標。</p>"
          }
        </section>
      `;
    }

  } catch (error) {
    content = `
      <section class="card">
        讀取失敗：${escapeHTML(error.message)}
      </section>
    `;
  }

  app.innerHTML = `
    <header>
      <h1>♡ My Slim Journey</h1>
      <p>${escapeHTML(currentUser.email)}</p>
      <button id="logout" class="logout">登出</button>
    </header>
    ${content}
<nav>
  <button data-tab="home">首頁</button>
  <button data-tab="meals">飲食</button>
  <button data-tab="weight">體重</button>
  <button data-tab="activity">運動</button>
  <button data-tab="reports">週報</button>
  <button data-tab="coach">Coach</button>
  <button data-tab="settings">設定</button>
</nav>
  `;
  if (["weight", "activity", "reports", "coach"].includes(currentTab)) {
    initAnalytics(
      supabase,
      currentUser.id,
      currentTab,
      () => showApp()
    ).catch(error => {
      alert(`載入失敗：${error.message}`);
    });
  }
  document.querySelectorAll("[data-tab]").forEach(button => {
    button.classList.toggle("active", button.dataset.tab === currentTab);
    button.onclick = () => {
      currentTab = button.dataset.tab;
      showApp();
    };
  });

  document.querySelector("#logout").onclick = async () => {
    await supabase.auth.signOut();
    currentUser = null;
    showLogin();
  };

  const profileForm = document.querySelector("#profileForm");

  if (profileForm) {
    profileForm.onsubmit = async event => {
      event.preventDefault();
      const f = new FormData(profileForm);

      
const optionalNumber = name => {
  const value = f.get(name);
  return value === "" || value === null
    ? null
    : Number(value);
};

const { error } = await supabase
  .from("profiles")
  .upsert({
    id: currentUser.id,
    display_name: f.get("display_name"),
    birth_date: f.get("birth_date") || null,
    sex: f.get("sex"),
    height_cm: Number(f.get("height_cm")),
    start_weight_kg: Number(f.get("start_weight_kg")),
    target_weight_kg: Number(f.get("target_weight_kg")),
    target_body_fat_pct: optionalNumber("target_body_fat_pct"),
    activity_level: f.get("activity_level"),
    goal_mode: f.get("goal_mode"),
    target_date: f.get("target_date") || null,
    weekly_change_kg: optionalNumber("weekly_change_kg"),
    calorie_target_override: optionalNumber("calorie_target_override"),
    protein_target_g: optionalNumber("protein_target_g"),
    carbs_target_g: optionalNumber("carbs_target_g"),
    fat_target_g: optionalNumber("fat_target_g"),
    updated_at: new Date().toISOString()
  }, { onConflict: "id" });


      if (error) return showMessage(error.message);

      showMessage("個人設定已儲存！");
      await showApp();
    };
  }
    const stageForm = document.querySelector("#stageForm");

  if (stageForm) {
    stageForm.onsubmit = async event => {
      event.preventDefault();
      const f = new FormData(stageForm);
      const stageId = f.get("stage_id");

      const payload = {
        user_id: currentUser.id,
        stage_name: f.get("stage_name"),
        target_weight_kg: Number(f.get("target_weight_kg")),
        target_date: f.get("target_date"),
        sort_order: stageId
          ? stages.find(s => s.id === stageId)?.sort_order || stages.length + 1
          : stages.length + 1,
        updated_at: new Date().toISOString()
      };

      const query = stageId
        ? supabase.from("goal_stages").update(payload).eq("id", stageId)
        : supabase.from("goal_stages").insert(payload);

      const { error } = await query;

      if (error) return showMessage(error.message);

      showMessage(stageId ? "階段已更新！" : "階段已新增！");
      await showApp();
    };

    document.querySelector("#cancelStage").onclick = () => {
      stageForm.reset();
      stageForm.elements.stage_id.value = "";
      document.querySelector("#stageSubmit").textContent = "新增階段";
      document.querySelector("#cancelStage").style.display = "none";
    };

    document.querySelectorAll(".edit-stage").forEach(button => {
      button.onclick = () => {
        const stage = stages.find(s => s.id === button.dataset.id);
        if (!stage) return;

        stageForm.elements.stage_id.value = stage.id;
        stageForm.elements.stage_name.value = stage.stage_name;
        stageForm.elements.target_weight_kg.value = stage.target_weight_kg;
        stageForm.elements.target_date.value = stage.target_date;

        document.querySelector("#stageSubmit").textContent = "儲存修改";
        document.querySelector("#cancelStage").style.display = "block";

        stageForm.scrollIntoView({ behavior: "smooth" });
      };
    });

    document.querySelectorAll(".delete-stage").forEach(button => {
      button.onclick = async () => {
        if (!confirm("確定要刪除這個階段嗎？")) return;

        const { error } = await supabase
          .from("goal_stages")
          .delete()
          .eq("id", button.dataset.id);

        if (error) return showMessage(error.message);

        showMessage("階段已刪除。");
        await showApp();
      };
    });
  }

  const mealForm = document.querySelector("#mealForm");

  if (mealForm) {
    mealForm.onsubmit = async event => {
      event.preventDefault();
      const f = new FormData(mealForm);

      const { data, error } = await supabase
        .from("meals")
        .insert({
          user_id: currentUser.id,
          meal_type: f.get("meal_type"),
          source: "manual",
          notes: f.get("food_name")
        })
        .select()
        .single();

      if (error) return showMessage(error.message);

      const { error: itemError } = await supabase
        .from("meal_items")
        .insert({
          meal_id: data.id,
          user_id: currentUser.id,
          food_name: f.get("food_name"),
          quantity: f.get("quantity"),
          calories: Number(f.get("calories") || 0),
          protein_g: Number(f.get("protein_g") || 0),
          carbs_g: Number(f.get("carbs_g") || 0),
          fat_g: Number(f.get("fat_g") || 0)
        });

      if (itemError) return showMessage(itemError.message);

      showMessage("飲食紀錄已儲存！");
      await showApp();
    };
  }

  const foodPhotoForm = document.querySelector("#foodPhotoForm");

  if (foodPhotoForm) {
    const photoStatus = document.querySelector("#aiPhotoStatus");
    const photoResult = document.querySelector("#aiPhotoResult");
    const analyzeButton = document.querySelector("#analyzeFoodButton");

    foodPhotoForm.onsubmit = async event => {
      event.preventDefault();
      const file = document.querySelector("#foodPhotoInput").files?.[0];

      if (!file) return showMessage("請先選擇食物照片。");
      if (!file.type.startsWith("image/")) return showMessage("請選擇圖片檔案。");
      if (file.size > 7 * 1024 * 1024) return showMessage("照片太大，請選擇 7MB 以下的圖片。");

      analyzeButton.disabled = true;
      photoStatus.textContent = "AI 正在辨識照片，請稍候……";
      photoResult.innerHTML = "";

      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("讀取照片失敗。"));
          reader.readAsDataURL(file);
        });

        const imageBase64 = String(dataUrl).split(",")[1];
        const mimeType = file.type || "image/jpeg";

        const { data, error } = await supabase.functions.invoke("analyze-food", {
          body: { imageBase64, mimeType }
        });

        if (error) throw error;
        if (!data?.success || !Array.isArray(data.analysis?.items)) {
          throw new Error(data?.error || "AI 回傳格式不正確。");
        }
        if (!data.analysis.items.length) {
          throw new Error(data.analysis.note || "無法辨識照片中的食物，請換一張清楚的照片。");
        }

        pendingFoodPhoto = file;
        pendingFoodMimeType = mimeType;
        pendingFoodAnalysis = data.analysis;

        const confidence = { high: "高", medium: "中", low: "低" }[data.analysis.confidence] || "未提供";
        photoStatus.textContent = `辨識完成｜信心程度：${confidence}。營養數值為估算，請確認或修改後再儲存。`;

        photoResult.innerHTML = `
          <form id="aiConfirmForm">
            ${data.analysis.items.map((item, index) => `
              <div style="border-top:1px solid #eee;padding-top:12px;margin-top:12px">
                <h3>食物 ${index + 1}</h3>
                <label>食物名稱
                  <input name="food_name_${index}" required value="${escapeHTML(item.food_name || "")}">
                </label>
                <label>估計份量
                  <input name="quantity_${index}" value="${escapeHTML(item.quantity || "")}">
                </label>
                <label>熱量 kcal
                  <input name="calories_${index}" type="number" min="0" step="1" required value="${Number(item.calories) || 0}">
                </label>
                <label>蛋白質 g
                  <input name="protein_${index}" type="number" min="0" step="0.1" required value="${Number(item.protein_g) || 0}">
                </label>
                <label>碳水 g
                  <input name="carbs_${index}" type="number" min="0" step="0.1" required value="${Number(item.carbs_g) || 0}">
                </label>
                <label>脂肪 g
                  <input name="fat_${index}" type="number" min="0" step="0.1" required value="${Number(item.fat_g) || 0}">
                </label>
              </div>
            `).join("")}
            <p class="muted">${escapeHTML(data.analysis.note || "照片辨識僅供估算，實際營養可能不同。")}</p>
            <button type="submit" id="saveAiMealButton">確認並儲存飲食</button>
            <button type="button" id="cancelAiMealButton" style="background:#eee;color:#665">取消</button>
          </form>
        `;

        const aiConfirmForm = photoResult.querySelector("#aiConfirmForm");
if (!aiConfirmForm) throw new Error("無法建立營養確認表單，請重新分析照片。");
aiConfirmForm.onsubmit = async saveEvent => {
          const saveButton = document.querySelector("#saveAiMealButton");
          saveButton.disabled = true;
          saveButton.textContent = "正在儲存……";

          try {
            const formData = new FormData(saveEvent.target);
            const itemsToSave = pendingFoodAnalysis.items.map((item, index) => ({
              food_name: String(formData.get(`food_name_${index}`) || "").trim(),
              quantity: String(formData.get(`quantity_${index}`) || "").trim(),
              calories: Number(formData.get(`calories_${index}`)),
              protein_g: Number(formData.get(`protein_${index}`)),
              carbs_g: Number(formData.get(`carbs_${index}`)),
              fat_g: Number(formData.get(`fat_${index}`))
            }));

            if (itemsToSave.some(item =>
              !item.food_name ||
              ![item.calories, item.protein_g, item.carbs_g, item.fat_g].every(
                value => Number.isFinite(value) && value >= 0
              )
            )) throw new Error("請確認食物名稱及營養數值正確且不小於 0。");

            const extension = {
              "image/jpeg": "jpg", "image/png": "png",
              "image/webp": "webp", "image/gif": "gif"
            }[pendingFoodMimeType] || "jpg";
            const photoPath = `${currentUser.id}/${crypto.randomUUID()}.${extension}`;

            const { error: uploadError } = await supabase.storage
              .from("meal-photos")
              .upload(photoPath, pendingFoodPhoto, {
                contentType: pendingFoodMimeType,
                upsert: false
              });
            if (uploadError) throw uploadError;

            const mealType = new FormData(foodPhotoForm).get("photo_meal_type");
            const { data: meal, error: mealError } = await supabase
              .from("meals")
              .insert({
                user_id: currentUser.id,
                meal_type: mealType,
                source: "ai_photo",
                notes: pendingFoodAnalysis.note || "AI 照片辨識估算",
                photo_path: photoPath
              })
              .select()
              .single();
            if (mealError) throw mealError;

            const { error: itemsError } = await supabase
              .from("meal_items")
              .insert(itemsToSave.map(item => ({
                meal_id: meal.id,
                user_id: currentUser.id,
                ...item
              })));
            if (itemsError) throw itemsError;

            pendingFoodPhoto = null;
            pendingFoodAnalysis = null;
            showMessage("AI 飲食辨識結果已確認並儲存！");
            await showApp();
          } catch (saveError) {
            saveButton.disabled = false;
            saveButton.textContent = "確認並儲存飲食";
            showMessage(`儲存失敗：${saveError.message}`);
          }
        };

        document.querySelector("#cancelAiMealButton").onclick = () => {
          pendingFoodPhoto = null;
          pendingFoodAnalysis = null;
          photoResult.innerHTML = "";
          photoStatus.textContent = "已取消，尚未儲存飲食紀錄。";
          foodPhotoForm.reset();
        };
      } catch (error) {
        console.error("AI food analysis error:", error);
        photoStatus.textContent = "";
        showMessage(`AI 辨識失敗：${error.message || "請稍後再試。"}`);
      } finally {
        analyzeButton.disabled = false;
      }
    };
  }
    if (currentTab === "meals") {
    initMealHistory(supabase, currentUser.id, () => showApp());
    initNaturalMeal(supabase, currentUser.id, () => showApp());
    }
}
async function refresh() {
  const { data } = await supabase.auth.getSession();
  currentUser = data.session?.user || null;
  await showApp();
}

supabase.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user || null;
  showApp();
});

refresh();
