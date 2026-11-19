
import { renderAnalytics, initAnalytics } from "./analytics.js";
import { enhanceHome, enhanceMeals, enhanceReport } from "./improvements.js";
import { renderWeightInsights, renderMealInsights, renderReportInsights } from "./insights.js";
import "./insights.css";
import "./journey-next.css";
import { renderDailyBudget, renderWeightForecast, renderCoachGuidance } from "./journey-next.js";
import "./analytics.css";
import { createClient } from "@supabase/supabase-js";
import { renderNutritionSummary } from "./nutrition.js";
import { renderMealSuite, initMealSuite } from "./meal-suite.js";
import "./meal-suite.css";
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
  // Use the latest recorded weight, or the saved starting weight if no log exists.
  const recordedWeight = Number(latestWeight?.weight_kg);
  const startingWeight = Number(profile?.start_weight_kg);
  const current = Number.isFinite(recordedWeight) && recordedWeight > 0
    ? recordedWeight
    : Number.isFinite(startingWeight) && startingWeight > 0
      ? startingWeight
      : null;
  const usingStartingWeight = !(Number.isFinite(recordedWeight) && recordedWeight > 0);

  const target = stages.length ? Number([...stages].sort((a,b)=>a.target_date.localeCompare(b.target_date)).at(-1).target_weight_kg) : null;

  const activeStage = [...stages].filter(stage => stage.target_date >= today()).sort((a,b)=>a.target_date.localeCompare(b.target_date))[0];

  const stageTarget = activeStage
    ? Number(activeStage.target_weight_kg)
    : target;

  const remaining = current !== null && stageTarget !== null
    ? Math.max(0, current - stageTarget)
    : null;

  const nutritionPanel = renderNutritionSummary({...profile, _stages: stages}, current, totals);
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
      ${usingStartingWeight && current !== null ? '<p class="muted">目前使用個人設定中的起始體重估算；新增體重紀錄後將自動更新。</p>' : ''}
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
      const { data: dailyActual, error: dailyError } = await supabase
        .from("daily_nutrition_actual")
        .select("calories,protein_g,carbs_g,fat_g")
        .eq("user_id", currentUser.id)
        .eq("meal_date", today())
        .maybeSingle();
      if (dailyError) throw dailyError;
      const totals = {
        calories: Number(dailyActual?.calories ?? 0),
        protein: Number(dailyActual?.protein_g ?? 0),
        carbs: Number(dailyActual?.carbs_g ?? 0),
        fat: Number(dailyActual?.fat_g ?? 0)
      };
      content = renderHome(totals);
    }

    if (currentTab === "meals") {
      content = renderMealSuite();
    }

    if (["weight", "activity", "reports", "coach"].includes(currentTab)) {
      content = renderAnalytics(currentTab);
    }

    if (currentTab === "settings") {
      content = `
        <section class="card">
          <h2>個人設定</h2>
          <form id="profileForm">
            <label>顯示名稱<input name="display_name" value="${escapeHTML(profile?.display_name || "")}"></label>
            <label>出生日期<input name="birth_date" type="date" value="${profile?.birth_date ?? ""}" required></label>
            <label>生理性別<select name="sex" required><option value="">請選擇</option><option value="female" ${profile?.sex === "female" ? "selected" : ""}>女性</option><option value="male" ${profile?.sex === "male" ? "selected" : ""}>男性</option></select></label>
            <label>身高（cm）<input name="height_cm" type="number" min="100" max="220" step="0.1" value="${profile?.height_cm ?? ""}" required></label>
            <label>起始體重（kg）<input name="start_weight_kg" type="number" min="25" max="250" step="0.1" value="${profile?.start_weight_kg ?? ""}" required></label>
            <p class="muted">目標體重與期限請在下方「減重階段管理」設定，營養目標會依階段自動計算。</p>
            <label>目標體脂率（%）<input name="target_body_fat_pct" type="number" min="5" max="60" step="0.1" value="${profile?.target_body_fat_pct ?? ""}"></label>
            <label>活動程度<select name="activity_level" required><option value="sedentary" ${profile?.activity_level === "sedentary" ? "selected" : ""}>久坐，幾乎沒有運動</option><option value="light" ${profile?.activity_level === "light" ? "selected" : ""}>輕量活動，每週約 1–3 天</option><option value="moderate" ${profile?.activity_level === "moderate" ? "selected" : ""}>中度活動，每週約 3–5 天</option><option value="active" ${profile?.activity_level === "active" ? "selected" : ""}>高度活動，每週約 6–7 天</option><option value="very_active" ${profile?.activity_level === "very_active" ? "selected" : ""}>非常高活動量</option></select></label>
            <label>管理目標<select name="goal_mode" required><option value="lose" ${(!profile?.goal_mode || profile?.goal_mode === "lose") ? "selected" : ""}>減脂</option><option value="maintain" ${profile?.goal_mode === "maintain" ? "selected" : ""}>維持體重</option><option value="gain" ${profile?.goal_mode === "gain" ? "selected" : ""}>增肌</option></select></label>
            <details><summary>進階設定：自訂營養目標（選填）</summary><p class="muted">留空即自動計算。若以前填過數值，清空後儲存即可恢復自動。</p>
            <label>自訂熱量（kcal）<input name="calorie_target_override" type="number" min="1200" max="5000" step="1" value="${profile?.calorie_target_override ?? ""}"></label>
            <label>蛋白質（g）<input name="protein_target_g" type="number" min="0" max="400" step="1" value="${profile?.protein_target_g ?? ""}"></label>
            <label>碳水（g）<input name="carbs_target_g" type="number" min="0" max="600" step="1" value="${profile?.carbs_target_g ?? ""}"></label>
            <label>脂肪（g）<input name="fat_target_g" type="number" min="0" max="250" step="1" value="${profile?.fat_target_g ?? ""}"></label></details>
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
    initAnalytics(supabase, currentUser.id, currentTab, () => showApp())
      .then(async () => {
        if (currentTab === "reports") {
          await enhanceReport(supabase, currentUser.id);
          await renderReportInsights(supabase, currentUser.id);
        } else if (currentTab === "coach") {
          await renderCoachGuidance(supabase, currentUser.id, {...profile, _stages: stages}, latestWeight);
        } else if (currentTab === "weight") {
          await renderWeightInsights(supabase, currentUser.id, profile);
          await renderWeightForecast(supabase, currentUser.id, profile);
        }
      })
      .catch(error => alert(`載入失敗：${error.message}`));
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
        return value === "" || value === null ? null : Number(value);
      };
      const { error } = await supabase.from("profiles").upsert({
        id: currentUser.id,
        display_name: f.get("display_name"),
        birth_date: f.get("birth_date") || null,
        sex: f.get("sex"),
        height_cm: Number(f.get("height_cm")),
        start_weight_kg: Number(f.get("start_weight_kg")),
        target_weight_kg: Number(stages.length ? [...stages].sort((a,b)=>a.target_date.localeCompare(b.target_date)).at(-1).target_weight_kg : (profile?.target_weight_kg ?? f.get("start_weight_kg"))),
        target_body_fat_pct: optionalNumber("target_body_fat_pct"),
        activity_level: f.get("activity_level"),
        goal_mode: f.get("goal_mode"),
        target_date: profile?.target_date || null,
        weekly_change_kg: profile?.weekly_change_kg ?? null,
        calorie_target_override: optionalNumber("calorie_target_override"),
        protein_target_g: optionalNumber("protein_target_g"),
        carbs_target_g: optionalNumber("carbs_target_g"),
        fat_target_g: optionalNumber("fat_target_g"),
        updated_at: new Date().toISOString()
      }, { onConflict: "id" });

      if (error) return showMessage("儲存失敗：" + error.message);
      const {data: verified, error: verifyError} = await supabase.from("profiles")
        .select("birth_date,sex,height_cm,start_weight_kg").eq("id",currentUser.id).single();
      if (verifyError || verified?.birth_date !== f.get("birth_date") || verified?.sex !== f.get("sex")) {
        return showMessage("儲存後驗證失敗，請重新整理再試；若持續發生請回報。");
      }
      showMessage("個人設定已儲存並驗證成功！");

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
        target_weight_kg: Number(stages.length ? [...stages].sort((a,b)=>a.target_date.localeCompare(b.target_date)).at(-1).target_weight_kg : (profile?.target_weight_kg ?? f.get("start_weight_kg"))),
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

  if (currentTab === "meals") {
    initMealSuite(supabase, currentUser.id, () => renderMealInsights(supabase, currentUser.id, profile, latestWeight));
    enhanceMeals();
    renderMealInsights(supabase, currentUser.id, profile, latestWeight).catch(console.error);
  }

  if (currentTab === "home") {
    const effectiveWeight = latestWeight?.weight_kg != null && Number(latestWeight.weight_kg) > 0
      ? latestWeight
      : profile?.start_weight_kg != null && Number(profile.start_weight_kg) > 0
        ? { weight_kg: Number(profile.start_weight_kg), logged_at: null }
        : null;
    enhanceHome(supabase, currentUser.id, profile, effectiveWeight)
      .then(() => renderDailyBudget(supabase, currentUser.id, {...profile, _stages: stages}, effectiveWeight))
      .catch(console.error);
  }}

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
