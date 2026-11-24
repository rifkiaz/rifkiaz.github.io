// Short courses for the lab simulators (/kursus/<sim>/). The lesson sits next
// to the real simulator page, loaded in an iframe from the same origin with
// ?embed=1. Because it's the same origin, this script reads the simulator's
// mission list straight from the iframe DOM (li.is-done) and can type into
// its terminal, click its buttons, or edit its files for the "try it" steps.
// Progress (missions seen + quiz answers) is a per-browser convenience in
// localStorage; everything still works when storage is blocked.
(function () {
  'use strict';

  var root = document.getElementById('ks');
  if (!root) return;
  var en = document.documentElement.lang === 'en';
  function tr(id, e) { return en ? e : id; }
  function $(s, el) { return (el || root).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || root).querySelectorAll(s)); }

  var sim = root.dataset.sim;
  var KEY = 'kursus:' + sim;
  var frame = $('#ks-frame');
  var lessons = $$('.ks-lesson');
  var tabs = $$('.ks-nav button');
  var bar = $('#ks-bar i');
  var barTxt = $('#ks-bar-txt');
  var toastEl = $('#ks-toast');
  var mq = window.matchMedia('(max-width: 900px)');

  // ---------- saved progress ----------
  var S = { m: [], q: {}, at: 0 };
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) {
      var j = JSON.parse(raw);
      if (j && Array.isArray(j.m)) S.m = j.m.filter(function (x) { return typeof x === 'number'; });
      if (j && j.q && typeof j.q === 'object') S.q = j.q;
      if (j && typeof j.at === 'number') S.at = j.at;
    }
  } catch (e) { /* storage blocked: start fresh */ }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ }
  }
  var hadSaved = S.m.length > 0;

  var toastT;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('is-on'); }, 2600);
  }

  // ---------- lesson navigation ----------
  var cur = 0;
  function show(i, scroll) {
    cur = Math.max(0, Math.min(lessons.length - 1, i));
    lessons.forEach(function (l, k) { l.hidden = k !== cur; });
    tabs.forEach(function (t, k) {
      t.setAttribute('aria-current', k === cur ? 'step' : 'false');
    });
    S.at = cur; save();
    if (scroll) {
      var top = $('.ks-pane').getBoundingClientRect().top + window.scrollY - 70;
      if (window.scrollY > top || mq.matches) window.scrollTo({ top: top, behavior: 'smooth' });
      $('.ks-pane').scrollTop = 0;
    }
  }
  root.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || !root.contains(b)) return;
    if (b.dataset.go !== undefined) { show(+b.dataset.go, true); if (mq.matches) view('learn'); return; }
    if (b.dataset.view) { view(b.dataset.view); return; }
    if (b.dataset.opt !== undefined) { answer(b); return; }
    if (b.dataset.run) { step(b); return; }
    if (b.dataset.act === 'forget') { forget(); return; }
  });

  // mobile: one column, switch between the lesson and the lab
  function view(v) {
    root.dataset.view = v;
    $$('.ks-switch button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.view === v ? 'true' : 'false'); });
    if (v === 'lab') {
      var top = $('.ks-lab').getBoundingClientRect().top + window.scrollY - 60;
      window.scrollTo({ top: Math.max(0, top) });
    }
  }

  // ---------- missions from the simulator ----------
  function mark() {
    var done = {};
    S.m.forEach(function (n) { done[n] = true; });
    var total = 0, got = 0;
    lessons.forEach(function (l, k) {
      var ms = (l.dataset.missions || '').split(',').filter(Boolean).map(Number);
      var all = ms.length > 0 && ms.every(function (n) { return done[n]; });
      $$('.ks-mi', l).forEach(function (li) {
        var ok = !!done[+li.dataset.m];
        li.classList.toggle('is-done', ok);
      });
      var was = l.classList.contains('is-done');
      l.classList.toggle('is-done', all);
      tabs[k].classList.toggle('is-done', all);
      if (all && !was && ready && k === cur) {
        toast(k === lessons.length - 1 ? tr('🎉 Pelajaran terakhir beres!', '🎉 Last lesson done!') : tr('✓ Pelajaran ' + (k + 1) + ' beres. Lanjut ke berikutnya →', '✓ Lesson ' + (k + 1) + ' done. On to the next one →'));
      }
      total += ms.length;
      ms.forEach(function (n) { if (done[n]) got++; });
    });
    var pct = total ? Math.round(got / total * 100) : 0;
    bar.style.width = pct + '%';
    barTxt.textContent = got + '/' + total + tr(' misi', ' missions');
    root.classList.toggle('is-finished', total > 0 && got === total);
  }
  var ready = false, hooked = null;
  function sync(fd) {
    var lis = fd.querySelectorAll('.gx-missions ol li');
    var add = false;
    for (var i = 0; i < lis.length; i++) {
      if (lis[i].classList.contains('is-done') && S.m.indexOf(i + 1) < 0) { S.m.push(i + 1); add = true; }
    }
    if (add) { S.m.sort(function (a, b) { return a - b; }); save(); mark(); }
  }
  function hook() {
    var fd;
    try { fd = frame.contentDocument; } catch (e) { return; }
    if (!fd || fd === hooked || !fd.querySelector('.gx-missions')) return;
    hooked = fd;
    root.classList.add('is-live');
    var ol = fd.querySelector('.gx-missions ol');
    // copy the simulator's own mission wording into the lesson goals
    var texts = fd.querySelectorAll('.gx-missions ol li > span:last-child');
    $$('.ks-mi').forEach(function (li) {
      var t = texts[+li.dataset.m - 1];
      if (t) li.querySelector('.ks-mt').innerHTML = t.innerHTML;
    });
    new MutationObserver(function () { sync(fd); }).observe(ol, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    sync(fd);
    ready = true;
  }
  frame.addEventListener('load', hook);
  if (frame.contentDocument && frame.contentDocument.readyState === 'complete') hook();

  // ---------- "try it" steps ----------
  function fdoc() { try { return frame.contentDocument; } catch (e) { return null; } }
  function afterRun() {
    if (mq.matches) { view('lab'); }
  }
  // scroll the simulator (inside the iframe only) so el's panel is in view
  function reveal(fw, el) {
    var box = el.closest('.gx-panel') || el;
    var r = box.getBoundingClientRect(), h = fw.innerHeight;
    if (r.top >= 0 && r.bottom <= h) return;
    var y = r.height > h ? r.bottom - h + 8 : r.top - 8;
    fw.scrollTo({ top: Math.max(0, fw.scrollY + y), behavior: 'smooth' });
  }
  function pressEnter(fw, input) {
    var ev = new fw.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
  }
  function step(b) {
    var fd = fdoc(), fw = frame.contentWindow;
    if (!fd || !fd.querySelector('.gx')) { toast(tr('Lab-nya belum siap, tunggu sebentar.', 'The lab isn\'t ready yet, give it a second.')); return; }
    var li = b.closest('.ks-step'), kind = li.dataset.kind, mode = b.dataset.run;
    if (kind === 'cmd' || kind === 'pick') {
      var input = fd.querySelector('.sx-prompt input');
      if (!input) return;
      var cmd = li.dataset.cmd;
      if (kind === 'pick') {
        var btns = fd.querySelectorAll('[data-cmd]'), hit = null;
        for (var i = 0; i < btns.length; i++) { if (btns[i].dataset.cmd.indexOf(cmd) === 0 && btns[i].offsetParent !== null) { hit = btns[i]; break; } }
        if (!hit) for (var k = 0; k < btns.length; k++) { if (btns[k].dataset.cmd.indexOf(cmd) === 0) { hit = btns[k]; break; } }
        if (!hit) { toast(tr('Langkah ini belum bisa: cek dulu langkah sebelumnya sudah jalan.', 'This step isn\'t possible yet: check the previous steps ran.')); return; }
        cmd = hit.dataset.cmd;
      }
      if (input.disabled) { toast(tr('Terminal lagi sibuk, tunggu perintah sebelumnya selesai.', 'The terminal is busy, wait for the previous command to finish.')); return; }
      reveal(fw, input);
      input.value = cmd;
      input.dispatchEvent(new fw.Event('input', { bubbles: true }));
      if (mode === 'type') {
        afterRun();
        input.focus({ preventScroll: true });
        try { input.setSelectionRange(cmd.length, cmd.length); } catch (e) { /* ignore */ }
        toast(tr('Sudah diketik. Tekan Enter di terminal.', 'Typed it in. Press Enter in the terminal.'));
      } else {
        pressEnter(fw, input);
        afterRun();
      }
    } else if (kind === 'click') {
      var el = fd.querySelector(li.dataset.sel);
      if (!el) { toast(tr('Tombolnya belum muncul di lab. Cek langkah sebelumnya.', 'That button isn\'t in the lab yet. Check the previous steps.')); return; }
      if (el.disabled) { toast(tr('Tombolnya lagi nonaktif, tunggu sebentar.', 'That button is disabled right now, wait a moment.')); return; }
      if (el.tagName === 'INPUT' && el.type === 'checkbox' && li.dataset.state) {
        var want = li.dataset.state === 'on';
        if (el.checked !== want) el.click();
      } else el.click();
      reveal(fw, el);
      afterRun();
    } else if (kind === 'select') {
      var sel = fd.querySelector(li.dataset.sel);
      if (!sel) { toast(tr('Pilihannya belum muncul di lab.', 'That option isn\'t in the lab yet.')); return; }
      sel.value = li.dataset.value;
      sel.dispatchEvent(new fw.Event('change', { bubbles: true }));
      afterRun();
    } else if (kind === 'edit') {
      if (li.dataset.tab) { var tb = fd.querySelector(li.dataset.tab); if (tb) tb.click(); }
      var find = li.dataset.find, rep = li.dataset.replace;
      var tas = fd.querySelectorAll('textarea'), ta = null, already = false;
      for (var t = 0; t < tas.length; t++) {
        if (tas[t].value.indexOf(find) >= 0) { ta = tas[t]; break; }
        if (rep && tas[t].value.indexOf(rep) >= 0) already = true;
      }
      if (!ta) { toast(already ? tr('File-nya sudah berubah seperti itu.', 'The file already has that change.') : tr('Teks yang mau diganti ga ketemu. Mungkin file-nya sudah kamu ubah; tombol "kembalikan file" di lab bisa mengembalikannya.', 'Couldn\'t find the text to replace. Maybe you already changed the file; the "restore files" button in the lab puts it back.')); return; }
      reveal(fw, ta);
      ta.value = ta.value.replace(find, rep);
      ta.dispatchEvent(new fw.Event('input', { bubbles: true }));
      afterRun();
      try { ta.focus({ preventScroll: true }); var p = ta.value.indexOf(rep); if (p >= 0) ta.setSelectionRange(p, p + rep.length); } catch (e) { /* ignore */ }
      toast(tr('File diubah di editor lab.', 'File changed in the lab editor.'));
    }
  }

  // ---------- quiz ----------
  function answer(b) {
    var q = b.closest('.ks-quiz'), k = q.dataset.q, right = +q.dataset.answer, pick = +b.dataset.opt;
    S.q[k] = pick; save();
    paintQuiz(q, pick, right);
  }
  function paintQuiz(q, pick, right) {
    $$('button[data-opt]', q).forEach(function (o) {
      var n = +o.dataset.opt;
      o.classList.toggle('is-right', n === right && pick === right);
      o.classList.toggle('is-wrong', n === pick && pick !== right);
      o.setAttribute('aria-pressed', n === pick ? 'true' : 'false');
    });
    var w = $('.ks-why', q);
    w.hidden = false;
    $('.ks-verdict', q).textContent = pick === right ? tr('Betul! ', 'Right! ') : tr('Belum tepat. ', 'Not quite. ');
    q.classList.toggle('is-right', pick === right);
  }
  $$('.ks-quiz').forEach(function (q) {
    var k = q.dataset.q;
    if (S.q[k] !== undefined) paintQuiz(q, +S.q[k], +q.dataset.answer);
  });

  function forget() {
    S = { m: [], q: {}, at: 0 };
    save();
    $$('.ks-quiz').forEach(function (q) {
      $$('button[data-opt]', q).forEach(function (o) { o.classList.remove('is-right', 'is-wrong'); o.setAttribute('aria-pressed', 'false'); });
      $('.ks-why', q).hidden = true;
      q.classList.remove('is-right');
    });
    $('#ks-resume').hidden = true;
    mark();
    try { frame.contentWindow.location.reload(); } catch (e) { /* ignore */ }
    show(0, true);
    toast(tr('Progres kursus dihapus. Mulai dari awal.', 'Course progress cleared. Starting over.'));
  }

  // ---------- start ----------
  if (hadSaved) $('#ks-resume').hidden = false;
  view('learn');
  mark();
  show(S.at < lessons.length ? S.at : 0, false);
})();
