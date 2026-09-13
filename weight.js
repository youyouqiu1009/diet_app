const form = document.getElementById("record-form");
const dateInput = document.getElementById("date");
const weightInput = document.getElementById("weight");
const statusMessage = document.getElementById("status-message");
const weightHistoryBtn = document.getElementById("weight-history-btn");
const chartCanvas = document.getElementById("weight-chart");
const rangeButtons = document.querySelectorAll(".range-btn");

const settingsForm = document.getElementById("settings-form");
const genderInput = document.getElementById("setting-gender");
const birthDateInput = document.getElementById("setting-birth-date");
const heightInput = document.getElementById("setting-height");
const activityFactorInput = document.getElementById("setting-activity-factor");
const goalWeightInput = document.getElementById("setting-goal-weight");
const goalDateInput = document.getElementById("setting-goal-date");
const kcalPerKgInput = document.getElementById("setting-kcal-per-kg");
const settingsMessage = document.getElementById("settings-message");
const currentBmrDisplay = document.getElementById("current-bmr");
const currentBaselineDisplay = document.getElementById("current-baseline");
const currentGoalDisplay = document.getElementById("current-goal");
const totalDeficitDisplay = document.getElementById("total-deficit");
const progressChartCanvas = document.getElementById("progress-chart");
const progressLabel = document.getElementById("progress-label");
const achievementList = document.getElementById("achievement-list");
const achievementMessage = document.getElementById("achievement-message");

let weightChart = null;
let progressChart = null;
let weightRecords = [];
let weightRecordsAsc = []; // 体重が入っている記録のみ、日付昇順
let calorieDailyNet = {}; // "YYYY-MM-DD" -> その日のカロリー収支合計 (摂取 + 消費(負の値))
let userSettings = null;
let currentRangeDays = 14;
let weightHistoryModalOpen = false;

// Date を "YYYY-MM-DD" にする。toISOString() はUTCに変換されてしまい、
// 日本時間の日付とずれる（特に午前9時より前）ため、ローカルの年月日から組み立てる。
function formatLocalDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

dateInput.value = formatLocalDateStr(new Date());

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
    activity_factor: Number(activityFactorInput.value) || 1.2,
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
    return false;
  }

  userSettings = data;

  if (data) {
    genderInput.value = data.gender || "male";
    birthDateInput.value = data.birth_date || "";
    heightInput.value = data.height_cm ?? "";
    activityFactorInput.value = data.activity_factor ?? 1.2;
    goalWeightInput.value = data.goal_weight ?? "";
    goalDateInput.value = data.goal_date || "";
    kcalPerKgInput.value = data.kcal_per_kg ?? 7200;
  }
  return true;
}

async function loadWeightData() {
  if (!await loadSettings()) return;

  const [weightResult, calorieResult] = await Promise.all([
    sb.from("diet_records").select("*").order("date", { ascending: false }),
    sb.from("calorie_records").select("*"),
  ]);

  const loadError = weightResult.error || calorieResult.error;
  if (loadError) {
    statusMessage.textContent = `読み込みに失敗しました: ${loadError.message}`;
    console.error(loadError);
    return;
  }

  weightRecords = weightResult.data;
  weightRecordsAsc = weightRecords
    .filter((r) => r.weight != null)
    .sort(compareWeightRecords);

  calorieDailyNet = {};
  for (const record of calorieResult.data) {
    const day = formatLocalDateStr(new Date(record.recorded_at));
    calorieDailyNet[day] = (calorieDailyNet[day] || 0) + record.amount;
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

  renderSettingsSummary();
  renderChart();
  if (weightHistoryModalOpen) renderWeightHistoryModal();

  window.dispatchEvent(new CustomEvent("app:weightDataLoaded"));
  await syncAchievements();
}

weightHistoryBtn.addEventListener("click", () => {
  weightHistoryModalOpen = true;
  openModal("体重記録一覧");
  renderWeightHistoryModal();
});

window.addEventListener("modal:closed", () => {
  weightHistoryModalOpen = false;
});

function renderWeightHistoryModal() {
  modalList.innerHTML = "";

  if (weightRecords.length === 0) {
    modalList.innerHTML = "<li>まだ記録がありません</li>";
    return;
  }

  for (const record of weightRecords) {
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

    modalList.appendChild(li);
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

// その日の推定消費カロリー(TDEE) = 基礎代謝 × 活動量係数
function tdeeForDay(dayStr) {
  if (!userSettings?.height_cm || !userSettings?.birth_date || !userSettings?.gender) return 0;
  const weight = weightAsOf(dayStr);
  if (weight == null) return 0;
  const age = calculateAge(userSettings.birth_date, new Date(`${dayStr}T00:00:00`));
  const bmr = calculateBmr(weight, userSettings.height_cm, age, userSettings.gender) ?? 0;
  return bmr * (userSettings.activity_factor || 1.2);
}

// fromDateStr から toDateStr までの日ごとの累積収支(基礎代謝+運動消費-摂取)を計算する。
// カロリー記録が1件も無い日は計算に含めず、前日までの累計をそのまま維持する。
function buildCumulativeDeficitMap(fromDateStr, toDateStr) {
  const map = {};
  let cumulative = 0;
  const cursor = new Date(`${fromDateStr}T00:00:00`);
  const end = new Date(`${toDateStr}T00:00:00`);

  while (cursor <= end) {
    const dayStr = formatLocalDateStr(cursor);
    if (Object.prototype.hasOwnProperty.call(calorieDailyNet, dayStr)) {
      const net = calorieDailyNet[dayStr];
      cumulative += tdeeForDay(dayStr) - net;
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

function lastCompletedDateStr() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return formatLocalDateStr(yesterday);
}

// グラフ・目標達成ライン・達成判定で共通の、丸め前の理論体重。
// 昨日までの日別収支を反映し、今日の点には昨日の値を暫定的に引き継ぐ。
function buildTheoreticalWeightMap(toDateStr) {
  if (!hasCompleteProfile() || userSettings?.baseline_weight == null || !userSettings?.baseline_date) {
    return {};
  }
  const todayStr = formatLocalDateStr(new Date());
  const yesterdayStr = lastCompletedDateStr();
  const endDateStr = toDateStr < yesterdayStr ? toDateStr : yesterdayStr;
  const kcalPerKg = userSettings.kcal_per_kg || 7200;
  const deficitMap = buildCumulativeDeficitMap(userSettings.baseline_date, endDateStr);
  const weights = Object.fromEntries(Object.entries(deficitMap).map(([day, deficit]) => [
    day, userSettings.baseline_weight - deficit / kcalPerKg,
  ]));
  if (toDateStr >= todayStr && userSettings.baseline_date <= todayStr) {
    // 基準日が今日なら、まだ確定した収支が無いため基準体重を表示する。
    weights[todayStr] = weights[yesterdayStr] ?? Number(userSettings.baseline_weight);
  }
  return weights;
}

function theoreticalWeightAsOf(dayStr) {
  return buildTheoreticalWeightMap(dayStr)[dayStr] ?? null;
}

// 同じ日の複数記録も、作成日時・IDの順に並べて連続達成を判定する。
function compareWeightRecords(a, b) {
  return a.date.localeCompare(b.date) ||
    String(a.created_at || "").localeCompare(String(b.created_at || "")) ||
    String(a.id ?? "").localeCompare(String(b.id ?? ""), "en", { numeric: true });
}

function firstActualGoalRecord(requiredCount) {
  const endDate = lastCompletedDateStr();
  let streak = 0;
  for (const record of [...weightRecordsAsc].sort(compareWeightRecords)) {
    const weight = Number(record.weight);
    if (record.date < userSettings.baseline_date || record.date > endDate ||
        record.weight == null || !Number.isFinite(weight) || weight <= 0) continue;
    streak = weight <= userSettings.goal_weight ? streak + 1 : 0;
    if (streak === requiredCount) return record;
  }
  return null;
}

function isActualStreakAchievement(achievement) {
  if (achievement.achievement_type !== "actual") return false;
  try {
    const key = JSON.parse(achievement.goal_key);
    return Array.isArray(key) && key[key.length - 1] === "streak7";
  } catch {
    return false;
  }
}

// 初到達・7記録連続到達を別の履歴として保存する。
function currentGoalAchievement(type = "theoretical") {
  if (!userSettings?.baseline_date || userSettings?.goal_weight == null || userSettings?.baseline_weight == null ||
      userSettings.goal_weight >= userSettings.baseline_weight) return null;

  const endDate = lastCompletedDateStr();
  let achievedDate;
  let achievedWeight;
  const isActual = type === "actual" || type === "actual_streak";
  if (isActual) {
    const record = firstActualGoalRecord(type === "actual_streak" ? 7 : 1);
    achievedDate = record?.date;
    achievedWeight = record?.weight;
  } else {
    const weights = buildTheoreticalWeightMap(endDate);
    achievedDate = Object.keys(weights).find((day) => weights[day] <= userSettings.goal_weight);
    achievedWeight = weights[achievedDate];
  }
  if (!achievedDate) return null;

  const { baseline_date, baseline_weight, goal_weight, goal_date } = userSettings;
  // 理論体重のキーは従来と同じにし、保存済みの履歴を重複させない。
  const key = [baseline_date, Number(baseline_weight), Number(goal_weight), goal_date || null];
  if (isActual) key.push("actual");
  if (type === "actual_streak") key.push("streak7");
  return {
    goal_key: JSON.stringify(key),
    baseline_date,
    baseline_weight,
    goal_weight,
    goal_date: goal_date || null,
    achieved_date: achievedDate,
    ...(isActual
      ? { achievement_type: "actual", actual_weight: Number(achievedWeight), theoretical_weight: null }
      : { theoretical_weight: achievedWeight }),
  };
}

async function syncAchievements() {
  const achievements = [currentGoalAchievement(), currentGoalAchievement("actual"),
    currentGoalAchievement("actual_streak")].filter(Boolean);
  achievementMessage.textContent = "読み込み中...";
  achievementList.replaceChildren();

  try {
    const { data, error } = await sb.from("goal_achievements")
      .select("*").order("achieved_date", { ascending: false });
    if (error) throw error;

    let saveFailed = false;
    for (const achievement of achievements) {
      if (data.some((item) => item.goal_key === achievement.goal_key)) continue;
      // 重複した読み込みが起きても、同じ目標の達成履歴は1件だけ保存する。
      const result = await sb.from("goal_achievements").upsert(achievement, {
        onConflict: "user_id,goal_key", ignoreDuplicates: true,
      });
      if (result.error) {
        saveFailed = true;
        console.error(result.error);
        continue;
      }
      data.push(achievement);
    }
    renderAchievements(data);
    if (saveFailed) {
      achievementMessage.textContent = "達成履歴を保存できませんでした。次回の読み込み時に再試行します。";
    }
  } catch (error) {
    achievementMessage.textContent = "達成履歴を読み込めませんでした。接続状況と保存先の設定を確認してください。";
    console.error(error);
  }
}

function renderAchievements(achievements) {
  achievementList.replaceChildren();
  achievementMessage.textContent = "";
  const sorted = [...achievements].sort((a, b) => b.achieved_date.localeCompare(a.achieved_date));
  for (const achievement of sorted) {
    const item = document.createElement("li");
    item.className = "achievement-item";
    const icon = document.createElement("img");
    icon.className = "achievement-icon";
    icon.src = "icons/achievement-medal.svg";
    icon.alt = "";
    icon.width = 32;
    icon.height = 38;
    const content = document.createElement("div");
    content.className = "record-content";
    const title = document.createElement("strong");
    title.className = "record-date";
    const isStreak = isActualStreakAchievement(achievement);
    const isFirstActual = achievement.achievement_type === "actual" && !isStreak;
    title.textContent = `${Number(achievement.goal_weight)}kgの目標を${isFirstActual ? "初めて" : ""}達成！`;
    const method = document.createElement("span");
    method.className = "record-weight achievement-method";
    method.textContent = achievement.achievement_type === "actual"
      ? `実測体重で達成${isStreak ? "（7記録連続）" : ""}` : "理論体重で達成";
    const detail = document.createElement("p");
    detail.className = "record-memo achievement-detail";
    detail.textContent = `達成日: ${achievement.achieved_date} · 基準体重: ${Number(achievement.baseline_weight)} kg`;
    content.append(title, method, detail);
    if (achievement.goal_date) {
      const deadline = document.createElement("p");
      deadline.className = "record-memo achievement-detail";
      deadline.textContent = `目標日: ${achievement.goal_date}`;
      content.appendChild(deadline);
    }
    item.append(icon, content);
    achievementList.appendChild(item);
  }
}

function renderSettingsSummary() {
  const todayStr = formatLocalDateStr(new Date());

  const latestWeight = weightAsOf(todayStr);
  if (hasCompleteProfile() && latestWeight != null) {
    currentBmrDisplay.textContent = Math.round(tdeeForDay(todayStr));
  } else {
    currentBmrDisplay.textContent = "-";
  }

  if (userSettings?.baseline_weight != null && userSettings?.baseline_date) {
    currentBaselineDisplay.textContent = `${userSettings.baseline_weight} kg (${userSettings.baseline_date})`;
  } else {
    currentBaselineDisplay.textContent = "-";
  }
  currentGoalDisplay.textContent = userSettings?.goal_weight != null ? `${userSettings.goal_weight} kg` : "-";

  const firstDay = firstCalorieDateStr();
  const yesterdayStr = lastCompletedDateStr();
  let achievedTotal = null;
  if (firstDay && firstDay <= todayStr) {
    const map = buildCumulativeDeficitMap(firstDay, yesterdayStr);
    achievedTotal = map[yesterdayStr] ?? 0;
  }
  totalDeficitDisplay.textContent = Number.isFinite(achievedTotal) ? Math.round(achievedTotal) : "-";

  // 達成度はグラフと同じ基準日から昨日までの収支で計算する。
  const theoreticalWeight = theoreticalWeightAsOf(todayStr);
  const goalDeficit = theoreticalWeight == null ? null
    : (userSettings.baseline_weight - theoreticalWeight) * (userSettings.kcal_per_kg || 7200);
  renderProgressChart(goalDeficit);
}

// 基準体重から目標体重に到達するために必要な「マイナスカロリーの総量」に対して、
// 現在の達成度を円グラフ(ドーナツ)で表示する。
function renderProgressChart(achievedTotal) {
  const kcalPerKg = userSettings?.kcal_per_kg || 7200;
  const requiredTotal =
    userSettings?.baseline_weight != null && userSettings?.goal_weight != null
      ? (userSettings.baseline_weight - userSettings.goal_weight) * kcalPerKg
      : null;

  if (requiredTotal == null || requiredTotal <= 0 || !Number.isFinite(achievedTotal)) {
    progressLabel.textContent = "-";
    if (progressChart) {
      progressChart.data.datasets[0].data = [0, 0];
      progressChart.update();
    }
    return;
  }

  const percent = (achievedTotal / requiredTotal) * 100;
  progressLabel.textContent = `${Math.round(percent)}%`;

  // 円の割合はそのまま、各区分の値を実際のカロリーにする。
  const data = [Math.max(0, achievedTotal), Math.max(0, requiredTotal - achievedTotal)];

  if (progressChart) {
    progressChart.data.datasets[0].data = data;
    progressChart.update();
    return;
  }

  progressChart = new Chart(progressChartCanvas, {
    type: "doughnut",
    plugins: [{
      id: "progressLabelVisibility",
      afterDraw(chart) {
        progressLabel.style.visibility = chart.tooltip?.opacity > 0 ? "hidden" : "visible";
      },
    }],
    data: {
      labels: ["達成", "残り"],
      datasets: [
        {
          data,
          backgroundColor: [getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#f28c8f", "#f1eaea"],
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      cutout: "70%",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: () => "",
            label: (context) => `${context.label}: ${Math.round(context.parsed).toLocaleString("ja-JP")} kcal`,
          },
        },
      },
    },
  });
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
    dateKeys.push(formatLocalDateStr(d));
  }
  const chartLabels = dateKeys.map(formatMonthDay);

  const weightByDate = {};
  for (const r of weightRecords) {
    if (r.weight != null) weightByDate[r.date] = r.weight;
  }
  const actualWeights = dateKeys.map((d) => weightByDate[d] ?? null);

  const theoreticalMap = buildTheoreticalWeightMap(formatLocalDateStr(today));
  const theoreticalWeights = dateKeys.map((day) => theoreticalMap[day] == null
    ? null : Math.round(theoreticalMap[day] * 10) / 10);

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
