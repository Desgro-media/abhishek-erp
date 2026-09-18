/* Thin auth client shared by login.html and index.html.
   Access token lives only in this module's closure (never localStorage —
   that would be readable by any injected/XSS'd script). It's lost on every
   page load by design; init() re-derives it from the httpOnly refresh
   cookie, which JS can never read directly. */
window.Auth = (function () {
  let accessToken = null;
  let user = null;

  async function login(email, password) {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Sign in failed");
    accessToken = data.accessToken;
    user = data.user;
    return user;
  }

  async function refresh() {
    const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
    if (!res.ok) throw new Error("Session expired");
    const data = await res.json();
    accessToken = data.accessToken;
    user = data.user;
    return user;
  }

  // Call once on every protected page. Redirects to /login.html on failure —
  // callers should treat a thrown/rejected init() as "navigation is happening,
  // stop what you're doing."
  async function init() {
    try {
      await refresh();
      return user;
    } catch (e) {
      window.location.href = "/login.html";
      throw e;
    }
  }

  // Wrapper for future API calls (Phase 2+): attaches the bearer token and
  // retries once after a silent refresh if the access token had expired.
  async function apiFetch(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers, accessToken ? { Authorization: "Bearer " + accessToken } : {});
    opts.credentials = "include";
    let res = await fetch(url, opts);
    if (res.status === 401) {
      await refresh();
      opts.headers.Authorization = "Bearer " + accessToken;
      res = await fetch(url, opts);
    }
    return res;
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch (e) {
      /* best-effort — still clear local state and leave */
    }
    accessToken = null;
    user = null;
    window.location.href = "/login.html";
  }

  function getUser() {
    return user;
  }
  function getToken() {
    return accessToken;
  }

  // Keeps the access token alive while a tab is left open past its TTL —
  // without this, the first API call after ~15 minutes idle would 401 and
  // silently retry, which is fine, but this avoids that round trip.
  setInterval(() => {
    if (accessToken) refresh().catch(() => {});
  }, 10 * 60 * 1000);

  return { login, refresh, init, apiFetch, logout, getUser, getToken };
})();
