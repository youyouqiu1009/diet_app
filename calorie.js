const calorieForm = document.getElementById("calorie-form");
const calorieDatetimeInput = document.getElementById("calorie-datetime");
const calorieAmountInput = document.getElementById("calorie-amount");
const calorieMemoInput = document.getElementById("calorie-memo");
const calorieStatusMessage = document.getElementById("calorie-status-message");
const calorieListDateLabel = document.getElementById("calorie-list-date-label");
const calorieTodayTotal = document.getElementById("calorie-today-total");
const calorieTodayList = document.getElementById("calorie-today-list");
const calorieHistoryBtn = document.getElementById("calorie-history-btn");
const goalHintDisplay = document.getElementById("goal-hint");

function nowForDatetimeLocalInput() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function todayDateStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
  loadCaloriesForSelectedDate();
  loadWeightData();
});

calorieDatetimeInput.addEventListener("change", loadCaloriesForSelectedDate);

function formatListDateLabel(dateStr) {
  if (dateStr === todayDateStr()) return "今日";
  const [, month, day] = dateStr.split("-");
  return `${Number(month)}/${Number(day)}`;
}

async function loadCaloriesForSelectedDate() {
  const dateStr = calorieDatetimeInput.value.slice(0, 10) || todayDateStr();
  calorieListDateLabel.textContent = formatListDateLabel(dateStr);

  const startOfDay = new Date(`${dateStr}T00:00:00`);
  const endOfDay = new Date(`${dateStr}T23:59:59.999`);

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

  renderCalorieList(data);
}

function buildCalorieListItem(record, { showDate, onDeleted, onError }) {
  const li = document.createElement("li");
  const recordedAt = new Date(record.recorded_at);
  const time = recordedAt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  const dateLabel = showDate
    ? `${recordedAt.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })} ${time}`
    : time;
  const sign = record.amount > 0 ? "+" : "";

  li.innerHTML = `
    <div class="record-content">
      <span class="record-date">${dateLabel}</span>
      <span class="record-weight"> — ${sign}${record.amount} kcal</span>
      ${record.memo ? `<span class="record-memo">${record.memo}</span>` : ""}
    </div>
    <div class="record-actions">
      <button type="button" class="small-btn delete-btn">削除</button>
    </div>
  `;

  li.querySelector(".delete-btn").addEventListener("click", async () => {
    const { error } = await sb.from("calorie_records").delete().eq("id", record.id);
    if (error) {
      console.error(error);
      onError?.(error);
      return;
    }
    onDeleted();
    loadWeightData();
  });

  return li;
}

function renderCalorieList(records) {
  const total = records.reduce((sum, r) => sum + r.amount, 0);
  calorieTodayTotal.textContent = total;

  calorieTodayList.innerHTML = "";

  if (records.length === 0) {
    calorieTodayList.innerHTML = "<li>まだ記録がありません</li>";
    return;
  }

  for (const record of records) {
    calorieTodayList.appendChild(
      buildCalorieListItem(record, {
        showDate: false,
        onDeleted: loadCaloriesForSelectedDate,
        onError: (error) => {
          calorieStatusMessage.textContent = `削除に失敗しました: ${error.message}`;
        },
      })
    );
  }
}

calorieHistoryBtn.addEventListener("click", openCalorieHistoryModal);

async function openCalorieHistoryModal() {
  openModal("カロリー記録一覧");

  const { data, error } = await sb.from("calorie_records").select("*").order("recorded_at", { ascending: false });

  if (error) {
    modalList.innerHTML = `<li>読み込みに失敗しました: ${error.message}</li>`;
    console.error(error);
    return;
  }

  modalList.innerHTML = "";

  if (data.length === 0) {
    modalList.innerHTML = "<li>まだ記録がありません</li>";
    return;
  }

  for (const record of data) {
    modalList.appendChild(
      buildCalorieListItem(record, {
        showDate: true,
        onDeleted: () => {
          openCalorieHistoryModal();
          loadCaloriesForSelectedDate();
        },
      })
    );
  }
}

// weight.js が読み込み終わったタイミングで、目標体重達成に必要な今日の収支を計算する。
// (userSettings / weightAsOf / bmrForDay は weight.js で定義されるグローバル)
function updateGoalHint() {
  const todayStr = todayDateStr();

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

window.addEventListener("app:authenticated", loadCaloriesForSelectedDate);
window.addEventListener("app:weightDataLoaded", updateGoalHint);
