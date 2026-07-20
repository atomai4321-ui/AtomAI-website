/* AtomAI front-end behaviour — no backend/Flask logic here. */
(function () {
  "use strict";

  /* -------------------------------------------------------------
     1. Material families dropdown
     ------------------------------------------------------------- */
  const trigger = document.getElementById("familyMenuTrigger");
  const panel = document.getElementById("familyMenuPanel");

  if (trigger && panel) {
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = panel.classList.toggle("is-open");
      trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
    document.addEventListener("click", (e) => {
      if (!panel.contains(e.target) && e.target !== trigger) {
        panel.classList.remove("is-open");
        trigger.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        panel.classList.remove("is-open");
        trigger.setAttribute("aria-expanded", "false");
      }
    });
  }

  /* -------------------------------------------------------------
     2. Scrollspy — highlight the active nav link
     ------------------------------------------------------------- */
  const navLinks = Array.from(document.querySelectorAll(".nav__links a[data-nav]"));
  const sections = navLinks
    .map((link) => document.getElementById(link.dataset.nav))
    .filter(Boolean);

  if (sections.length) {
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            navLinks.forEach((l) => l.classList.remove("active"));
            const active = navLinks.find((l) => l.dataset.nav === entry.target.id);
            if (active) active.classList.add("active");
          }
        });
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: 0 }
    );
    sections.forEach((s) => spy.observe(s));
  }

  /* -------------------------------------------------------------
     3. Reveal-on-scroll for .reveal elements
     ------------------------------------------------------------- */
  const revealTargets = document.querySelectorAll(".reveal");
  if (revealTargets.length) {
    const revealObserver = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    revealTargets.forEach((el) => revealObserver.observe(el));
  }

  /* -------------------------------------------------------------
     4. Timeline active-year highlight while scrolling
     ------------------------------------------------------------- */
  const timelineItems = document.querySelectorAll(".timeline__item");
  if (timelineItems.length) {
    const timelineObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle("in-view", entry.isIntersecting);
        });
      },
      { threshold: 0.5 }
    );
    timelineItems.forEach((item) => timelineObserver.observe(item));
  }

  /* -------------------------------------------------------------
     5. Animated stat counters
     ------------------------------------------------------------- */
  const statNums = document.querySelectorAll(".stat-card__num");
  if (statNums.length) {
    const countUp = (el) => {
      const target = parseFloat(el.dataset.target) || 0;
      const suffix = el.dataset.suffix || "";
      const prefix = el.dataset.prefix || "";
      const duration = 1200;
      const start = performance.now();

      const step = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const value = target * eased;
        const display = Number.isInteger(target) ? Math.round(value) : value.toFixed(1);
        el.innerHTML = prefix + display + suffix;
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };

    const statObserver = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            countUp(entry.target);
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.4 }
    );
    statNums.forEach((el) => statObserver.observe(el));
  }

  /* -------------------------------------------------------------
     6. Ion notation — "Bi3+" -> "Bi" + superscript "3+"
     ------------------------------------------------------------- */
  const formatIons = (scope) => {
    scope.querySelectorAll(".ion-notation").forEach((el) => {
      const raw = el.dataset.ion || el.textContent.trim();
      const match = raw.match(/^([A-Za-z]+)(\d+)([+-])$/);
      if (match) {
        const [, symbol, num, sign] = match;
        el.innerHTML = `${symbol}<sup>${num}${sign}</sup>`;
      }
    });
  };
  formatIons(document);

  /* -------------------------------------------------------------
     7. AJAX search — same Flask route ("/"), no full page reload,
        no scroll jump. Falls back to a normal form submit if fetch
        fails for any reason.
     ------------------------------------------------------------- */
  const form = document.getElementById("searchForm");
  const resultsWrapper = document.getElementById("resultsWrapper");
  const searchBtn = document.getElementById("searchBtn");

  if (form && resultsWrapper) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      // Move focus off the input so the on-screen keyboard / caret
      // doesn't cause an unexpected jump, without scrolling the page.
      document.activeElement && document.activeElement.blur();

      const originalBtnHTML = searchBtn.innerHTML;
      searchBtn.disabled = true;
      searchBtn.innerHTML = "<span>Searching&hellip;</span>";

      try {
        const formData = new FormData(form);
        const response = await fetch(form.action || window.location.pathname, {
          method: "POST",
          body: formData,
        });
        const html = await response.text();

        const parsed = new DOMParser().parseFromString(html, "text/html");
        const newResults = parsed.getElementById("resultsWrapper");
        const newInputs = parsed.querySelectorAll("#searchForm input");

        if (newResults) {
          resultsWrapper.innerHTML = newResults.innerHTML;
        }
        // Reflect any server-side normalization (capitalization) back
        // into the visible inputs without moving focus or scrolling.
        if (newInputs.length) {
          newInputs.forEach((input) => {
            const local = form.querySelector(`#${input.id}`);
            if (local) local.value = input.value;
          });
        }

        // Re-apply reveal/animation classes for any new result cards.
        resultsWrapper.querySelectorAll(".reveal").forEach((el) => el.classList.add("in-view"));
        formatIons(resultsWrapper);
      } catch (err) {
        // Network or parsing issue — fall back to a normal submit.
        form.submit();
      } finally {
        searchBtn.disabled = false;
        searchBtn.innerHTML = originalBtnHTML;
      }
    });
  }
})();
