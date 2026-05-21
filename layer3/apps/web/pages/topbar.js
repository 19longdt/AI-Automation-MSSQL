(function () {
  var THEME_KEY = "layer3-theme";
  var TABS = [
    { id: "dashboard", href: "/dashboard", label: "Dashboard" },
    { id: "insights", href: "/insights", label: "Insights" },
    { id: "query-plan", href: "/query-plan", label: "Query Plan" }
  ];

  function currentTheme() {
    var saved = localStorage.getItem(THEME_KEY);
    if (saved) return saved;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function setThemeIcon(btn, isDark) {
    if (isDark) {
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 1 0 9.8 9.8z"/></svg>';
      btn.setAttribute("aria-label", "Switch to light mode");
      btn.setAttribute("title", "Switch to light mode");
    } else {
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M19.1 4.9l-1.6 1.6M6.5 17.5l-1.6 1.6"/></g></svg>';
      btn.setAttribute("aria-label", "Switch to dark mode");
      btn.setAttribute("title", "Switch to dark mode");
    }
  }

  function setTheme(theme, save) {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    if (save) localStorage.setItem(THEME_KEY, theme);
    var btn = document.getElementById("themeToggleBtn");
    if (btn) setThemeIcon(btn, theme === "dark");
  }

  // Render topbar into #topbarMount
  var mount = document.getElementById("topbarMount");
  if (mount) {
    var active = (document.body && document.body.getAttribute("data-active-tab")) || "";
    var html = '<div class="topbar">';
    for (var i = 0; i < TABS.length; i++) {
      var t = TABS[i];
      html += '<a href="' + t.href + '" class="tab' + (t.id === active ? " active" : "") + '">' + t.label + "</a>";
    }
    html += '<button id="themeToggleBtn" class="theme-toggle" type="button"></button>';
    html += "</div>";
    mount.innerHTML = html;
  }

  var btn = document.getElementById("themeToggleBtn");
  if (btn) {
    btn.addEventListener("click", function () {
      setTheme(currentTheme() === "dark" ? "light" : "dark", true);
    });
  }

  // Night starfield + comets
  var cometTimer = null;

  function ensureNightStarfield() {
    if (document.getElementById("nightStarfield")) return;
    var host = document.createElement("div");
    host.id = "nightStarfield";
    host.className = "night-starfield";
    var colors = [
      "rgba(186,223,255,.92)", "rgba(255,234,178,.9)",
      "rgba(204,186,255,.86)", "rgba(171,255,225,.88)", "rgba(255,204,226,.84)"
    ];
    for (var i = 0; i < 120; i++) {
      var s = document.createElement("span");
      s.className = "night-star";
      var size = 1 + Math.random() * 2.2;
      s.style.left = (Math.random() * 100).toFixed(2) + "%";
      s.style.top = (Math.random() * 100).toFixed(2) + "%";
      s.style.width = size.toFixed(2) + "px";
      s.style.height = size.toFixed(2) + "px";
      s.style.background = colors[Math.floor(Math.random() * colors.length)];
      s.style.boxShadow = "0 0 " + (1.5 + Math.random() * 5).toFixed(1) + "px rgba(167,214,255,.65)";
      s.style.animationDuration = (1.6 + Math.random() * 4.8).toFixed(2) + "s, " + (8 + Math.random() * 14).toFixed(2) + "s";
      s.style.animationDelay = (Math.random() * 5).toFixed(2) + "s, " + (Math.random() * 6).toFixed(2) + "s";
      host.appendChild(s);
    }
    document.body.appendChild(host);
  }

  function ensureNightComets() {
    if (document.getElementById("nightComets")) return;
    var host = document.createElement("div");
    host.id = "nightComets";
    host.className = "night-comets";
    document.body.appendChild(host);
  }

  function spawnComet() {
    if (document.documentElement.getAttribute("data-theme") !== "dark") return;
    var host = document.getElementById("nightComets");
    if (!host) return;
    var c = document.createElement("span");
    c.className = "night-comet";
    c.style.width = (200 + Math.random() * 140).toFixed(0) + "px";
    var startX = -24 + Math.random() * 22;
    var endX = 72 + Math.random() * 52;
    var startY = 106 + Math.random() * 16;
    var endY = -(12 + Math.random() * 24);
    var angle = Math.atan2(endY - startY, endX - startX) * (180 / Math.PI);
    c.style.setProperty("--comet-start-x", startX.toFixed(2) + "vw");
    c.style.setProperty("--comet-end-x", endX.toFixed(2) + "vw");
    c.style.setProperty("--comet-start-y", startY.toFixed(2) + "vh");
    c.style.setProperty("--comet-end-y", endY.toFixed(2) + "vh");
    c.style.setProperty("--comet-angle", angle.toFixed(2) + "deg");
    c.style.animationDuration = (1.2 + Math.random() * 1.2).toFixed(2) + "s";
    host.appendChild(c);
    if (host.children.length > 100) host.removeChild(host.children[0]);
    setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); }, 2800);
  }

  function scheduleComet() {
    if (cometTimer) clearTimeout(cometTimer);
    cometTimer = setTimeout(function () { spawnComet(); scheduleComet(); }, 420 + Math.random() * 980);
  }

  ensureNightStarfield();
  ensureNightComets();
  scheduleComet();
  setTheme(currentTheme(), false);
})();
