const SUPABASE_URL = "https://rksssltmfjlrcvmpulef.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_4eaSzl4OpPFE692VxJmr2Q_o_7qCV04";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const loginCard = document.getElementById("login-card");
const loginForm = document.getElementById("login-form");
const loginEmailInput = document.getElementById("login-email");
const loginMessage = document.getElementById("login-message");
const appContent = document.getElementById("app-content");
const signoutButton = document.getElementById("signout-button");

const form = document.getElementById("record-form");
const dateInput = document.getElementById("date");
const weightInput = document.getElementById("weight");
const memoInput = document.getElementById("memo");
const statusMessage = document.getElementById("status-message");
const recordList = document.getElementById("record-list");
const chartCanvas = document.getElementById("weight-chart");

let weightChart = null;

// 今日の日付をデフォルトで入れておく
dateInput.value = new Date().toISOString().slice(0, 10);

// ログイン状態に応じて画面を切り替える
sb.auth.onAuthStateChange((_event, session) => {
  if (session) {
    loginCard.classList.add("hidden");
    appContent.classList.remove("hidden");
    signoutButton.classList.remove("hidden");
    loadRecords();
  } else {
    loginCard.classList.remove("hidden");
    appContent.classList.add("hidden");
    signoutButton.classList.add("hidden");
  }
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginMessage.textContent = "送信中...";

  const { error } = await sb.auth.signInWithOtp({
    email: loginEmailInput.value,
    options: { emailRedirectTo: window.location.href },
  });

  if (error) {
    loginMessage.textContent = `送信に失敗しました: ${error.message}`;
    console.error(error);
    return;
  }

  loginMessage.textContent = "ログイン用のリンクをメールで送りました。メールを確認してください。";
});

signoutButton.addEventListener("click", async () => {
  await sb.auth.signOut();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  statusMessage.textContent = "保存中...";

  const { error } = await sb.from("diet_records").insert({
    date: dateInput.value,
    weight: weightInput.value ? Number(weightInput.value) : null,
    memo: memoInput.value,
  });

  if (error) {
    statusMessage.textContent = `保存に失敗しました: ${error.message}`;
    console.error(error);
    return;
  }

  statusMessage.textContent = "保存しました！";
  weightInput.value = "";
  memoInput.value = "";
  loadRecords();
});

async function loadRecords() {
  const { data, error } = await sb
    .from("diet_records")
    .select("*")
    .order("date", { ascending: false });

  if (error) {
    statusMessage.textContent = `読み込みに失敗しました: ${error.message}`;
    console.error(error);
    return;
  }

  renderList(data);
  renderChart(data);
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
      <span class="record-date">${record.date}</span>
      <span class="record-weight"> — ${weightText}</span>
      ${record.memo ? `<span class="record-memo">${record.memo}</span>` : ""}
    `;
    recordList.appendChild(li);
  }
}

function renderChart(records) {
  // グラフは古い順に並べる
  const sorted = [...records].reverse();
  const labels = sorted.map((r) => r.date);
  const weights = sorted.map((r) => r.weight);

  if (weightChart) {
    weightChart.data.labels = labels;
    weightChart.data.datasets[0].data = weights;
    weightChart.update();
    return;
  }

  weightChart = new Chart(chartCanvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "体重 (kg)",
          data: weights,
          borderColor: "#4a90a4",
          backgroundColor: "rgba(74, 144, 164, 0.15)",
          tension: 0.3,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        y: { beginAtZero: false },
      },
    },
  });
}
