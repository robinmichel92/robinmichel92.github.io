/* ============================================================
   AIREO — site vitrine · interactions
   ============================================================ */
(function () {
  "use strict";
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- année ---------- */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ============================================================
     LANGUE FR / EN
     Chaque [data-en] porte la version anglaise ; le contenu initial
     (FR) est mémorisé dans data-fr au premier passage.
     ============================================================ */
  var i18nNodes = Array.prototype.slice.call(document.querySelectorAll("[data-en]"));
  i18nNodes.forEach(function (el) { el.setAttribute("data-fr", el.innerHTML); });

  // Pages bilingues générées (EN à /, FR à /fr/) = monolingues, sans [data-en] :
  // la langue vient de <html lang> et la bascule est un lien vers l'autre URL.
  var hasI18n = i18nNodes.length > 0;
  var pageLang = document.documentElement.lang === "en" ? "en" : "fr";
  var currentLang = (function () {
    if (!hasI18n) return pageLang;
    try { return localStorage.getItem("aireo-lang") || "fr"; } catch (e) { return "fr"; }
  })();

  function setLang(lang) {
    currentLang = lang === "en" ? "en" : "fr";
    document.documentElement.lang = currentLang;
    var attr = currentLang === "en" ? "data-en" : "data-fr";
    i18nNodes.forEach(function (el) {
      var v = el.getAttribute(attr);
      if (v != null) el.innerHTML = v;
    });
    document.querySelectorAll(".lang-btn").forEach(function (b) {
      var on = b.getAttribute("data-lang") === currentLang;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    try { localStorage.setItem("aireo-lang", currentLang); } catch (e) {}
  }

  if (hasI18n) {
    document.querySelectorAll(".lang-btn").forEach(function (b) {
      b.addEventListener("click", function () { setLang(b.getAttribute("data-lang")); });
    });
    if (currentLang === "en") setLang("en"); // applique la préférence sauvegardée
  }

  /* ============================================================
     BARRE DU HAUT — état au scroll
     ============================================================ */
  var topbar = document.getElementById("topbar");
  function onScroll() {
    if (topbar) topbar.classList.toggle("is-scrolled", window.scrollY > 10);
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ============================================================
     REVEAL ON SCROLL + nettoyage AAF
     ============================================================ */
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add("is-in");
        var viz = e.target.querySelector(".aaf-viz");
        if (viz) setTimeout(function () { viz.classList.add("is-clean"); }, 360);
        io.unobserve(e.target);
      });
    }, { threshold: 0.16, rootMargin: "0px 0px -8% 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("is-in"); });
    var v = document.querySelector(".aaf-viz");
    if (v) v.classList.add("is-clean");
  }

  /* ============================================================
     HALOS (aura) — on fige l'animation quand ça ne se voit pas
     ------------------------------------------------------------
     Les 8 halos flous (blur 70px) + le morphe de couleur repeignent
     à CHAQUE frame : coûteux en continu. On met l'animation en pause
     quand le hero n'est plus à l'écran (tout le reste du défilement
     redevient fluide) et quand l'onglet passe en arrière-plan (batterie).
     Aucun changement visuel sur le 1er écran, là où le morphe compte.
     `prefers-reduced-motion` est déjà géré en CSS (animation:none).
     ============================================================ */
  var aura = document.querySelector(".aura");
  if (aura && !reduceMotion) {
    var heroEl = document.getElementById("hero");
    var auraSeen = true, tabShown = true;
    function syncAura() { aura.classList.toggle("is-paused", !(auraSeen && tabShown)); }
    if (heroEl && "IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        auraSeen = entries[0].isIntersecting; syncAura();
      }, { threshold: 0 }).observe(heroEl);
    }
    document.addEventListener("visibilitychange", function () {
      tabShown = !document.hidden; syncAura();
    });
  }

  /* ============================================================
     MODULE AVANT / APRÈS — forme d'onde réelle + écoute pilotée par la barre
     ------------------------------------------------------------
     La barre verticale = POINT DE BASCULE : à gauche on entend le brut
     (gris), à droite le traité (vert). La tête de lecture balaie et révèle
     la forme d'onde ; quand elle franchit la barre, le son passe d'AVANT à
     APRÈS — en direct. Glissez la barre pour déplacer ce point ; cliquez
     dans la forme d'onde pour déplacer la lecture (seek).

     ► Extraits décodés depuis : assets/demo-avant.m4a + assets/demo-apres.m4a
       (les deux doivent être LE MÊME passage, alignés et de même durée).
       Sans extraits décodables : forme d'onde synthétique, écoute désactivée.
     ============================================================ */
  (function abModule() {
    var canvas  = document.getElementById("abCanvas");
    var frame   = document.querySelector(".ab-frame");
    var divider = document.getElementById("abDivider");
    if (!canvas || !frame || !divider) return;

    var ctx       = canvas.getContext("2d");
    var playBtn   = document.getElementById("abPlay");
    var soonEl    = document.getElementById("abSoon");
    var audioWrap = document.getElementById("abAudio");
    var iconEl    = playBtn ? playBtn.querySelector(".ab-play-icon") : null;
    var labelEl   = playBtn ? playBtn.querySelector(".ab-play-label") : null;

    var TABS = Array.prototype.slice.call(document.querySelectorAll("#demo .ab-tab"));
    var N = 168;                                  // nombre de barres
    var peaks = { avant: null, apres: null };
    var duration = 20, available = false;
    var current = null;                           // exemple actif

    var W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    var split = 0.5;                              // position de la barre (0..1)
    var playFrac = 0;                             // tête de lecture (0..1)
    var playing = false;

    var AC = window.AudioContext || window.webkitAudioContext;
    var actx = null, buf = { avant: null, apres: null }, gain = { avant: null, apres: null };
    var srcNodes = null, startCtxTime = 0, startOffset = 0, rafId = 0, lastWhich = null;
    var masterGain = null;
    var isMulti = false;
    var buf2 = { avant: null, apres: null };
    var peaks2 = { avant: null, apres: null };
    var W2 = 0, H2 = 0;
    var canvas2 = document.getElementById("abTrack1");
    var canvas3 = document.getElementById("abTrack2");
    var ctx2 = canvas2 ? canvas2.getContext("2d") : null;
    var ctx3 = canvas3 ? canvas3.getContext("2d") : null;
    var abDual = document.getElementById("abDual");

    /* ---------- données ---------- */
    function fallbackPeaks() {
      var a = [], b = [];
      for (var i = 0; i < N; i++) {
        var t = i / N;
        var syl = Math.pow(Math.abs(Math.sin(t * Math.PI * 9)), 1.6);
        var phrase = 0.55 + 0.45 * Math.sin(t * Math.PI * 2.2 + 0.6);
        var base = Math.max(0.05, syl * phrase * ((i % 17 > 13) ? 0.12 : 1));
        b.push(Math.min(1, base * 0.9 + 0.22));   // AVANT : plancher de souffle
        a.push(Math.min(1, base));                // APRÈS : propre
      }
      peaks = { avant: b, apres: a };             // objet neuf (n'altère pas un exemple en cache)
    }
    function mergeChannels(abuf) {
      var l = abuf.getChannelData(0), r = abuf.getChannelData(1), m = new Float32Array(l.length);
      for (var i = 0; i < l.length; i++) m[i] = (l[i] + r[i]) * 0.5;
      return m;
    }
    function computePeaks(abuf) {
      var ch = abuf.numberOfChannels > 1 ? mergeChannels(abuf) : abuf.getChannelData(0);
      var block = Math.max(1, Math.floor(ch.length / N)), out = [];
      for (var i = 0; i < N; i++) {
        var start = i * block, max = 0;
        for (var j = 0; j < block; j++) { var val = Math.abs(ch[start + j] || 0); if (val > max) max = val; }
        out.push(max);
      }
      var pk = 0; out.forEach(function (v) { if (v > pk) pk = v; });
      if (pk > 0) out = out.map(function (v) { return Math.min(1, v / pk); });
      return out;
    }

    function setSoon(on) {
      if (audioWrap) audioWrap.classList.toggle("is-soon", on);
      if (soonEl) soonEl.hidden = !on;
      if (playBtn) playBtn.disabled = on;
    }
    setSoon(true);

    /* ---------- exemples (onglets) + décodage ---------- */
    var EXAMPLES = TABS.map(function (el) {
      return {
        el: el, key: el.getAttribute("data-key"),
        avant: el.getAttribute("data-avant"), apres: el.getAttribute("data-apres"),
        multi: el.getAttribute("data-multi") === "true",
        avant2: el.getAttribute("data-avant-2"), apres2: el.getAttribute("data-apres-2"),
        buf: null, peaks: null, buf2: null, peaks2: null, duration: 0, ok: null, _decoded: false
      };
    });

    function fetchDecode(url) {
      return fetch(url)
        .then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); })
        .then(function (ab) { return actx.decodeAudioData(ab); })
        .catch(function () { return null; });
    }
    function decodeExample(ex) {
      if (ex._decoded) return Promise.resolve(ex);
      ex._decoded = true;
      var urls = [ex.avant, ex.apres];
      if (ex.multi && ex.avant2 && ex.apres2) urls.push(ex.avant2, ex.apres2);
      return Promise.all(urls.map(fetchDecode)).then(function (res) {
        if (res[0] && res[1]) {
          ex.buf = { avant: res[0], apres: res[1] };
          ex.peaks = { avant: computePeaks(res[0]), apres: computePeaks(res[1]) };
          ex.duration = Math.min(res[0].duration, res[1].duration);
          if (ex.multi && res[2] && res[3]) {
            ex.buf2 = { avant: res[2], apres: res[3] };
            ex.peaks2 = { avant: computePeaks(res[2]), apres: computePeaks(res[3]) };
            ex.duration = Math.min(ex.duration, res[2].duration, res[3].duration);
          }
          ex.ok = true;
        } else { ex.ok = false; }
        return ex;
      }).catch(function () { ex.ok = false; return ex; });
    }
    function markTab(ex) {
      var soon = ex.ok === false;
      ex.el.classList.toggle("is-soon", soon);
      if (soon) ex.el.setAttribute("aria-disabled", "true");
      else ex.el.removeAttribute("aria-disabled");
    }
    function setActiveTab(ex) {
      EXAMPLES.forEach(function (e) {
        var on = e === ex;
        e.el.classList.toggle("is-active", on);
        e.el.setAttribute("aria-selected", on ? "true" : "false");
      });
    }
    function applyExample(ex) {
      isMulti = !!ex.multi;
      peaks = ex.peaks; buf = ex.buf; duration = ex.duration; available = true;
      buf2 = ex.buf2 || { avant: null, apres: null };
      peaks2 = ex.peaks2 || { avant: null, apres: null };
      if (abDual) abDual.hidden = !isMulti;
      canvas.style.display = isMulti ? "none" : "";
      frame.classList.toggle("is-multi", isMulti);
      setSoon(false); setSplit(0.5); playFrac = 0;
      resize();
    }
    function activate(ex) {
      if (!ex || ex.ok === false) return;
      stop(true);
      current = ex; setActiveTab(ex);
      var _note = document.getElementById("abNote");
      if (_note) { var _t = ex.el.getAttribute("data-note") || ""; _note.innerHTML = _t; _note.hidden = !_t; }
      if (ex.peaks) { applyExample(ex); return; }
      available = false; setSoon(true);          // état chargement
      decodeExample(ex).then(function () {
        markTab(ex);
        if (current !== ex) return;              // l'utilisateur a déjà changé d'onglet
        if (ex.ok) applyExample(ex);
        else setSoon(true);
      });
    }

    TABS.forEach(function (el) {
      el.addEventListener("click", function () {
        var ex = EXAMPLES.filter(function (e) { return e.el === el; })[0];
        if (ex && ex.ok !== false) activate(ex);
      });
    });

    // Présence d'un exemple SANS le télécharger (HEAD léger) : sert à marquer les
    // onglets « à venir » sans tirer ~3 Mo d'audio au chargement. Un 404 => « à venir » ;
    // tout autre cas => on laisse le clic décider (au cas où un hôte bloque HEAD).
    function probe(ex) {
      return fetch(ex.avant, { method: "HEAD" })
        .then(function (r) { if (r.status === 404) ex.ok = false; })
        .catch(function () {})
        .then(function () { markTab(ex); return ex; });
    }

    function init() {
      if (!window.fetch || !AC) { fallbackPeaks(); render(); return; }
      try { actx = new AC(); } catch (e) { fallbackPeaks(); render(); return; }
      // On SONDE la présence (HEAD, sans télécharger) puis on ne DÉCODE que le 1er
      // exemple disponible. Les autres restent paresseux : décodés au clic (activate()).
      Promise.all(EXAMPLES.map(probe)).then(function () {
        var first = EXAMPLES.filter(function (e) { return e.ok !== false; })[0];
        if (first) activate(first);
        else { fallbackPeaks(); setSoon(true); render(); }
      });
    }

    /* ---------- dessin ---------- */
    function resize() {
      if (isMulti) {
        var r = frame.getBoundingClientRect();
        W2 = Math.max(1, r.width - 46);
        H2 = Math.max(90, Math.min(160, W2 * 0.13));
        [canvas2, canvas3].forEach(function (c) {
          if (!c) return;
          c.width = Math.round(W2 * dpr); c.height = Math.round(H2 * dpr);
          c.style.height = H2 + "px";
        });
        if (ctx2) ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (ctx3) ctx3.setTransform(dpr, 0, 0, dpr, 0, 0);
        render();
      } else {
        var r = frame.getBoundingClientRect();
        W = r.width; H = Math.max(180, Math.min(300, r.width * 0.26));
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
        canvas.style.height = H + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        render();
      }
    }
    function roundRect(x, y, w, h, r) {
      ctx.beginPath(); ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
    function drawTrack(ctxC, trW, trH, pk) {
      if (!pk || !pk.avant || trW < 1) return;
      ctxC.clearRect(0, 0, trW, trH);
      var mid = trH / 2, step = trW / N, bw = step * 0.62, px = playFrac * trW;
      ctxC.strokeStyle = "rgba(255,255,255,.06)"; ctxC.lineWidth = 1;
      ctxC.beginPath(); ctxC.moveTo(0, mid + 0.5); ctxC.lineTo(trW, mid + 0.5); ctxC.stroke();
      for (var i = 0; i < N; i++) {
        var bx = i * step + (step - bw) / 2, frac = (i + 0.5) / N;
        var left = frac < split;
        var data = left ? pk.avant : pk.apres;
        var hh = Math.max(1.5, data[i] * (trH * 0.44));
        var played = frac <= playFrac;
        if (left) { ctxC.fillStyle = played ? "#aab4bd" : "#525c66"; }
        else      { ctxC.fillStyle = played ? "#5fe0bb" : "#2c8f73"; }
        if (!left && played) { ctxC.shadowColor = "#34d3a6"; ctxC.shadowBlur = 6; } else { ctxC.shadowBlur = 0; }
        var rr = Math.min(bw / 2, 2.2), yy = mid - hh;
        ctxC.beginPath(); ctxC.moveTo(bx + rr, yy);
        ctxC.arcTo(bx + bw, yy, bx + bw, yy + hh * 2, rr); ctxC.arcTo(bx + bw, yy + hh * 2, bx, yy + hh * 2, rr);
        ctxC.arcTo(bx, yy + hh * 2, bx, yy, rr); ctxC.arcTo(bx, yy, bx + bw, yy, rr); ctxC.closePath();
        ctxC.fill();
      }
      ctxC.shadowBlur = 0;
      if (playing || playFrac > 0.0005) {
        ctxC.strokeStyle = "rgba(244,247,249,.92)"; ctxC.lineWidth = 2;
        ctxC.beginPath(); ctxC.moveTo(px, 5); ctxC.lineTo(px, trH - 5); ctxC.stroke();
      }
    }
    function render() {
      if (isMulti) {
        if (ctx2) drawTrack(ctx2, W2, H2, peaks);
        if (ctx3) drawTrack(ctx3, W2, H2, peaks2);
      } else {
        if (!peaks.avant) return;
        ctx.clearRect(0, 0, W, H);
        var mid = H / 2, step = W / N, bw = step * 0.62, px = playFrac * W;
        ctx.strokeStyle = "rgba(255,255,255,.06)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, mid + 0.5); ctx.lineTo(W, mid + 0.5); ctx.stroke();
        for (var i = 0; i < N; i++) {
          var bx = i * step + (step - bw) / 2, frac = (i + 0.5) / N;
          var left = frac < split;
          var data = left ? peaks.avant : peaks.apres;
          var h = Math.max(1.5, data[i] * (H * 0.44));
          var played = frac <= playFrac;
          if (left) { ctx.fillStyle = played ? "#aab4bd" : "#525c66"; }
          else      { ctx.fillStyle = played ? "#5fe0bb" : "#2c8f73"; }
          if (!left && played) { ctx.shadowColor = "#34d3a6"; ctx.shadowBlur = 6; } else { ctx.shadowBlur = 0; }
          roundRect(bx, mid - h, bw, h * 2, Math.min(bw / 2, 2.2)); ctx.fill();
        }
        ctx.shadowBlur = 0;
        if (playing || playFrac > 0.0005) {
          ctx.strokeStyle = "rgba(244,247,249,.92)"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(px, 5); ctx.lineTo(px, H - 5); ctx.stroke();
        }
      }
    }

    function setSplit(frac) {
      split = Math.max(0.04, Math.min(0.96, frac));
      divider.style.left = (split * 100) + "%";
      divider.setAttribute("aria-valuenow", Math.round(split * 100));
      render();
    }

    /* ---------- lecture (Web Audio, deux pistes synchrones) ---------- */
    function whichAt(frac) { return frac < split ? "avant" : "apres"; }
    function applyGain(force) {
      if (!available || !gain.avant) return;
      var w = whichAt(playFrac);
      if (w === lastWhich && !force) return;
      lastWhich = w;
      var now = actx.currentTime;
      gain.avant.gain.setTargetAtTime(w === "avant" ? 1 : 0, now, 0.012);
      gain.apres.gain.setTargetAtTime(w === "apres" ? 1 : 0, now, 0.012);
    }
    function stopNodes() {
      if (srcNodes) {
        srcNodes.forEach(function (n) { try { n.onended = null; n.stop(); } catch (e) {} });
        srcNodes = null;
      }
    }
    function elapsed() { return startOffset + (actx.currentTime - startCtxTime); }
    function startAt(offset) {
      stopNodes();
      gain.avant = actx.createGain(); gain.apres = actx.createGain();
      gain.avant.gain.value = 0; gain.apres.gain.value = 0;
      masterGain = actx.createGain();
      var volEl = document.getElementById("abVol");
      masterGain.gain.value = volEl ? parseFloat(volEl.value) / 100 : 0.5;
      masterGain.connect(actx.destination);
      var sa = actx.createBufferSource(); sa.buffer = buf.avant;
      var sb = actx.createBufferSource(); sb.buffer = buf.apres;
      sa.connect(gain.avant).connect(masterGain);
      sb.connect(gain.apres).connect(masterGain);
      var nodes = [sa, sb];
      if (isMulti && buf2.avant && buf2.apres) {
        var sc = actx.createBufferSource(); sc.buffer = buf2.avant;
        var sd = actx.createBufferSource(); sd.buffer = buf2.apres;
        sc.connect(gain.avant);
        sd.connect(gain.apres);
        nodes.push(sc, sd);
        sc.start(0, offset); sd.start(0, offset);
      }
      srcNodes = nodes; lastWhich = null;
      startCtxTime = actx.currentTime; startOffset = offset;
      sa.start(0, offset); sb.start(0, offset);
      applyGain(true);
    }
    function loop() {
      if (!playing) return;
      var t = elapsed();
      if (t >= duration) { stop(true); return; }
      playFrac = t / duration;
      applyGain(false);
      render();
      rafId = requestAnimationFrame(loop);
    }
    function play() {
      if (!available) return;
      if (actx.state === "suspended") actx.resume();
      if (playFrac >= 0.999) playFrac = 0;
      startAt(playFrac * duration);
      playing = true; setIcon(true);
      cancelAnimationFrame(rafId); rafId = requestAnimationFrame(loop);
    }
    function stop(reset) {
      playing = false; stopNodes(); cancelAnimationFrame(rafId);
      if (reset) playFrac = 0;
      setIcon(false); render();
    }
    function setIcon(on) {
      if (iconEl) iconEl.textContent = on ? "❚❚" : "▶";
      if (labelEl) labelEl.textContent = on ? "Pause" : (currentLang === "en" ? "Listen" : "Écouter");
    }

    if (playBtn) playBtn.addEventListener("click", function () {
      if (!available) return;
      if (playing) stop(false); else play();
    });

    var volEl = document.getElementById("abVol");
    if (volEl) volEl.addEventListener("input", function () {
      if (masterGain) masterGain.gain.value = parseFloat(this.value) / 100;
    });

    // barre d'espace = pause / lecture (sans casser le scroll quand on est ailleurs)
    function demoInView() {
      var r = frame.getBoundingClientRect();
      return r.top < window.innerHeight * 0.9 && r.bottom > window.innerHeight * 0.1;
    }
    document.addEventListener("keydown", function (e) {
      if (e.code !== "Space" && e.key !== " ") return;
      var t = e.target, tag = t && t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
      if (tag === "BUTTON" || tag === "A") return;          // laisse l'activation native
      if (!available) return;
      if (!playing && !demoInView()) return;                // ne vole pas l'espace au scroll
      e.preventDefault();
      if (playing) stop(false); else play();
    });

    /* ---------- glisser la barre / cliquer pour seek ---------- */
    var dragging = false;
    function fracFromX(clientX) { var r = frame.getBoundingClientRect(); return (clientX - r.left) / r.width; }

    divider.addEventListener("pointerdown", function (e) {
      dragging = true; e.stopPropagation(); e.preventDefault();
      try { divider.setPointerCapture(e.pointerId); } catch (_) {}
    });
    window.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      setSplit(fracFromX(e.clientX)); applyGain(false);
    });
    window.addEventListener("pointerup", function () { dragging = false; });
    window.addEventListener("pointercancel", function () { dragging = false; });

    // clic dans la forme d'onde = déplacer la tête de lecture
    frame.addEventListener("pointerdown", function (e) {
      if (e.target.closest(".ab-divider") || e.target.closest(".ab-rail") || e.target.closest(".ab-audio")) return;
      playFrac = Math.max(0, Math.min(0.999, fracFromX(e.clientX)));
      if (available && playing) startAt(playFrac * duration);
      render();
    });

    divider.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { setSplit(split - 0.04); applyGain(false); e.preventDefault(); }
      else if (e.key === "ArrowRight") { setSplit(split + 0.04); applyGain(false); e.preventDefault(); }
      else if (e.key === "Home") { setSplit(0.04); applyGain(false); e.preventDefault(); }
      else if (e.key === "End") { setSplit(0.96); applyGain(false); e.preventDefault(); }
    });

    var rT;
    window.addEventListener("resize", function () { clearTimeout(rT); rT = setTimeout(resize, 120); });
    window.addEventListener("load", resize);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize);

    // certains navigateurs n'ont pas encore la largeur du cadre au 1er passage :
    // on redessine jusqu'à ce que le cadre soit mesuré (max ~1 s).
    function ensureSized(tries) {
      resize();
      if (W < 10 && W2 < 10 && tries > 0) {
        requestAnimationFrame(function () { ensureSized(tries - 1); });
      }
    }

    fallbackPeaks();  // visuel immédiat avant décodage
    ensureSized(60);
    init();
  })();

  /* ============================================================
     ANIMATIONS EMBARQUÉES (artefacts fournis, iframes same-origin)
     ------------------------------------------------------------
     Chaque animation est un bundle qui réécrit son doc → on injecte du CSS
     DANS l'iframe (même origine) pour ne garder que le visuel (.board,
     colonne texte .copy masquée), fond transparent, puis on dimensionne
     l'iframe à la hauteur du visuel. Ré-appliqué en boucle pour survivre au
     rendu du bundle + à l'animation. (Marche en local et en prod tant que
     le site est servi depuis une seule origine.)
     ============================================================ */
  (function embedArtifacts() {
    var CSS =
      "html,body{height:auto!important;min-height:0!important;background:transparent!important;margin:0!important;padding:0!important;overflow:hidden!important;}" +
      "body{display:block!important;}" +
      "#__bundler_loading,#__bundler_thumbnail{display:none!important;}" +
      ".section{min-height:0!important;padding:0!important;display:block!important;background:transparent!important;}" +
      ".wrap{display:block!important;width:100%!important;max-width:none!important;margin:0!important;padding:0!important;}" +
      ".wrap>.copy{display:none!important;}" +
      ".wrap>.head{display:none!important;}" +
      ".meter__lufs{display:none!important;}" +
      ".board{width:100%!important;margin:0!important;padding:0!important;}" +
      ".card{width:100%!important;max-width:none!important;margin:0!important;}";

    function mount(id, sizeSel) {
      var f = document.getElementById(id);
      if (!f) return;
      function apply() {
        var d;
        try { d = f.contentDocument; } catch (e) { return; }
        if (!d || !d.documentElement) return;
        if (!d.getElementById("aireo-embed-fix")) {
          var st = d.createElement("style");
          st.id = "aireo-embed-fix";
          st.textContent = CSS;
          (d.head || d.documentElement).appendChild(st);
        }
        var el = d.querySelector(sizeSel) || d.querySelector(".board") || d.body;
        if (el) {
          var h = Math.ceil(el.getBoundingClientRect().height);
          if (h > 60) f.style.height = h + "px";
        }
      }
      f.addEventListener("load", apply);
      var n = 0, iv = setInterval(function () { apply(); if (++n > 60) clearInterval(iv); }, 120);
      var rT;
      window.addEventListener("resize", function () { clearTimeout(rT); rT = setTimeout(apply, 150); });
    }

    mount("aafTimeline", ".card");   // section AAF — « tri d'avant-mix »
    mount("automixViz", ".board");   // section Autolevel — micros équilibrés
    mount("destViz", ".wrap");       // section Destinations — grille + formats (en-tête .head masqué)
  })();

  /* ============================================================
     PAIEMENT — Lemon Squeezy (checkout hébergé)
     ------------------------------------------------------------
     ► POUR ACTIVER LE PAIEMENT : collez ci-dessous les URLs "Buy"
       de vos produits Lemon Squeezy (Boutique → Produit → Share /
       "Buy" link). Exemple : "https://aireo.lemonsqueezy.com/buy/xxxxxxxx".
       Dès qu'une URL est renseignée, le bouton ouvre l'overlay de
       paiement. Laissée vide, le bouton affiche un message "à venir".
       (Le palier Entreprise/École reste un lien mailto dans le HTML.)
     ============================================================ */
  var LS_CHECKOUT = {
    light: "https://aireo.lemonsqueezy.com/checkout/buy/1b0b9064-306e-4b2e-b277-73846995c545",   // Aireo Light (79 €)
    pro:   "https://aireo.lemonsqueezy.com/checkout/buy/93f045fa-f259-468a-8064-49966a30a91c"    // Aireo Pro (189 €)
  };

  var SOON = {
    fr: "Paiement en cours de configuration — disponible très bientôt.",
    en: "Checkout is being set up — available very soon."
  };

  var note = document.getElementById("checkoutNote");
  var noteFR = note ? note.getAttribute("data-fr") : null;
  var noteEN = note ? note.getAttribute("data-en") : null;
  var noteOrig = note ? note.innerHTML : null;

  function restoreNote() {
    if (!note) return;
    note.classList.remove("is-soon");
    if (noteFR != null) note.setAttribute("data-fr", noteFR);
    if (noteEN != null) note.setAttribute("data-en", noteEN);
    note.innerHTML = (currentLang === "en" ? noteEN : noteFR) || noteOrig;
  }

  document.querySelectorAll(".tier-buy[data-tier]").forEach(function (btn) {
    var tier = btn.getAttribute("data-tier");
    if (tier === "enterprise") return; // lien mailto géré par le HTML
    var url = LS_CHECKOUT[tier];
    if (url) {
      // URL renseignée : on laisse Lemon Squeezy (lemon.js) gérer l'overlay
      btn.setAttribute("href", url + (url.indexOf("?") === -1 ? "?embed=1" : "&embed=1"));
      btn.classList.add("lemonsqueezy-button");
    } else {
      // pas encore configuré : message clair, aucune navigation cassée
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        if (note) {
          note.classList.add("is-soon");
          note.removeAttribute("data-fr"); note.removeAttribute("data-en");
          note.textContent = SOON[currentLang] || SOON.fr;
          note.scrollIntoView({ block: "nearest" });
          clearTimeout(restoreNote._t);
          restoreNote._t = setTimeout(restoreNote, 4200);
        }
      });
    }
  });

  // si lemon.js est chargé après coup, ré-initialise la liaison des boutons
  if (window.createLemonSqueezy) { try { window.createLemonSqueezy(); } catch (e) {} }

  /* ============================================================
     TÉLÉCHARGEMENT — Mac vs Windows séparés
     ------------------------------------------------------------
     Phase actuelle : seul le DMG macOS (puce Apple) est en ligne.
     Windows = « bientôt ». Quand le build Win sera prêt : passer
     WIN_AVAILABLE à true et coller WIN_URL.
     Le bouton .js-dl s'adapte à l'OS détecté ; sa note (#id via
     data-note) explique la plateforme.
     ============================================================ */
  var MAC_URL = "https://github.com/robinmichel92/aireo-downloads/releases/latest/download/Aireo-mac-arm64.dmg";
  var WIN_AVAILABLE = false;
  var WIN_URL = "";   // ← URL du .exe/installeur Windows quand prêt

  function detectOS() {
    var ua = navigator.userAgent || "";
    var pf = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    if (/Win/i.test(pf) || /Windows/i.test(ua)) return "win";
    if (/iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(pf) && navigator.maxTouchPoints > 1)) return "ios";
    if (/Mac/i.test(pf) || /Macintosh/i.test(ua)) return "mac";
    return "other";
  }

  var DL = {
    macBtn:   { fr: "⬇ Télécharger pour macOS",       en: "⬇ Download for macOS" },
    winBtn:   { fr: "Windows — bientôt disponible",    en: "Windows — coming soon" },
    winReady: { fr: "⬇ Télécharger pour Windows",      en: "⬇ Download for Windows" },
    macNote:  { fr: "macOS · puce Apple (M1–M4) · ~1,2 Go. Au 1er lancement : clic droit sur Aireo puis « Ouvrir ».",
                en: "macOS · Apple silicon (M1–M4) · ~1.2 GB. First launch: right-click Aireo then “Open”." },
    winNote:  { fr: "La version Windows arrive très bientôt. La version macOS (puce Apple) est disponible dès maintenant.",
                en: "The Windows version is coming very soon. The macOS (Apple silicon) version is available now." },
    otherNote:{ fr: "Aireo est une app de bureau : macOS (puce Apple) disponible, Windows bientôt.",
                en: "Aireo is a desktop app: macOS (Apple silicon) available, Windows coming soon." }
  };

  function applyDownloads() {
    var os = detectOS();
    var L = (document.documentElement.lang === "en") ? "en" : "fr";
    document.querySelectorAll(".js-dl").forEach(function (btn) {
      var note = btn.getAttribute("data-note") ? document.getElementById(btn.getAttribute("data-note")) : null;
      btn.classList.remove("is-soon");
      btn.removeAttribute("download");
      btn.onclick = null;
      if (os === "win" && !WIN_AVAILABLE) {
        btn.textContent = DL.winBtn[L];
        btn.setAttribute("href", "#tarifs");
        btn.classList.add("is-soon");
        btn.onclick = function (e) { e.preventDefault(); };
        if (note) note.textContent = DL.winNote[L];
      } else if (os === "win") {
        btn.textContent = DL.winReady[L];
        btn.setAttribute("href", WIN_URL);
        btn.setAttribute("download", "");
        if (note) note.textContent = "";
      } else {
        // mac / ios / autre : on sert le DMG macOS (seule plateforme dispo)
        btn.textContent = DL.macBtn[L];
        btn.setAttribute("href", MAC_URL);
        btn.setAttribute("download", "");
        if (note) note.textContent = (os === "mac") ? DL.macNote[L] : DL.otherNote[L];
      }
    });
  }

  applyDownloads();
  document.querySelectorAll(".lang-btn").forEach(function (b) {
    b.addEventListener("click", function () { setTimeout(applyDownloads, 0); });
  });
})();
