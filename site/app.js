// Сайт: определение системы для кнопки скачивания, живое объявление, язык, автозапуск демо при прокрутке.
(function () {
  "use strict";
  var REL = "https://github.com/GOMIN1I/job-search-desktop/releases/latest/download/";
  var FILES = { mac: REL + "Job-Search-Desktop-mac-arm64.dmg", win: REL + "Job-Search-Desktop-windows-x64-setup.exe" };
  // Язык: сохранённый выбор, иначе язык браузера (русский и близкие — RU, остальные — EN)
  var saved = null;
  try { saved = localStorage.getItem("jsd-site-lang"); } catch (e) { /* хранилище недоступно */ }
  var lang = saved === "ru" || saved === "en" ? saved : /^(ru|uk|be|kk)\b/i.test(navigator.language || "") ? "ru" : "en";

  // --- система ---
  function detectOS() {
    var ua = navigator.userAgent || "";
    var p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    if (/Win/i.test(p) || /Windows/i.test(ua)) return "win";
    if (/Mac/i.test(p) || /Mac OS X/i.test(ua)) return "mac";
    return null;
  }
  var os = detectOS();
  var labels = {
    ru: { mac: "Скачать для macOS", win: "Скачать для Windows", other: "Скачать" },
    en: { mac: "Download for macOS", win: "Download for Windows", other: "Download" },
  };
  function applyOS() {
    var primary = document.getElementById("dl-primary");
    var label = document.getElementById("dl-primary-label");
    var chosen = os || "mac";
    primary.href = FILES[chosen];
    label.textContent = labels[lang][os ? chosen : "other"];
    document.getElementById("dl-mac").setAttribute("aria-current", chosen === "mac" ? "true" : "false");
    document.getElementById("dl-win").setAttribute("aria-current", chosen === "win" ? "true" : "false");
  }

  // --- живое объявление ---
  var verdictText = { ru: { ask: "Уточнить", no: "Не подходит" }, en: { ask: "Clarify", no: "Does not fit" } };
  var callsText = {
    ru: { on: "Звонки обязательны, а вы их не хотите", off: "Звонки есть — вы их допускаете, условие не проверяется" },
    en: { on: "Calls are required, and you don't want them", off: "Calls are part of it — you allow that, so it is not checked" },
  };
  function updatePosting() {
    var noCalls = document.getElementById("no-calls").checked;
    var mark = document.getElementById("calls-mark");
    var note = document.getElementById("calls-note");
    var dot = note.querySelector(".dot");
    var verdict = document.getElementById("hero-verdict");
    mark.classList.toggle("neutral", !noCalls);
    dot.className = "dot " + (noCalls ? "no" : "na");
    dot.textContent = noCalls ? "✕" : "–";
    document.getElementById("calls-note-text").textContent = callsText[lang][noCalls ? "on" : "off"];
    var k = noCalls ? "no" : "ask";
    verdict.className = "verdict v-" + k;
    verdict.querySelector(".glyph").textContent = noCalls ? "✕" : "?";
    document.getElementById("hero-verdict-text").textContent = verdictText[lang][k];
  }
  function wireMarks() {
    var posting = document.querySelector(".posting");
    document.querySelectorAll(".posting .m").forEach(function (m) {
      var li = posting.querySelector('.notes li[data-for="' + m.getAttribute("data-note") + '"]');
      function on() { m.classList.add("hot"); if (li) li.classList.add("hot"); }
      function off() { m.classList.remove("hot"); if (li) li.classList.remove("hot"); }
      m.addEventListener("mouseenter", on); m.addEventListener("mouseleave", off);
      m.setAttribute("tabindex", "0"); m.addEventListener("focus", on); m.addEventListener("blur", off);
    });
    document.getElementById("no-calls").addEventListener("change", updatePosting);
    // Маркер «проводится», когда объявление видно
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { posting.classList.add("ready"); io.disconnect(); } });
    }, { threshold: 0.4 });
    io.observe(posting);
  }

  // --- язык ---
  function applyLang() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-en]").forEach(function (el) {
      if (!el.hasAttribute("data-ru")) el.setAttribute("data-ru", el.textContent.trim());
      el.textContent = lang === "en" ? el.getAttribute("data-en") : el.getAttribute("data-ru");
    });
    var b = document.getElementById("lang");
    b.textContent = lang === "en" ? "RU" : "EN";
    b.setAttribute("aria-label", lang === "en" ? "Переключить на русский" : "Switch to English");
    document.title = lang === "en" ? "Job Search Desktop — finds jobs and marks what matters" : "Job Search Desktop — находит вакансии и отмечает главное";
    // Ролик на выбранном языке; позиция и пауза сохраняются
    var film = document.getElementById("film-video");
    var src = lang === "en" ? "media/job-search-desktop-film-en.mp4" : "media/job-search-desktop-film.mp4";
    if (film && film.getAttribute("data-src") !== src) {
      var wasPlaying = !film.paused, at = film.currentTime || 0, first = !film.getAttribute("data-src");
      film.setAttribute("data-src", src);
      film.poster = lang === "en" ? "media/poster-en.jpg" : "media/poster.jpg";
      film.src = src;
      if (!first && (at > 0 || wasPlaying)) {
        film.addEventListener("loadedmetadata", function resume() {
          film.removeEventListener("loadedmetadata", resume);
          film.currentTime = Math.min(at, film.duration || at);
          if (wasPlaying) { var p = film.play(); if (p && p.catch) p.catch(function () { /* нужен жест пользователя */ }); }
        });
      }
    }
    applyOS();
    updatePosting();
  }

  // --- демо-видео: играют, когда видны (и не играют при «уменьшить движение») ---
  function wireDemos() {
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var vids = document.querySelectorAll("video.demo");
    if (reduce) { vids.forEach(function (v) { v.setAttribute("controls", ""); }); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var v = e.target;
        if (e.isIntersecting) { if (v.preload === "none") v.preload = "auto"; var p = v.play(); if (p && p.catch) p.catch(function () { v.setAttribute("controls", ""); }); }
        else v.pause();
      });
    }, { threshold: 0.5 });
    vids.forEach(function (v) { io.observe(v); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("lang").addEventListener("click", function () {
      lang = lang === "en" ? "ru" : "en";
      try { localStorage.setItem("jsd-site-lang", lang); } catch (e) { /* без сохранения */ }
      applyLang();
    });
    document.getElementById("dl-final").addEventListener("click", function (e) {
      e.preventDefault();
      window.location.href = FILES[os || "mac"];
    });
    wireMarks();
    wireDemos();
    applyLang();
  });
})();
