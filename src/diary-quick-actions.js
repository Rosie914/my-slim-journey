// Quick access to the existing diary flows. All writes continue through meal-suite.js.
// No duplicate Supabase mutations or client-side calorie calculations.
export function mountDiaryQuickActions() {
  const diary = document.getElementById("mealDiary");
  const overview = diary?.querySelector(".diary-overview");
  if (!overview || overview.querySelector("#msjDiaryQuick")) return;

  const host = document.createElement("section");
  host.id = "msjDiaryQuick";
  host.className = "msj-diary-quick";
  host.setAttribute("aria-label", "快速記錄飲食");
  host.innerHTML = `
    <div class="msj-diary-quick-heading">
      <div><strong>快速複製餐點</strong><small>使用之前的紀錄，不用重複輸入</small></div>
    </div>
    <div class="msj-diary-quick-grid">
      <button type="button" data-msj-quick="yesterday"><span aria-hidden="true">↶</span><b>複製昨日</b><small>挑選昨天吃過的餐點</small></button>
      <button type="button" data-msj-quick="recent"><span aria-hidden="true">◷</span><b>最近一餐</b><small>快速複製上一餐</small></button>
    </div>
    <p class="msj-diary-quick-note" role="status" aria-live="polite" hidden></p>`;
  const summary = overview.querySelector("#diarySummary");
  if (summary) overview.insertBefore(host, summary);
  else overview.append(host);

  const note = host.querySelector(".msj-diary-quick-note");
  const inform = message => { note.textContent = message; note.hidden = false; };
  host.addEventListener("click", event => {
    const button = event.target.closest("[data-msj-quick]");
    if (!button) return;
    note.hidden = true;
    const action = button.dataset.msjQuick;
    const target = diary.querySelector(action === "yesterday" ? "#diaryCopyYesterday" : "#diaryCopyRecent");
    if (!target || target.disabled) return inform("資料載入中，請稍後再試。");
    if (target.hidden) return inform("請先選擇今天或過去的日期，再複製昨日餐點。");
    target.click();
  });
}
