const form = document.getElementById("login-form");
const errorBox = document.getElementById("login-error");
const submitBtn = document.getElementById("login-submit");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorBox.classList.remove("show");
  submitBtn.disabled = true;
  submitBtn.textContent = "Signing in…";
  try {
    await Auth.login(document.getElementById("email").value.trim(), document.getElementById("password").value);
    window.location.href = "/index.html";
  } catch (err) {
    errorBox.textContent = err.message || "Sign in failed";
    errorBox.classList.add("show");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Sign in";
  }
});
