import { createClient } from "@supabase/supabase-js";
import "./style.css";

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

  return `
    <section class="card">
      <p class="eyebrow">TODAY'S NUTRITION</p>
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
        meal => meal.eaten_at?.slice(0, 10) === today()
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
                accept="image/*" capture="environment" required>
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
```javascript
            <label>熱量（kcal）
              <input name="calories" type="number" min="0" step="0.1" required>
            </label>
            <label>蛋白質（g）
              <input name="protein_g" type="number" min="0" step="0.1" value="0">
            </label>
            <label>碳水（g）
              <input name="carbs_g" type="number" min="0" step="0.1" value="0">
            </label>
            <label>脂肪（g）
              <input name="fat_g" type="number" min="0" step="0.1" value="0">
            </label>
            <button type="submit">儲存飲食紀錄</button>
          </form>
        </section>
      `;
    }

    if (currentTab === "weight") {
      const rows = await getRows("weight_logs", "logged_at");

      content = `
        <section class="card">
          <h2>體重紀錄</h2>
          <form id="weightForm">
            <label>體重（kg）
              <input name="weight_kg" type="number" min="20" max="300"
                step="0.1" required>
            </label>
            <label>體脂率（%）
              <input name="body_fat_pct" type="number" min="1" max="70"
                step="0.1">
            </label>
            <label>肌肉量（kg）
              <input name="muscle_mass_kg" type="number" min="1" max="150"
                step="0.1">
            </label>
            <button type="submit">儲存體重</button>
          </form>
        </section>

        <section class="card">
          <h3>歷史紀錄</h3>
          ${
            rows.length
              ? rows.map(row => `
                  <p>${row.logged_at?.slice(0, 10) || ""}
                    — ${Number(row.weight_kg).toFixed(1)} kg
                    ${row.body_fat_pct != null
                      ? `／體脂 ${Number(row.body_fat_pct).toFixed(1)}%`
                      : ""}
                  </p>
                `).join("")
              : "<p class='muted'>尚無體重紀錄</p>"
          }
        </section>
      `;
    }

    if (currentTab === "activity") {
      const rows = await getRows("activity_logs", "logged_at");

      content = `
        <section class="card">
          <h2>運動紀錄</h2>
          <p class="muted">目前尚未連接 Apple Health，可先手動新增活動。</p>
          <form id="activityForm">
            <label>活動名稱
              <input name="activity_name" required placeholder="例如：飛輪">
            </label>
            <label>運動時間（分鐘）
              <input name="duration_min" type="number" min="1" required>
            </label>
            <label>消耗熱量（kcal）
              <input name="calories_burned" type="number" min="0" step="1">
            </label>
            <button type="submit">儲存運動紀錄</button>
          </form>
        </section>

        <section class="card">
          <h3>歷史活動</h3>
          ${
            rows.length
              ? rows.map(row => `
                  <p>${row.logged_at?.slice(0, 10) || ""}
                    — ${escapeHTML(row.activity_name)}
                    ${row.duration_min ? `／${row.duration_min} 分鐘` : ""}
                  </p>
                `).join("")
              : "<p class='muted'>尚無運動紀錄</p>"
          }
        </section>
      `;
    }

    if (currentTab === "settings") {
      content = `
        <section class="card">
          <h2>個人設定</h2>
          <form id="profileForm">
            <label>顯示名稱
              <input name="display_name"
                value="${escapeHTML(profile?.display_name || "")}">
            </label>
            <label>身高（cm）
              <input name="height_cm" type="number" min="100" max="230"
                step="0.1" value="${profile?.height_cm ?? ""}">
            </label>
            <label>起始體重（kg）
              <input name="start_weight_kg" type="number" min="20" max="300"
                step="0.1" value="${profile?.start_weight_kg ?? ""}">
            </label>
            <label>長期目標體重（kg）
              <input name="target_weight_kg" type="number" min="20" max="300"
                step="0.1" value="${profile?.target_weight_kg ?? ""}">
            </label>
            <button type="submit">儲存個人設定</button>
          </form>
        </section>

        <section class="card">
          <h2>階段目標</h2>
          <form id="stageForm">
            <label>階段名稱
              <input name="stage_name" required placeholder="例如：第一階段">
            </label>
            <label>目標體重（kg）
              <input name="target_weight_kg" type="number" min="20" max="300"
                step="0.1" required>
            </label>
            <label>目標日期
              <input name="target_date" type="date" required>
            </label>
            <button type="submit">新增階段目標</button>
          </form>

          <div class="stage-list">
            ${
              stages.length
                ? stages.map(stage => `
                    <div class="stage-item">
                      <p><b>${escapeHTML(stage.stage_name)}</b></p>
                      <p>${Number(stage.target_weight_kg).toFixed(1)} kg
                        ／ ${stage.target_date}</p>
                      <button type="button" class="delete-stage"
                        data-id="${stage.id}">刪除此目標</button>
                    </div>
                  `).join("")
                : "<p class='muted'>尚未設定階段目標</p>"
            }
          </div>
        </section>

        <section class="card">
          <h2>帳號</h2>
          <p>${escapeHTML(currentUser.email)}</p>
          <button type="button" id="logoutButton">登出</button>
        </section>
      `;
    }
  } catch (error) {
    console.error(error);
    content = `
      <section class="card">
        <h2>載入失敗</h2>
        <p>${escapeHTML(error.message)}</p>
        <button type="button" id="retryButton">重新載入</button>
      </section>
    `;
  }

  app.innerHTML = `
    <header class="app-header">
      <h1>♡ My Slim Journey</h1>
      <p>Every day, a healthier me.</p>
    </header>

    <main>${content}</main>

    <nav class="bottom-nav">
      <button data-tab="home" class="${currentTab === "home" ? "active" : ""}">
        首頁
      </button>
      <button data-tab="meals" class="${currentTab === "meals" ? "active" : ""}">
        飲食
      </button>
      <button data-tab="weight" class="${currentTab === "weight" ? "active" : ""}">
        體重
      </button>
      <button data-tab="activity" class="${currentTab === "activity" ? "active" : ""}">
        運動
      </button>
      <button data-tab="settings" class="${currentTab === "settings" ? "active" : ""}">
        設定
      </button>
    </nav>
  `;

  bindEvents();
}
```javascript
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

        document.querySelector("#aiConfirmForm").onsubmit = async saveEvent => {
          saveEvent.preventDefault();
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

  const weightForm = document.querySelector("#weightForm");

  if (weightForm) {
    weightForm.onsubmit = async event => {
      event.preventDefault();
      const f = new FormData(weightForm);

      const { error } = await supabase
        .from("weight_logs")
        .insert({
          user_id: currentUser.id,
          weight_kg: Number(f.get("weight_kg")),
          logged_at: new Date(
            f.get("logged_at") + "T12:00:00"
          ).toISOString()
        });

      if (error) return showMessage(error.message);

      showMessage("體重已儲存！");
      await showApp();
    };
  }

  const activityForm = document.querySelector("#activityForm");

  if (activityForm) {
    activityForm.onsubmit = async event => {
      event.preventDefault();
      const f = new FormData(activityForm);

      const { error } = await supabase
        .from("activity_logs")
        .insert({
          user_id: currentUser.id,
          activity_type: f.get("activity_type"),
          duration_minutes: Number(f.get("duration_minutes") || 0),
          calories_burned: f.get("calories_burned")
  ? Number(f.get("calories_burned")) : null,
          steps: f.get("steps") ? Number(f.get("steps")) : null,
          logged_at: new Date().toISOString()
        });

      if (error) return showMessage(error.message);

      showMessage("運動紀錄已儲存！");
      await showApp();
    };
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
              
