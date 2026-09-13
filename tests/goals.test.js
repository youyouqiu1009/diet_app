// Run with: node tests/goals.test.js (no external packages required).
async function runGoalTests(weightSource, calorieSource) {
  const results = [];
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
  function element() {
    return {
      value: "", children: [],
      get textContent() { return this._text ?? ""; },
      set textContent(value) { this._text = String(value); },
      addEventListener() {}, setAttribute() {},
      append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); },
      replaceChildren() { this.children = []; },
    };
  }
  const elements = {};
  const document = {
    getElementById(id) { return elements[id] ??= element(); },
    querySelectorAll() { return []; },
    createElement: element,
    documentElement: {},
  };
  const window = { addEventListener() {}, dispatchEvent() {} };
  const saved = [];
  let insertCount = 0;
  let readError = false;
  let writeError = false;
  const sb = {
    from(table) {
      assert(table === "goal_achievements", "Unexpected table");
      return {
        select() { return this; },
        async order() {
          return readError ? { error: { message: "offline" } }
            : { data: saved.map((item) => ({ ...item })) };
        },
        async upsert(item, options) {
          assert(options.ignoreDuplicates && options.onConflict === "user_id,goal_key", "Must avoid duplicates");
          if (writeError) return { error: { message: "offline" } };
          insertCount++;
          if (!saved.some((row) => row.goal_key === item.goal_key)) saved.push({ ...item });
          return {};
        },
      };
    },
  };
  const charts = {};
  function Chart(canvas, config) {
    this.data = config.data;
    this.update = () => {};
    charts[config.type] = this;
  }
  // 月をまたぐ午前0時台を使い、UTCではなくローカル日付での境界も確認する。
  let testNow = new Date(2026, 2, 1, 0, 30);
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [testNow.getTime()])); }
    static now() { return testNow.getTime(); }
  }
  const api = new Function("document", "window", "sb", "Chart", "getComputedStyle", "console", "Date",
    `${weightSource}\n${calorieSource}\nreturn {
      set(settings, weights, calories) { userSettings = settings; weightRecords = weights; weightRecordsAsc = weights; calorieDailyNet = calories; },
      theoreticalWeightAsOf, buildTheoreticalWeightMap, currentGoalAchievement, syncAchievements,
      updateGoalHint, renderSettingsSummary, renderChart, tdeeForDay,
      today: formatLocalDateStr(new Date()),
    };`)(document, window, sb, Chart, () => ({ getPropertyValue: () => "#f28c8f" }), { error() {} }, TestDate);
  const today = api.today;
  function dayOffset(offset) {
    const date = new Date(`${today}T00:00:00`);
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  const yesterday = dayOffset(-1);
  const settings = {
    gender: "female", height_cm: 165, birth_date: "1990-01-01", activity_factor: 1.2,
    baseline_weight: 70, baseline_date: yesterday, goal_weight: 68, goal_date: dayOffset(10), kcal_per_kg: 7200,
  };
  const actualWeights = [{ date: yesterday, weight: 70 }, { date: today, weight: 73 }];
  api.set(settings, actualWeights, {});
  const yesterdayTdee = api.tdeeForDay(yesterday);
  const todayTdee = api.tdeeForDay(today);
  api.set(settings, actualWeights, { [yesterday]: yesterdayTdee - 7200 });
  assert(api.theoreticalWeightAsOf(today) === 69, "Theoretical weight should be 69 despite actual weight 73");
  api.updateGoalHint();
  assert(elements["goal-hint"].textContent === `${Math.round(todayTdee - 720)} kcal以下`, "Goal line should use theoretical remaining weight");
  results.push("Goal line uses theoretical weight; maintenance still uses TDEE");

  api.set(settings, actualWeights, { [dayOffset(-2)]: -99999, [yesterday]: yesterdayTdee - 7200, [dayOffset(1)]: -99999 });
  api.renderSettingsSummary();
  assert(elements["progress-label"].textContent === "50%", "Progress must ignore records before baseline and after today");
  assert(api.theoreticalWeightAsOf(today) === 69, "Missing calorie days should preserve theoretical weight");
  assert(api.theoreticalWeightAsOf(dayOffset(-2)) === null, "No theoretical weight before baseline");
  results.push("Baseline period, future records, and missing calorie days");

  const partialDayCalories = { [yesterday]: yesterdayTdee - 7200, [today]: todayTdee - 14400 };
  api.set(settings, actualWeights, partialDayCalories);
  api.renderSettingsSummary();
  api.renderChart();
  api.updateGoalHint();
  assert(elements["progress-label"].textContent === "50%", "Today's partial input must not change progress");
  assert(elements["total-deficit"].textContent === "7200", "Total deficit should also exclude today");
  assert(elements["goal-hint"].textContent === `${Math.round(todayTdee - 720)} kcal以下`, "Today's partial input must not change goal line");
  assert(api.currentGoalAchievement() === null, "Today's partial input must not award achievement");
  await api.syncAchievements();
  assert(saved.length === 0, "Today's partial input must not persist an award");
  const theoreticalPoints = charts.line.data.datasets[1].data;
  assert(theoreticalPoints.at(-2) === 69 && theoreticalPoints.at(-1) === 69, "Graph must carry yesterday's value through today");
  assert(charts.line.data.datasets[0].data.at(-1) === 73, "Today's actual weight must still appear on graph");
  assert(api.theoreticalWeightAsOf(dayOffset(1)) === null, "Future theoretical weights should not be projected");
  api.set(settings, actualWeights, { ...partialDayCalories, [today]: todayTdee + 99999 });
  assert(api.theoreticalWeightAsOf(today) === 69, "Additional food today must not change theoretical weight");
  results.push("Today's inputs excluded from progress, goal line, total, awards; graph continues through today");

  api.set({ ...settings, baseline_date: today }, actualWeights, { [today]: todayTdee - 14400 });
  api.renderSettingsSummary();
  assert(api.theoreticalWeightAsOf(today) === 70, "Baseline today should show baseline weight provisionally");
  assert(elements["progress-label"].textContent === "0%" && elements["total-deficit"].textContent === "0", "Only today's input means zero confirmed progress");
  assert(api.currentGoalAchievement() === null, "Baseline today cannot award from partial input");
  api.set({ ...settings, baseline_date: dayOffset(1) }, actualWeights, {});
  assert(api.theoreticalWeightAsOf(today) === null, "Future baseline must not create a point today");
  results.push("Today's baseline and future baseline handled without false progress");

  api.set(settings, actualWeights, partialDayCalories);
  const originalNow = testNow;
  testNow = new Date(2026, 2, 2, 0, 30);
  assert(api.theoreticalWeightAsOf(today) === 67, "After midnight, prior day's full input is included");
  assert(api.theoreticalWeightAsOf(dayOffset(1)) === 67, "New today's point carries updated yesterday value");
  assert(api.currentGoalAchievement().achieved_date === today, "Award uses completed day's date, not next day's date");
  api.renderSettingsSummary();
  assert(elements["progress-label"].textContent === "150%", "Progress reflects prior day's input after rollover");
  testNow = originalNow;
  results.push("Day rollover includes completed input and keeps actual achievement date");

  api.set(settings, actualWeights, { [yesterday]: yesterdayTdee - 7200 * 1.96 });
  assert(api.currentGoalAchievement() === null, "Rounded 68.0 kg must not count as reaching 68 kg");
  api.set({ ...settings, height_cm: null }, actualWeights, { [yesterday]: -99999 });
  assert(api.theoreticalWeightAsOf(today) === null && api.currentGoalAchievement() === null, "Incomplete profile must not award achievement");
  api.set({ ...settings, baseline_date: null }, actualWeights, {});
  api.updateGoalHint();
  assert(elements["goal-hint"].textContent === "基準体重を設定してください", "Missing baseline should be explained");
  results.push("No false awards from rounding or incomplete settings");

  api.set({ ...settings, goal_date: today }, actualWeights, {});
  api.updateGoalHint();
  assert(elements["goal-hint"].textContent.endsWith("kcal以下"), "Goal date today should still be usable");
  api.set({ ...settings, goal_date: yesterday }, actualWeights, {});
  api.updateGoalHint();
  assert(elements["goal-hint"].textContent === "目標日を過ぎています", "Expired date message");
  api.set({ ...settings, goal_date: yesterday }, actualWeights, { [yesterday]: yesterdayTdee - 14400 });
  api.updateGoalHint();
  assert(elements["goal-hint"].textContent === "目標達成！", "Reached goal takes priority over expired date");
  results.push("Goal date today, expired dates, and reached goals");

  api.set(settings, actualWeights, { [yesterday]: yesterdayTdee - 14400, [today]: todayTdee + 7200 });
  assert(api.currentGoalAchievement().achieved_date === yesterday, "Preserve first reached date despite rebound");
  await api.syncAchievements();
  await api.syncAchievements();
  assert(saved.length === 1 && insertCount === 1, "Reload must not duplicate awards");
  assert(elements["achievement-list"].children.length === 1, "Render saved award");
  api.set({ ...settings, goal_weight: 65 }, actualWeights, {});
  await api.syncAchievements();
  assert(saved.length === 1 && elements["achievement-list"].children.length === 1, "Goal change preserves old award");
  api.set({ ...settings, goal_weight: 67 }, actualWeights, { [yesterday]: yesterdayTdee - 21600 });
  await api.syncAchievements();
  assert(saved.length === 2 && elements["achievement-list"].children.length === 2, "New reached goal adds another award");
  results.push("Persistence, duplicate prevention, rebound, and multiple goals");

  api.set({ ...settings, goal_weight: 66 }, actualWeights, { [yesterday]: yesterdayTdee - 28800 });
  writeError = true;
  await api.syncAchievements();
  assert(saved.length === 2 && elements["achievement-message"].textContent.includes("保存できません"), "Report save failure without fake award");
  writeError = false;
  await api.syncAchievements();
  assert(saved.length === 3, "Retry should save award");
  readError = true;
  await api.syncAchievements();
  assert(elements["achievement-message"].textContent.includes("読み込めません"), "Report load failure");
  results.push("Storage failures and retry");

  readError = false;
  saved.length = 0;
  insertCount = 0;
  const reachedActualWeights = [
    { date: dayOffset(-2), weight: 67 },
    { date: yesterday, weight: 68 },
    { date: today, weight: 67.5 },
  ];
  api.set({ ...settings, height_cm: null }, reachedActualWeights, {});
  const actualAward = api.currentGoalAchievement("actual");
  assert(actualAward.achievement_type === "actual" && actualAward.actual_weight === 68, "Actual award stores measured weight and method");
  assert(actualAward.theoretical_weight === null, "Actual weight must not be stored as a theoretical weight");
  assert(actualAward.achieved_date === yesterday, "Actual award ignores measurements before baseline");
  assert(api.currentGoalAchievement() === null, "Actual-only award does not require theoretical profile");
  await api.syncAchievements();
  assert(saved.length === 1 && saved[0].achievement_type === "actual", "Actual-only achievement persists");
  let methodLabel = elements["achievement-list"].children[0].children[1].children[1];
  assert(methodLabel.textContent === "実測体重で達成", "Actual method is visible on card");

  api.set(settings, reachedActualWeights, {});
  const reachedTdee = api.tdeeForDay(yesterday);
  api.set(settings, reachedActualWeights, { [yesterday]: reachedTdee - 14400 });
  await api.syncAchievements();
  await api.syncAchievements();
  assert(saved.length === 2 && insertCount === 2, "Same goal can earn both methods exactly once");
  const theoreticalAward = saved.find((row) => row.achievement_type !== "actual");
  assert(theoreticalAward.goal_key !== actualAward.goal_key, "Methods use distinct keys");
  const labels = elements["achievement-list"].children.map((item) => item.children[1].children[1].textContent);
  assert(labels.includes("実測体重で達成") && labels.includes("理論体重で達成"), "Legacy theoretical award and actual award have explicit labels");
  api.set({ ...settings, goal_weight: 65 }, [], {});
  await api.syncAchievements();
  assert(saved.length === 2 && elements["achievement-list"].children.length === 2, "Both methods remain after goal change and record deletion");
  results.push("Actual and theoretical awards persist separately with visible method labels and legacy compatibility");

  api.set(settings, [{ date: today, weight: 67 }, { date: dayOffset(1), weight: 66 }], {});
  assert(api.currentGoalAchievement("actual") === null, "Actual awards also exclude today and future dates");
  api.set(settings, [{ date: yesterday, weight: null }, { date: yesterday, weight: 0 }], {});
  assert(api.currentGoalAchievement("actual") === null, "Missing or invalid measured weights must not award");
  api.set(settings, [{ date: yesterday, weight: 68.01 }], {});
  assert(api.currentGoalAchievement("actual") === null, "Actual award must use unrounded measurement");
  results.push("Actual award respects completed-day cutoff and valid unrounded measurements");
  return results;
}

if (typeof require !== "undefined" && require.main === module) {
  const fs = require("node:fs");
  const path = require("node:path");
  runGoalTests(fs.readFileSync(path.join(__dirname, "../weight.js"), "utf8"),
    fs.readFileSync(path.join(__dirname, "../calorie.js"), "utf8"))
    .then((results) => results.forEach((result) => console.log(`PASS: ${result}`)))
    .catch((error) => { console.error(error); process.exitCode = 1; });
}
