
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
             <p>距離階段目標：${remaining.toFixed(1)} kg</p>
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
          <h2>新增飲食</h2>
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
      `;
    }

    if (currentTab === "weight") {
      content = `
        <section class="card">
          <h2>體重紀錄</h2>
          <p>最近體重：${
            latestWeight
              ? Number(latestWeight.weight_kg).toFixed(1) + " kg"
              : "尚未紀錄"
          }</p>
          <form id="weightForm">
            <label>體重 kg
              <input name="weight_kg" type="number"
                min="25" max="250" step="0.1" required>
            </label>
            <label>日期
              <input name="logged_at" type="date"
                value="${today()}" required>
            </label>
            <button type="submit">儲存體重</button>
          </form>
        </section>
      `;
    }

    if (currentTab === "activity") {
      content = `
        <section class="card">
          <h2>運動紀錄</h2>
          <form id="activityForm">
            <label>運動類型
              <input name="activity_type" required placeholder="例如：飛輪">
            </label>
            <label>運動時間（分鐘）
              <input name="duration_minutes" type="number" min="0" value="30">
            </label>
            <label>活動熱量 kcal（選填）
              <input name="calories_burned" type="number" min="0">
            </label>
            <label>步數（選填）
              <input name="steps" type="number" min="0">
            </label>
            <button type="submit">儲存運動</button>
          </form>
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
                value="${escapeHTML(profile?.display_name || "")}"
                placeholder="輸入名稱">
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
      <button data-tab="settings">設定</button>
    </nav>
  `;

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

      const { error } = await supabase
        .from("profiles")
        .upsert({
          id: currentUser.id,
          display_name: f.get("display_name"),
          height_cm: Number(f.get("height_cm")),
          start_weight_kg: Number(f.get("start_weight_kg")),
          target_weight_kg: Number(f.get("target_weight_kg")),
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
