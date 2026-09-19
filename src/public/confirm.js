// TODO: adjust to your actual login page.
const LOGIN_REDIRECT_URL = "http://localhost:8081/auth/login";
const REDIRECT_DELAY_MS = 2000;

const form = document.getElementById("password-form");
const submitBtn = document.getElementById("submit-btn");
const subtitle = document.getElementById("subtitle");
const messageEl = document.getElementById("message");
const passwordInput = document.getElementById("password");
const confirmPasswordInput = document.getElementById("confirm-password");

const showMessage = (text, type) => {
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
};

const clearMessage = () => {
  messageEl.textContent = "";
  messageEl.className = "message";
};

const getHashParams = () => {
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  return new URLSearchParams(hash);
};

const params = getHashParams();
const token = params.get("access_token");

if (!token) {
  subtitle.textContent = "This confirmation link is invalid or has expired.";
  form.style.display = "none";
  showMessage("Missing or invalid confirmation token. Please request a new invite.", "error");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();

  const password = passwordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  if (password !== confirmPassword) {
    showMessage("Passwords do not match.", "error");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Setting password...";

  try {
    const response = await fetch("/auth/set-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      showMessage(body.message || "Something went wrong. Please try again.", "error");
      submitBtn.disabled = false;
      submitBtn.textContent = "Set Password";
      return;
    }

    form.style.display = "none";
    showMessage("Password set successfully. Redirecting to login...", "success");

    setTimeout(() => {
      window.location.href = LOGIN_REDIRECT_URL;
    }, REDIRECT_DELAY_MS);
  } catch (err) {
    showMessage("Something went wrong. Please try again.", "error");
    submitBtn.disabled = false;
    submitBtn.textContent = "Set Password";
  }
});
