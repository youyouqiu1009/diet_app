const SUPABASE_URL = "https://rksssltmfjlrcvmpulef.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_4eaSzl4OpPFE692VxJmr2Q_o_7qCV04";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const loginCard = document.getElementById("login-card");
const loginForm = document.getElementById("login-form");
const loginEmailInput = document.getElementById("login-email");
const loginMessage = document.getElementById("login-message");
const appContent = document.getElementById("app-content");
const signoutButton = document.getElementById("signout-button");

sb.auth.onAuthStateChange((_event, session) => {
  if (session) {
    loginCard.classList.add("hidden");
    appContent.classList.remove("hidden");
    signoutButton.classList.remove("hidden");
    window.dispatchEvent(new CustomEvent("app:authenticated"));
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

// タブ切り替え
const tabButtons = document.querySelectorAll(".tab-btn");

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    tabButtons.forEach((b) => {
      const panel = document.getElementById(`tab-${b.dataset.tab}`);
      panel.classList.toggle("hidden", b.dataset.tab !== btn.dataset.tab);
    });
  });
});

// 汎用モーダル（過去の記録一覧などのポップアップ表示に使う）
const modalOverlay = document.getElementById("modal-overlay");
const modalTitle = document.getElementById("modal-title");
const modalList = document.getElementById("modal-list");
const modalCloseBtn = document.getElementById("modal-close-btn");

function openModal(title) {
  modalTitle.textContent = title;
  modalList.innerHTML = "<li>読み込み中...</li>";
  modalOverlay.classList.add("open");
}

function closeModal() {
  modalOverlay.classList.remove("open");
  window.dispatchEvent(new CustomEvent("modal:closed"));
}

modalCloseBtn.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal();
});
