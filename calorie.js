const calorieForm = document.getElementById("calorie-form");
const calorieDatetimeInput = document.getElementById("calorie-datetime");
const calorieAmountInput = document.getElementById("calorie-amount");
const calorieMemoInput = document.getElementById("calorie-memo");
const calorieStatusMessage = document.getElementById("calorie-status-message");
const calorieTodayTotal = document.getElementById("calorie-today-total");
const calorieTodayList = document.getElementById("calorie-today-list");
const goalHintDisplay = document.getElementById("goal-hint");

function nowForDatetimeLocalInput() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

calorieDatetimeInput.value = nowForDatetimeLocalInput();

calorieForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  calorieStatusMessage.textContent = "保存中...";

  const { error } = await sb.from("calorie_records").insert({
    recorded_at: new Date(calorieDatetimeInput.value).toISOString(),
    amount: Number(calorieAmountInput.value),
    memo: calorieMemoInput.value,
  });

  if (error) {
    calorieStatusMessage.textContent = `保存に失敗しました: ${error.message}`;
    console.error(error);
    return;
  }

  calorieStatusMessage.textContent = "記録しました！";
  calorieAmountInput.value = "";
  calorieMemoInput.value = "";
  calorieDatetimeInput.value = nowForDatetimeLocalInput();
  loadTodayCalories();
});

async function loadTodayCalories() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const { data, error } = await sb
    .from("calorie_records")
    .select("*")
    .gte("recorded_at", startOfDay.toISOString())
    .lte("recorded_at", endOfDay.toISOString())
    .order("recorded_at", { ascending: false });

  if (error) {
    calorieStatusMessage.textContent = `読み込みに失敗しました: ${error.message}`;
    console.error(error);
    return;
  }

  renderTodayCalories(data);
}

function renderTodayCalories(records) {
  const total = records.reduce((sum, r) => sum + r.amount, 0);
  calorieTodayTotal.textContent = total;

  calorieTodayList.innerHTML = "";

  if (records.length === 0) {
    calorieTodayList.innerHTML = "<li>まだ記録がありません</li>";
    return;
  }

  for (const record of records) {
    const li = document.createElement("li");
    const time = new Date(record.recorded_at).toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const sign = record.amount > 0 ? "+" : "";
    li.innerHTML = `
      <div class="record-content">
        <span class="record-date">${time}</span>
        <span class="record-weight"> — ${sign}${record.amount} kcal</span>
        ${record.memo ? `<span class="record-memo">${record.memo}</span>` : ""}
      </div>
      <div class="record-actions">
        <button type="button" class="small-btn delete-btn">削除</button>
      </div>
    `;

    li.querySelector(".delete-btn").addEventListener("click", () => deleteCalorieRecord(record.id));

    calorieTodayList.appendChild(li);
  }
}

async function deleteCalorieRecord(id) {
  const { error } = await sb.from("calorie_records").delete().eq("id", id);

  if (error) {
    calorieStatusMessage.textContent = `削除に失敗しました: ${error.message}`;
    console.error(error);
    return;
  }

  loadTodayCalories();
}

// weight.js が読み込み終わったタイミングで、目標体重達成に必要な今日の収支を計算する。
// (userSettings / weightAsOf / bmrForDay は weight.js で定義されるグローバル)
function updateGoalHint() {
  const todayStr = new Date().toISOString().slice(0, 10);

  if (!userSettings?.goal_weight || !userSettings?.goal_date) {
    goalHintDisplay.textContent = "-";
    return;
  }

  const today = new Date();
  const goalDate = new Date(`${userSettings.goal_date}T00:00:00`);
  const remainingDays = Math.ceil((goalDate - today) / (1000 * 60 * 60 * 24));

  if (remainingDays <= 0) {
    goalHintDisplay.textContent = "目標日を過ぎています";
    return;
  }

  const currentWeight = weightAsOf(todayStr);
  if (!hasCompleteProfile() || currentWeight == null) {
    goalHintDisplay.textContent = "-";
    return;
  }

  const kcalPerKg = userSettings.kcal_per_kg || 7200;
  const remainingKg = currentWeight - userSettings.goal_weight;
  const requiredDailyDeficit = (remainingKg * kcalPerKg) / remainingDays;
  const targetNet = Math.round(bmrForDay(todayStr) - requiredDailyDeficit);

  goalHintDisplay.textContent = `${targetNet} kcal以下`;
}

window.addEventListener("app:authenticated", loadTodayCalories);
window.addEventListener("app:weightDataLoaded", updateGoalHint);
