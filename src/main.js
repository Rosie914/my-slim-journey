
import { createClient } from "@supabase/supabase-js";
import "./style.css";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const app = document.querySelector("#app");

let currentUser = null;
let currentTab = "home";

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

  document.querySelector("#loginForm").onsubmit =
    async (event) => {
      event.preventDefault();

      const form = new FormData(event.target);

      const { error } =
        await supabase.auth.signInWithPassword({
          email: form.get("email"),
          password: form.get("password")
        });

      if (error) {
        document.querySelector("#message").textContent =
          error.message;
      } else {
        await refresh();
      }
    };

  document.querySelector("#signup").onclick =
    async () => {
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

async function showApp() {
  if (!currentUser) return showLogin();

  let content = "";

  try {
    if (currentTab === "home") {
      const meals = await getRows("meals", "eaten_at");
      const today = new Date().toISOString().slice(0, 10);

      const todaysMeals = meals.filter(
        meal => meal.eaten_at.slice(0, 10) === today
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

      content = `
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
          <h3>今日目標</h3>
          <p>持續記錄，觀察長期變化。</p>
          <p class="muted">尚未連接 Apple Health，暫不計算總消耗及熱量赤字。</p>
        </section>
      `;
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
          <form id="weightForm">
            <label>體重 kg
              <input name="weight_kg" type="number"
                min="25" max="250" step="0.1" required>
            </label>
            <label>日期
              <input name="logged_at" type="date"
                value="${new Date().toLocaleDateString("en-CA")}" required>
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
  } catch (error) {
    content = `<section class="card">讀取失敗：${escapeHTML(error.message)}</section>`;
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

      if (error) return alert(error.message);

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

      if (itemError) alert(itemError.message);
      else {
        alert("飲食紀錄已儲存！");
        showApp();
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

      if (error) alert(error.message);
      else {
        alert("體重已儲存！");
        showApp();
      }
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

      if (error) alert(error.message);
      else {
        alert("運動紀錄已儲存！");
        showApp();
      }
    };
  }
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char =>
    ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char])
  );
}

async function refresh() {
  const { data } = await supabase.auth.getSession();
  currentUser = data.session?.user || null;
  showApp();
}

supabase.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user || null;
  showApp();
});

refresh();
