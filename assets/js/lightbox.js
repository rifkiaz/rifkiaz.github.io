// Lightbox for post images: tap to open, pinch/wheel/double-tap to zoom,
// drag to pan, swipe for prev/next, swipe down / Esc / backdrop to close.
(function () {
  "use strict";
  var content = document.querySelector(".post-content");
  if (!content) return;

  function eligible(img) {
    return !img.closest("a, .tg-invite") && !img.classList.contains("no-zoom");
  }
  var imgs = Array.prototype.filter.call(content.querySelectorAll("img"), eligible);
  if (!imgs.length) return;
  imgs.forEach(function (img) {
    img.classList.add("lb-zoomable");
    img.setAttribute("tabindex", "0");
    img.setAttribute("role", "button");
    img.setAttribute("aria-label", "Perbesar gambar" + (img.alt ? ": " + img.alt : ""));
  });

  var MAX = 5, root, stage, pic, caption, counter, btnPrev, btnNext, opener;
  var index = 0, s = 1, tx = 0, ty = 0;
  var pointers = new Map(), gesture = null, lastTap = 0, raf = 0;

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html) n.innerHTML = html;
    return n;
  }

  function build() {
    root = el("div", "lb");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Pratinjau gambar");
    stage = el("div", "lb-stage");
    pic = el("img", "lb-img");
    pic.draggable = false;
    pic.alt = "";
    stage.appendChild(pic);
    var bar = el("div", "lb-bar");
    counter = el("span", "lb-count");
    var close = el("button", "lb-btn lb-close", "&times;");
    close.type = "button";
    close.setAttribute("aria-label", "Tutup");
    close.addEventListener("click", hide);
    bar.appendChild(counter);
    bar.appendChild(close);
    btnPrev = el("button", "lb-btn lb-nav lb-prev", "&#8249;");
    btnNext = el("button", "lb-btn lb-nav lb-next", "&#8250;");
    btnPrev.type = btnNext.type = "button";
    btnPrev.setAttribute("aria-label", "Gambar sebelumnya");
    btnNext.setAttribute("aria-label", "Gambar berikutnya");
    btnPrev.addEventListener("click", function () { go(-1); });
    btnNext.addEventListener("click", function () { go(1); });
    caption = el("p", "lb-caption");
    root.appendChild(stage);
    root.appendChild(bar);
    root.appendChild(btnPrev);
    root.appendChild(btnNext);
    root.appendChild(caption);
    document.body.appendChild(root);

    stage.addEventListener("pointerdown", onDown);
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", onUp);
    stage.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("keydown", trapFocus);
  }

  function apply(animate) {
    pic.classList.toggle("lb-anim", !!animate);
    pic.style.transform = "translate3d(" + tx + "px," + ty + "px,0) scale(" + s + ")";
    root.classList.toggle("lb-zoomed", s > 1.01);
  }

  function clamp() {
    var w = pic.offsetWidth * s, h = pic.offsetHeight * s;
    var mx = Math.max(0, (w - stage.clientWidth) / 2);
    var my = Math.max(0, (h - stage.clientHeight) / 2);
    tx = Math.min(mx, Math.max(-mx, tx));
    ty = Math.min(my, Math.max(-my, ty));
  }

  // Zoom to scale ns keeping the screen point (cx, cy) fixed.
  function zoomAt(ns, cx, cy) {
    ns = Math.min(MAX, Math.max(1, ns));
    var r = stage.getBoundingClientRect();
    var px = cx - (r.left + r.width / 2), py = cy - (r.top + r.height / 2);
    tx = px - (px - tx) * (ns / s);
    ty = py - (py - ty) * (ns / s);
    s = ns;
    if (s === 1) { tx = 0; ty = 0; }
    clamp();
  }

  function toggleZoom(cx, cy) {
    zoomAt(s > 1.01 ? 1 : 2.5, cx, cy);
    apply(true);
  }

  function reset() { s = 1; tx = 0; ty = 0; apply(false); }

  function load(i) {
    index = (i + imgs.length) % imgs.length;
    var src = imgs[index];
    reset();
    pic.src = src.currentSrc || src.src;
    pic.classList.toggle("lb-svg", /\.svg(\?|#|$)/i.test(pic.src));
    caption.textContent = src.alt || "";
    caption.hidden = !src.alt;
    var many = imgs.length > 1;
    counter.textContent = many ? index + 1 + " / " + imgs.length : "";
    btnPrev.hidden = btnNext.hidden = !many;
  }

  function go(d) { if (imgs.length > 1) load(index + d); }

  function show(i) {
    if (!root) build();
    opener = document.activeElement;
    load(i);
    document.documentElement.classList.add("lb-open");
    root.classList.add("lb-show");
    document.addEventListener("keydown", onKey);
    root.querySelector(".lb-close").focus({ preventScroll: true });
  }

  function hide() {
    if (!root || !root.classList.contains("lb-show")) return;
    root.classList.remove("lb-show");
    document.documentElement.classList.remove("lb-open");
    document.removeEventListener("keydown", onKey);
    pointers.clear();
    gesture = null;
    if (opener && opener.focus) opener.focus({ preventScroll: true });
  }

  function onKey(e) {
    if (e.key === "Escape") hide();
    else if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "ArrowRight") go(1);
    else if (e.key === "+" || e.key === "=") { zoomAt(s * 1.5, innerWidth / 2, innerHeight / 2); apply(true); }
    else if (e.key === "-") { zoomAt(s / 1.5, innerWidth / 2, innerHeight / 2); apply(true); }
    else if (e.key === "0") { reset(); }
    else return;
    e.preventDefault();
  }

  function trapFocus(e) {
    if (e.key !== "Tab") return;
    var f = Array.prototype.filter.call(root.querySelectorAll("button"), function (b) { return !b.hidden; });
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  }

  function onWheel(e) {
    e.preventDefault();
    zoomAt(s * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    apply(false);
  }

  function mid() {
    var p = Array.from(pointers.values());
    return {
      x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2,
      d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)
    };
  }

  function onDown(e) {
    if (e.button > 0) return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      var m = mid();
      gesture = { type: "pinch", d: m.d, s: s, x: m.x, y: m.y };
    } else if (pointers.size === 1) {
      gesture = { type: "drag", x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
        tx: tx, ty: ty, t: Date.now(), moved: false, onImg: e.target === pic, kind: e.pointerType };
    }
  }

  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;
    if (gesture.type === "pinch" && pointers.size === 2) {
      var m = mid();
      zoomAt(gesture.s * (m.d / gesture.d), m.x, m.y);
      tx += m.x - gesture.x;
      ty += m.y - gesture.y;
      gesture.x = m.x;
      gesture.y = m.y;
      clamp();
    } else if (gesture.type === "drag") {
      var dx = e.clientX - gesture.x0, dy = e.clientY - gesture.y0;
      if (Math.abs(dx) + Math.abs(dy) > 6) gesture.moved = true;
      if (s > 1.01) {
        tx = gesture.tx + dx;
        ty = gesture.ty + dy;
        clamp();
      } else if (gesture.moved) {
        // Not zoomed: image follows the finger as a swipe preview.
        var horiz = Math.abs(dx) > Math.abs(dy);
        tx = horiz && imgs.length > 1 ? dx : 0;
        ty = horiz ? 0 : Math.max(0, dy);
        root.style.setProperty("--lb-fade", String(Math.max(0.35, 0.97 - ty / 400)));
      }
    }
    if (!raf) raf = requestAnimationFrame(function () { raf = 0; apply(false); });
  }

  function onUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    var g = gesture;
    if (pointers.size === 1 && g && g.type === "pinch") {
      // One finger left after a pinch: continue as a pan from here.
      var p = pointers.values().next().value;
      gesture = { type: "drag", x0: p.x, y0: p.y, tx: tx, ty: ty, t: 0, moved: true, onImg: false };
      return;
    }
    if (pointers.size) return;
    gesture = null;
    root.style.removeProperty("--lb-fade");
    if (!g) return;
    if (g.type === "pinch") {
      if (s < 1.05) reset();
      return;
    }
    var dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (s <= 1.01 && g.moved) {
      if (dy > 90 && Math.abs(dy) > Math.abs(dx)) return hide();
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) return go(dx < 0 ? 1 : -1);
      tx = 0; ty = 0;
      return apply(true);
    }
    if (g.moved) return;
    // A tap.
    if (g.kind === "mouse") {
      if (g.onImg) toggleZoom(e.clientX, e.clientY);
      else hide();
      return;
    }
    var now = Date.now();
    if (now - lastTap < 300) {
      lastTap = 0;
      toggleZoom(e.clientX, e.clientY);
      return;
    }
    lastTap = now;
    if (!g.onImg && s <= 1.01) {
      // Wait a bit so a double tap on the backdrop doesn't close and reopen.
      setTimeout(function () { if (lastTap === now) hide(); }, 300);
    }
  }

  content.addEventListener("click", function (e) {
    var i = imgs.indexOf(e.target);
    if (i < 0) return;
    e.preventDefault();
    show(i);
  });
  content.addEventListener("keydown", function (e) {
    var i = imgs.indexOf(e.target);
    if (i < 0 || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    show(i);
  });
})();
