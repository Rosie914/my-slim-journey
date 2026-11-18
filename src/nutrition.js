
const ACTIVITY_FACTORS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9
};

const ACTIVITY_LABELS = {
  sedentary: "久坐，幾乎沒有運動",
  light: "輕量活動，每週約 1–3 天",
  moderate: "中度活動，每週約 3–5 天",
  active: "高度活動，每週約 6–7 天",
  very_active: "非常高活動量"
};

const GOAL_LABELS = {
  lose: "減脂",
  maintain: "維持體重",
  gain: "增肌"
};

const number = value => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};

const escapeHTML = value =>
  String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);

function calculateAge(birthDate) {
  if (!birthDate) return null;

  const birth = new Date(`${birthDate}T12:00:00`);
  if (Number.isNaN(birth.getTime())) return null;

  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();

  const birthdayPassed =
    now.getMonth() > birth.getMonth() ||
    (now.getMonth() === birth.getMonth() &&
      now.getDate() >= birth.getDate());

  if (!birthdayPassed) age -= 1;

  return age > 0 && age < 120 ? age : null;
}

export function calculateNutrition(profile, currentWeight) {
  const height = number(profile?.height_cm);
  const weight = number(currentWeight);
  const age = calculateAge(profile?.birth_date);
  const sex = profile?.sex;

  const missing = [];

  if (!height) missing.push("身高");
  if (!weight) missing.push("目前體重");
  if (!age) missing.push("出生日期");
  if (!["female", "male"].includes(sex)) missing.push("生理性別");

  if (missing.length) {
    return {
      ready: false,
      missing,
      activityLabel:
        ACTIVITY_LABELS[profile?.activity_level] || "尚未設定",
      goalLabel: GOAL_LABELS[profile?.goal_mode] || "尚未設定"
    };
  }

  // Mifflin-St Jeor equation
  const bmr = Math.round(
    10 * weight +
    6.25 * height -
    5 * age +
    (sex === "male" ? 5 : -161)
  );

  const activity =
    ACTIVITY_FACTORS[profile?.activity_level] || 1.2;

  const tdee = Math.round(bmr * activity);

  const goalMode = profile?.goal_mode || "lose";
  const weeklyChange = Math.max(
    0,
    number(profile?.weekly_change_kg) ?? 0.25
  );

  let calorieTarget = tdee;

  if (goalMode === "lose") {
    const requestedDeficit = weeklyChange * 7700 / 7;
    const deficit = Math.min(requestedDeficit, 500);
    calorieTarget = Math.round(tdee - deficit);
  } else if (goalMode === "gain") {
    calorieTarget = Math.round(tdee + 150);
  }

  // Conservative minimums; individual medical needs may differ.
  const calorieFloor = sex === "female" ? 1200 : 1500;
  calorieTarget = Math.max(calorieFloor, calorieTarget);

  const override = number(profile?.calorie_target_override);
  if (override !== null && override >= calorieFloor) {
    calorieTarget = Math.round(override);
  }

  const proteinDefault = Math.round(weight * 1.6);
  const fatDefault = Math.round(weight * 0.8);

  const proteinOverride = number(profile?.protein_target_g);
  const fatOverride = number(profile?.fat_target_g);
  const carbsOverride = number(profile?.carbs_target_g);

  const protein = Math.max(
    0,
    proteinOverride !== null ? proteinOverride : proteinDefault
  );

  const fat = Math.max(
    0,
    fatOverride !== null ? fatOverride : fatDefault
  );

  const remainingCalories =
    calorieTarget - protein * 4 - fat * 9;

  const calculatedCarbs = Math.max(
    0,
    remainingCalories / 4
  );

  const carbs = Math.max(
    0,
    carbsOverride !== null
      ? carbsOverride
      : Math.round(calculatedCarbs)
  );

  const macroCalories = protein * 4 + carbs * 4 + fat * 9;

  const targetDate = profile?.target_date || null;
  let daysRemaining = null;

  if (targetDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const target = new Date(`${targetDate}T00:00:00`);
    if (!Number.isNaN(target.getTime())) {
      daysRemaining = Math.ceil(
        (target.getTime() - today.getTime()) / 86400000
      );
    }
  }

  return {
    ready: true,
    age,
    bmr,
    tdee,
    calorieTarget,
    protein: Math.round(protein),
    carbs: Math.round(carbs),
    fat: Math.round(fat),
    macroCalories: Math.round(macroCalories),
    goalMode,
    goalLabel: GOAL_LABELS[goalMode] || "自訂目標",
    activityLabel:
      ACTIVITY_LABELS[profile?.activity_level] || "久坐，幾乎沒有運動",
    targetDate,
    daysRemaining,
    currentWeight: weight,
    targetWeight: number(profile?.target_weight_kg),
    targetBodyFat: number(profile?.target_body_fat_pct),
    weeklyChange
  };
}

function progressBar(label, actual, target, unit) {
  const safeActual = Math.max(0, number(actual) ?? 0);
  const safeTarget = Math.max(0, number(target) ?? 0);
  const percent = safeTarget > 0
    ? Math.min(100, safeActual / safeTarget * 100)
    : 0;

  return `
    <div class="nutrition-progress-item">
      <div class="nutrition-progress-label">
        <span>${label}</span>
        <b>${safeActual.toFixed(label === "熱量" ? 0 : 1)} / ${safeTarget.toFixed(label === "熱量" ? 0 : 1)} ${unit}</b>
      </div>
      <div class="nutrition-progress-track">
        <div class="nutrition-progress-fill" style="width:${percent}%"></div>
      </div>
    </div>
  `;
}

export function renderNutritionSummary(profile, currentWeight, totals) {
  const result = calculateNutrition(profile, currentWeight);

  if (!result.ready) {
    return `
      <section class="card nutrition-card">
        <p class="eyebrow">DAILY NUTRITION PLAN</p>
        <h2>設定你的營養目標</h2>
        <p>還需要以下資料，才能計算個人化熱量與營養素：</p>
        <p>${result.missing.map(escapeHTML).join("、")}</p>
        <p class="muted">請到「設定」完成個人資料。</p>
      </section>
    `;
  }

  const actual = totals || {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0
  };

  const remaining = result.calorieTarget -
    (number(actual.calories) ?? 0);

  const dateText = result.daysRemaining === null
    ? "尚未設定目標期限"
    : result.daysRemaining > 0
      ? `距離目標期限 ${result.daysRemaining} 天`
      : result.daysRemaining === 0
        ? "今天是目標期限"
        : `目標期限已過 ${Math.abs(result.daysRemaining)} 天`;

  return `
    <section class="card nutrition-card">
      <p class="eyebrow">DAILY NUTRITION PLAN</p>
      <div class="nutrition-heading">
        <div>
          <h2>${result.calorieTarget.toLocaleString("zh-TW")} kcal</h2>
          <p class="muted">每日建議熱量 · ${result.goalLabel}</p>
        </div>
        <span class="nutrition-goal-tag">${result.goalLabel}</span>
      </div>

      <div class="nutrition-energy">
        <div>
          <span>已攝取</span>
          <b>${Math.round(actual.calories)} kcal</b>
        </div>
        <div>
          <span>${remaining >= 0 ? "剩餘" : "超出"}</span>
          <b>${Math.abs(Math.round(remaining))} kcal</b>
        </div>
      </div>

      ${progressBar("熱量", actual.calories, result.calorieTarget, "kcal")}
      ${progressBar("蛋白質", actual.protein, result.protein, "g")}
      ${progressBar("碳水", actual.carbs, result.carbs, "g")}
      ${progressBar("脂肪", actual.fat, result.fat, "g")}

      <div class="nutrition-detail-grid">
        <div><span>BMR 基礎代謝</span><b>${result.bmr} kcal</b></div>
        <div><span>TDEE 每日總消耗</span><b>${result.tdee} kcal</b></div>
        <div><span>蛋白質目標</span><b>${result.protein} g</b></div>
        <div><span>脂肪目標</span><b>${result.fat} g</b></div>
      </div>

      <p class="muted">${escapeHTML(result.activityLabel)}</p>
      <p class="muted">${escapeHTML(dateText)}</p>

      ${
        result.macroCalories !== result.calorieTarget
          ? `<p class="muted">目前自訂的三大營養素換算熱量為 ${result.macroCalories} kcal，與每日熱量目標不同；可在設定中調整。</p>`
          : ""
      }

      <p class="nutrition-disclaimer">
        數值為公式估算，不是醫療處方。體重變化、活動量及身體狀況不同時，應重新評估。
      </p>
    </section>
  `;
}
