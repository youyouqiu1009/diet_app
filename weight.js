const form = document.getElementById("record-form");
const dateInput = document.getElementById("date");
const weightInput = document.getElementById("weight");
const statusMessage = document.getElementById("status-message");
const recordList = document.getElementById("record-list");
const chartCanvas = document.getElementById("weight-chart");
const rangeButtons = document.querySelectorAll(".range-btn");

const settingsForm = document.getElementById("settings-form");
const genderInput = document.getElementById("setting-gender");
const birthDateInput = document.getElementById("setting-birth-date");
const heightInput = document.getElementById("setting-height");
const goalWeightInput = document.getElementById("setting-goal-weight");
const goalDateInput = document.getElementById("setting-goal-date");
const kcalPerKgInput = document.getElementById("setting-kcal-per-kg");
const settingsMessage = document.getElementById("settings-message");
const currentBmrDisplay = document.getElementById("current-bmr");
const currentBaselineDisplay = document.getElementById("current-baseline");
const totalDeficitDisplay = document.getElementById("total-deficit");

let weightChart = null;
let weightRecords = [];
let weightRecordsAsc = []; // 体重が入っている記録のみ、日付昇順
let calorieDailyNet = {}; // "YYYY-MM-DD" -> その日のカロリー収支合計 (摂取 + 消費(負の値))
let userSettings = null;
let currentRangeDays = 30;

dateInput.value = new Date().toISOString().slice(0, 10);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  statusMessage.textContent = "保存中...";

  const { error } = await sb.from("diet_records").insert({
    date: dateInput.value,
    weight: weightInput.value ? Number(weightInput.value) : null,
  });

  if (error) {
    statusMessage.textContent = `保存に失敗しました: ${error.message}`;
    console.error(error);
    return;
  }

  statusMessage.textContent = "保存しました！";
  weightInput.value = "";
  loadWeightData();
});

rangeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    rangeButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentRangeDays = Number(btn.dataset.range);
    renderChart();
  });
});

settingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  settingsMessage.textContent = "保存中...";

  const { error } = await sb.from("user_settings").upsert({
    gender: genderInput.value,
    birth_date: birthDateInput.value || null,
    height_cm: heightInput.value ? Number(heightInput.value) : null,
    goal_weight: goalWeightInput.value ? Number(goalWeightInput.value) : null,
    goal_date: goalDateInput.value || null,
    kcal_per_kg: kcalPerKgInput.value ? Number(kcalPerKgInput.value) : 7200,
  });

  if (error) {
    settingsMessage.textContent = `保存に失敗しました: ${error.message}`;
    console.error(error);
    return;
  }

  settingsMessage.textContent = "設定を保存しました！";
  loadWeightData();
});

async function loadSettings() {
  const { data, error } = await sb.from("user_settings").select("*").maybeSingle();

  if (error) {
    console.error(error);
    return;
  }

  userSettings = data;

  if (data) {
    genderInput.value = data.gender || "male";
    birthDateInput.value = data.birth_date || "";
    heightInput.value = data.height_cm ?? "";
    goalWeightInput.value = data.goal_weight ?? "";
    goalDateInput.value = data.goal_date || "";
    kcalPerKgInput.value = data.kcal_per_kg ?? 7200;
  }
}

async function loadWeightData() {
  await loadSettings();

  const [weightResult, calorieResult] = await Promise.all([
    sb.from("diet_records").select("*").order("date", { ascending: false }),
    sb.from("calorie_records").select("*"),
  ]);

  if (weightResult.error) {
    statusMessage.textContent = `読み込みに失敗しました: ${weightResult.error.message}`;
    console.error(weightResult.error);
    return;
  }

  weightRecords = weightResult.data;
  weightRecordsAsc = weightRecords
    .filter((r) => r.weight != null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  calorieDailyNet = {};
  if (calorieResult.error) {
    console.error(calorieResult.error);
  } else {
    for (const record of calorieResult.data) {
      const day = record.recorded_at.slice(0, 10);
      calorieDailyNet[day] = (calorieDailyNet[day] || 0) + record.amount;
    }
  }

  // まだ基準が無ければ、一番古い体重記録を自動的に基準にする
  const needsBaseline = (!userSettings || userSettings.baseline_weight == null) && weightRecordsAsc.length > 0;
  if (needsBaseline) {
    const first = weightRecordsAsc[0];
    const { error } = await sb.from("user_settings").upsert({
      baseline_weight: first.weight,
      baseline_date: first.date,
    });
    if (!error) {
      userSettings = { ...(userSettings || {}), baseline_weight: first.weight, baseline_date: first.date };
    }
  }

  renderList(weightRecords);
  renderSettingsSummary();
  renderChart();

  window.dispatchEvent(new CustomEvent("app:weightDataLoaded"));
}

function renderList(records) {
  recordList.innerHTML = "";

  if (records.length === 0) {
    recordList.innerHTML = "<li>まだ記録がありません</li>";
    return;
  }

  for (const record of records) {
    const li = document.createElement("li");
    const weightText = record.weight != null ? `${record.weight} kg` : "-";
    li.innerHTML = `
      <div class="record-content">
        <span class="record-date">${record.date}</span>
        <span class="record-weight"> — ${weightText}</span>
      </div>
      <div class="record-actions">
        <button type="button" class="small-btn baseline-btn">これを基準にする</button>
        <button type="button" class="small-btn delete-btn">削除</button>
      </div>
    `;

    li.querySelector(".baseline-btn").addEventListener("click", () => setBaseline(record));
    li.querySelector(".delete-btn").addEventListener("click", () => deleteWeightRecord(record.id));

    recordList.appendChild(li);
  }
}

async function setBaseline(record) {
  settingsMessage.textContent = "基準を変更中...";

  const { error } = await sb.from("user_settings").upsert({
    baseline_weight: record.weight,
    baseline_date: record.date,
  });

  if (error) {
    settingsMessage.textContent = `基準の変更に失敗しました: ${error.message}`;
    console.error(error);
    return;
  }

  settingsMessage.textContent = "基準を変更しました！";
  loadWeightData();
}

async function deleteWeightRecord(id) {
  const { error } = await sb.from("diet_records").delete().eq("id", id);

  if (error) {
    statusMessage.textContent = `削除に失敗しました: ${error.message}`;
    console.error(error);
    return;
  }

  loadWeightData();
}

function calculateAge(birthDateStr, onDate) {
  const birth = new Date(`${birthDateStr}T00:00:00`);
  let age = onDate.getFullYear() - birth.getFullYear();
  const hadBirthdayThisYear =
    onDate.getMonth() > birth.getMonth() ||
    (onDate.getMonth() === birth.getMonth() && onDate.getDate() >= birth.getDate());
  if (!hadBirthdayThisYear) age--;
  return age;
}

function calculateBmr(weightKg, heightCm, age, gender) {
  if (weightKg == null || heightCm == null || age == null) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return gender === "female" ? base - 161 : base + 5;
}

function hasCompleteProfile() {
  return Boolean(userSettings?.height_cm && userSettings?.birth_date && userSettings?.gender);
}

// dayStr(YYYY-MM-DD)以前で最新の体重記録を返す。無ければ基準体重、それも無ければnull
function weightAsOf(dayStr) {
  let result = userSettings?.baseline_weight ?? null;
  for (const r of weightRecordsAsc) {
    if (r.date > dayStr) break;
    result = r.weight;
  }
  return result;
}

function bmrForDay(dayStr) {
  if (!userSettings?.height_cm || !userSettings?.birth_date || !userSettings?.gender) return 0;
  const weight = weightAsOf(dayStr);
  if (weight == null) return 0;
  const age = calculateAge(userSettings.birth_date, new Date(`${dayStr}T00:00:00`));
  return calculateBmr(weight, userSettings.height_cm, age, userSettings.gender) ?? 0;
}

// fromDateStr から toDateStr までの日ごとの累積収支(基礎代謝+運動消費-摂取)を計算する。
// カロリー記録が1件も無い日は計算に含めず、前日までの累計をそのまま維持する。
function buildCumulativeDeficitMap(fromDateStr, toDateStr) {
  const map = {};
  let cumulative = 0;
  const cursor = new Date(`${fromDateStr}T00:00:00`);
  const end = new Date(`${toDateStr}T00:00:00`);

  while (cursor <= end) {
    const dayStr = cursor.toISOString().slice(0, 10);
    if (Object.prototype.hasOwnProperty.call(calorieDailyNet, dayStr)) {
      const net = calorieDailyNet[dayStr];
      cumulative += bmrForDay(dayStr) - net;
    }
    map[dayStr] = cumulative;
    cursor.setDate(cursor.getDate() + 1);
  }

  return map;
}

function firstCalorieDateStr() {
  const days = Object.keys(calorieDailyNet);
  if (days.length === 0) return null;
  return days.sort()[0];
}

function renderSettingsSummary() {
  const todayStr = new Date().toISOString().slice(0, 10);

  const latestWeight = weightAsOf(todayStr);
  if (hasCompleteProfile() && latestWeight != null) {
    const age = calculateAge(userSettings.birth_date, new Date());
    const bmr = calculateBmr(latestWeight, userSettings.height_cm, age, userSettings.gender);
    currentBmrDisplay.textContent = Math.round(bmr);
  } else {
    currentBmrDisplay.textContent = "-";
  }

  if (userSettings?.baseline_weight != null && userSettings?.baseline_date) {
    currentBaselineDisplay.textContent = `${userSettings.baseline_weight} kg (${userSettings.baseline_date})`;
  } else {
    currentBaselineDisplay.textContent = "-";
  }

  const firstDay = firstCalorieDateStr();
  if (firstDay) {
    const map = buildCumulativeDeficitMap(firstDay, todayStr);
    totalDeficitDisplay.textContent = Math.round(map[todayStr]);
  } else {
    totalDeficitDisplay.textContent = "-";
  }
}

function formatMonthDay(dateStr) {
  const [, month, day] = dateStr.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function renderChart() {
  const today = new Date();
  const dateKeys = [];
  for (let i = currentRangeDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dateKeys.push(d.toISOString().slice(0, 10));
  }
  const chartLabels = dateKeys.map(formatMonthDay);

  const weightByDate = {};
  for (const r of weightRecords) {
    if (r.weight != null) weightByDate[r.date] = r.weight;
  }
  const actualWeights = dateKeys.map((d) => weightByDate[d] ?? null);

  let theoreticalWeights = dateKeys.map(() => null);

  if (userSettings?.baseline_weight != null && userSettings?.baseline_date) {
    const todayStr = today.toISOString().slice(0, 10);
    const kcalPerKg = userSettings.kcal_per_kg || 7200;
    const deficitMap = buildCumulativeDeficitMap(userSettings.baseline_date, todayStr);

    theoreticalWeights = dateKeys.map((d) => {
      if (d < userSettings.baseline_date) return null;
      const cumulative = deficitMap[d];
      if (cumulative === undefined) return null;
      return Math.round((userSettings.baseline_weight - cumulative / kcalPerKg) * 10) / 10;
    });
  }

  const datasets = [
    {
      label: "体重 (kg)",
      data: actualWeights,
      borderColor: "#f28c8f",
      backgroundColor: "rgba(242, 140, 143, 0.15)",
      tension: 0.3,
      spanGaps: true,
    },
    {
      label: "理論体重 (kg)",
      data: theoreticalWeights,
      borderColor: "#9b8fb0",
      backgroundColor: "rgba(155, 143, 176, 0.1)",
      borderDash: [6, 4],
      tension: 0.3,
      spanGaps: true,
    },
  ];

  if (weightChart) {
    weightChart.data.labels = chartLabels;
    weightChart.data.datasets = datasets;
    weightChart.update();
    return;
  }

  weightChart = new Chart(chartCanvas, {
    type: "line",
    data: { labels: chartLabels, datasets },
    options: {
      responsive: true,
      scales: {
        y: { beginAtZero: false },
      },
    },
  });
}

window.addEventListener("app:authenticated", loadWeightData);
