try {
  const stored = localStorage.getItem("monitor-theme");
  const theme = stored === null ? "dark" : stored === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#09121b" : "#eef2f6");
} catch {
  document.documentElement.dataset.theme = "dark";
}
