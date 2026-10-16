// Timeline pengalaman: garis tergambar mengikuti scroll, titik menyala saat
// garis sampai, isi tiap pekerjaan muncul pelan. Tanpa JS atau dengan
// prefers-reduced-motion, timeline tampil utuh seperti biasa.
(function () {
  var xp = document.querySelector(".xp");
  if (!xp || !window.requestAnimationFrame) return;
  if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var list = xp.querySelector(".xp__list");
  var items = [].slice.call(xp.querySelectorAll(".xp__item"));
  xp.classList.add("xp--anim");

  var ticking = false;
  function update() {
    ticking = false;
    var mark = window.innerHeight * 0.65;
    var r = list.getBoundingClientRect();
    var p = Math.min(1, Math.max(0, (mark - r.top) / r.height));
    list.style.setProperty("--xp-p", p.toFixed(4));
    items.forEach(function (it) {
      var top = it.getBoundingClientRect().top;
      it.classList.toggle("is-hit", top + 10 <= mark);
      if (top <= window.innerHeight * 0.9) it.classList.add("is-in");
    });
  }
  function onScroll() {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  update();
})();
