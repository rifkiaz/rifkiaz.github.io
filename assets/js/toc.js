// Daftar isi: keep the target heading in place after a TOC click.
// PaperMod's footer script starts a smooth scroll to the heading, but content
// above it can still grow afterwards (lazy images without a known size, embeds,
// shortcodes that render later), which pushes the heading out of view. For a
// few seconds after the click, re-align whenever the content changes size.
(function () {
  var toc = document.querySelector(".toc");
  var content = document.querySelector(".post-content");
  if (!toc || !content || !("ResizeObserver" in window)) return;

  var target = null, until = 0, timer = 0;
  var smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function realign() {
    if (!target || Date.now() > until) { target = null; return; }
    target.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
  }

  new ResizeObserver(function () {
    if (!target) return;
    clearTimeout(timer);
    timer = setTimeout(realign, 60);
  }).observe(content);

  // Stop correcting as soon as the reader scrolls on their own.
  function cancel() { target = null; }
  ["wheel", "touchstart", "keydown"].forEach(function (t) {
    window.addEventListener(t, cancel, { passive: true });
  });

  toc.addEventListener("click", function (e) {
    var a = e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = decodeURIComponent(a.getAttribute("href").slice(1));
    target = document.getElementById(id);
    until = Date.now() + 4000;
  });
})();
