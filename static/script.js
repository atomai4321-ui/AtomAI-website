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

  /* -------------------------------------------------------------
     8. Shared helpers for the client-rendered searches below
     ------------------------------------------------------------- */
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function fmtNum(v, digits) {
    return typeof v === "number" && !Number.isNaN(v) ? v.toFixed(digits) : "\u2014";
  }

  /* -------------------------------------------------------------
     9. Shared material-detail renderer — used by the modal, called
        from both the Band Gap and Atom results tables. Mirrors the
        Jinja markup of a server-rendered .result card exactly
        (.result__header, .badges, .result__metrics, .metric-col,
        .atoms-title, .atom-table) so a row looks identical whether
        it came from the server or a client-side fetch. There is
        exactly one copy of this function — do not duplicate it.
     ------------------------------------------------------------- */
  const SITE_LABELS = ["A", "A\u2032", "B", "B\u2032"];

  function renderMaterialDetailHTML(m) {
    const atomsRow = (m.atoms || [])
      .map(
        (a) =>
          `<span class="ion-notation" data-ion="${escapeHtml(a.Atom_Key)}">${escapeHtml(a.Atom_Key)}</span>`
      )
      .join("");

    const atomRows = (m.atoms || [])
      .map(
        (a, i) => `
        <tr>
          <td><span class="atom-card__site">${SITE_LABELS[i] || ""}</span></td>
          <td class="atom-table__ion"><span class="ion-notation" data-ion="${escapeHtml(a.Atom_Key)}">${escapeHtml(a.Atom_Key)}</span></td>
          <td>${escapeHtml(a.radii)} &Aring;</td>
          <td>${escapeHtml(a.Electronegativity)}</td>
          <td>${escapeHtml(a.Ionization_Energy)}</td>
          <td>${escapeHtml(a.Electron_Affinity)}</td>
          <td>${escapeHtml(a.Atomic_Volume)}</td>
          <td>${escapeHtml(a.HOMO)}</td>
          <td>${escapeHtml(a.LUMO)}</td>
          <td>${escapeHtml(a.Group)}</td>
          <td>${escapeHtml(a.Period)}</td>
          <td>${escapeHtml(a.Thermal_Conductivity)}</td>
        </tr>`
      )
      .join("");

    const typeChip = m.dpo_type_pattern
      ? `<span class="type-chip">${escapeHtml(m.dpo_type_pattern)}</span>`
      : "";

    const confidenceBlock =
      m.mean_confidence != null
        ? `<div class="metric-col"><label>Confidence</label><span>${fmtNum(m.mean_confidence * 100, 1)}<small>%</small></span></div>`
        : "";

    return `
      <div class="result__header">
        <div>
          <p class="eyebrow eyebrow--type">${escapeHtml(m.dpo_type_label)} DPO ${typeChip}</p>
          <h3 class="formula">
            <svg viewBox="0 0 20 20" fill="none" class="formula__icon"><circle cx="10" cy="10" r="2" fill="currentColor"/><ellipse cx="10" cy="10" rx="8" ry="3.2" stroke="currentColor" stroke-width="1.2"/><ellipse cx="10" cy="10" rx="8" ry="3.2" stroke="currentColor" stroke-width="1.2" transform="rotate(60 10 10)"/><ellipse cx="10" cy="10" rx="8" ry="3.2" stroke="currentColor" stroke-width="1.2" transform="rotate(120 10 10)"/></svg>
            ${escapeHtml(m.Formula)}
          </h3>
        </div>
        <div class="badges">
          <span class="badge ${m.stable ? "badge--stable" : "badge--unstable"}"><i class="badge__dot"></i>${m.stable ? "Stable" : "Unstable"}</span>
          <span class="badge ${m.Material_Status === "Known" ? "badge--known" : "badge--predicted"}"><i class="badge__dot"></i>${m.Material_Status === "Known" ? "Known" : "Predicted by ML"}</span>
        </div>
      </div>
      <div class="result__metrics">
        <div class="metric-col metric-col--wide">
          <label>Formula with oxidation state</label>
          <span class="ion-row">${atomsRow}</span>
        </div>
        <div class="metric-col"><label>Tolerance factor</label><span>${fmtNum(m.tolerance_factor, 4)}</span></div>
        <div class="metric-col"><label>Octahedral factor</label><span>${fmtNum(m.mu, 4)}</span></div>
        <div class="metric-col"><label>Band gap</label><span>${fmtNum(m.Band_Gap, 4)} <small>eV</small></span></div>
        ${confidenceBlock}
      </div>
      <h4 class="atoms-title">Ionic composition</h4>
      <div class="atom-table-wrap">
        <table class="atom-table">
          <thead><tr>
            <th>Site</th><th>Ion</th><th>Radius</th><th>Electronegativity</th>
            <th>Ionization energy</th><th>Electron affinity</th><th>Atomic volume</th>
            <th>HOMO</th><th>LUMO</th><th>Group</th><th>Period</th><th>Thermal cond.</th>
          </tr></thead>
          <tbody>${atomRows}</tbody>
        </table>
      </div>`;
  }

  const modalOverlay = document.getElementById("materialModalOverlay");
  const modalBody = document.getElementById("materialModalBody");
  const modalClose = document.getElementById("materialModalClose");

  function openMaterialModal(material) {
    if (!modalOverlay || !modalBody) return;
    modalBody.innerHTML = renderMaterialDetailHTML(material);
    formatIons(modalBody);
    modalOverlay.classList.add("is-open");
    document.body.style.overflow = "hidden";
  }
  function closeMaterialModal() {
    if (!modalOverlay) return;
    modalOverlay.classList.remove("is-open");
    document.body.style.overflow = "";
  }
  if (modalClose) modalClose.addEventListener("click", closeMaterialModal);
  if (modalOverlay) {
    modalOverlay.addEventListener("click", (e) => {
      if (e.target === modalOverlay) closeMaterialModal();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMaterialModal();
  });

  /* -------------------------------------------------------------
     10. Generalized results table — one implementation shared by
         the Band Gap search and the Atom search below. Each call
         site gets its own container + state via the factory; the
         sort/filter/paginate/render logic lives in exactly one place.
     ------------------------------------------------------------- */
  const TABLE_COLUMNS = [
    { key: "Formula", label: "Formula", type: "string" },
    { key: "dpo_type_label", label: "DPO Type", type: "string" },
    { key: "Band_Gap", label: "Band Gap (eV)", type: "number" },
    { key: "tolerance_factor", label: "Tolerance Factor", type: "number" },
    { key: "mu", label: "\u03bc", type: "number" },
    { key: "stable", label: "Stable", type: "bool" },
    { key: "Material_Status", label: "Status", type: "string" },
    { key: "mean_confidence", label: "Confidence", type: "number" },
  ];
  const PAGE_SIZE = 25;

  function createResultsTable(container, emptyMessage) {
    const state = { all: [], filtered: [], sortKey: "Formula", sortDir: "asc", page: 1, searched: false };

    function applySort() {
      state.filtered = state.all.slice();
      const col = TABLE_COLUMNS.find((c) => c.key === state.sortKey);
      const dir = state.sortDir === "asc" ? 1 : -1;
      state.filtered.sort((a, b) => {
        let av = a[state.sortKey];
        let bv = b[state.sortKey];
        if (col && col.type === "number") {
          av = typeof av === "number" ? av : -Infinity;
          bv = typeof bv === "number" ? bv : -Infinity;
          return (av - bv) * dir;
        }
        if (col && col.type === "bool") {
          return ((av ? 1 : 0) - (bv ? 1 : 0)) * dir;
        }
        av = String(av || "").toLowerCase();
        bv = String(bv || "").toLowerCase();
        return av.localeCompare(bv) * dir;
      });
      state.page = 1;
      render();
    }

    function renderRow(m) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(m.Formula)}</td>
        <td>${escapeHtml(m.dpo_type_label)}</td>
        <td>${fmtNum(m.Band_Gap, 4)}</td>
        <td>${fmtNum(m.tolerance_factor, 4)}</td>
        <td>${fmtNum(m.mu, 4)}</td>
        <td>${m.stable ? "Stable" : "Unstable"}</td>
        <td>${escapeHtml(m.Material_Status)}</td>
        <td>${m.mean_confidence != null ? fmtNum(m.mean_confidence * 100, 1) + "%" : "\u2014"}</td>`;
      tr.addEventListener("click", () => openMaterialModal(m));
      return tr;
    }

    function render() {
      if (!state.all.length) {
        const html = state.searched
          ? '<div class="notice notice--empty"><strong>No matches.</strong><p>No Double Perovskite materials were found in that range. Try different search criteria.</p></div>'
          : `<div class="notice notice--empty"><strong>No results yet.</strong><p>${emptyMessage}</p></div>`;
        container.innerHTML = html;
        return;
      }

      const totalPages = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
      state.page = Math.min(state.page, totalPages);
      const start = (state.page - 1) * PAGE_SIZE;
      const pageItems = state.filtered.slice(start, start + PAGE_SIZE);

      const theadCells = TABLE_COLUMNS.map((c) => {
        const isSorted = state.sortKey === c.key;
        const arrow = isSorted ? (state.sortDir === "asc" ? "\u25b2" : "\u25bc") : "\u25b2";
        return `<th data-key="${c.key}" class="${isSorted ? "is-sorted" : ""}">${c.label}<span class="sort-arrow">${arrow}</span></th>`;
      }).join("");

      container.innerHTML = `
        <div class="table-toolbar">
          <span class="table-toolbar__count">${state.filtered.length.toLocaleString()} material${state.filtered.length === 1 ? "" : "s"} found</span>
        </div>
        <div class="ion-table-wrap">
          <table class="ion-table"><thead><tr>${theadCells}</tr></thead><tbody></tbody></table>
        </div>
        <div class="pagination">
          <button type="button" data-page="prev" ${state.page <= 1 ? "disabled" : ""}>&larr; Prev</button>
          <span class="pagination__page">Page ${state.page} of ${totalPages}</span>
          <button type="button" data-page="next" ${state.page >= totalPages ? "disabled" : ""}>Next &rarr;</button>
        </div>`;

      const tbody = container.querySelector(".ion-table tbody");
      pageItems.forEach((m) => tbody.appendChild(renderRow(m)));

      container.querySelectorAll(".ion-table thead th").forEach((th) => {
        th.addEventListener("click", () => {
          const key = th.dataset.key;
          if (state.sortKey === key) {
            state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
          } else {
            state.sortKey = key;
            state.sortDir = "asc";
          }
          applySort();
        });
      });

      const prevBtn = container.querySelector('[data-page="prev"]');
      const nextBtn = container.querySelector('[data-page="next"]');
      if (prevBtn) prevBtn.addEventListener("click", () => { state.page -= 1; render(); });
      if (nextBtn) nextBtn.addEventListener("click", () => { state.page += 1; render(); });
    }

    return {
      setResults(materials) {
        state.all = materials || [];
        state.searched = true;
        applySort();
      },
      showMessage(html) {
        container.innerHTML = html;
      },
    };
  }

  /* -------------------------------------------------------------
     11. Band Gap Range search — POST /api/band-gap-search
     ------------------------------------------------------------- */
  const bgResultsWrapper = document.getElementById("bgResultsWrapper");
  const bgSearchBtn = document.getElementById("bgSearchBtn");
  if (bgResultsWrapper && bgSearchBtn) {
    const bgTable = createResultsTable(bgResultsWrapper, "Enter a band gap range above and click Search Materials.");
    const bgStatusToggle = document.getElementById("bgStatusToggle");

    async function runBandGapSearch() {
      const min = parseFloat(document.getElementById("bgMin").value);
      const max = parseFloat(document.getElementById("bgMax").value);
      if (Number.isNaN(min) || Number.isNaN(max)) {
        bgTable.showMessage(
          '<div class="notice notice--error"><strong>Missing values.</strong><p>Please provide both a minimum and maximum band gap.</p></div>'
        );
        return;
      }
      const originalHTML = bgSearchBtn.innerHTML;
      bgSearchBtn.disabled = true;
      bgSearchBtn.innerHTML = "<span>Searching&hellip;</span>";
      try {
        const statuses = bgStatusToggle
          ? Array.from(bgStatusToggle.querySelectorAll(".toggle-btn.is-active")).map((b) => b.dataset.status)
          : [];
        const res = await fetch("/api/band-gap-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ min, max, statuses }),
        });
        const data = await res.json();
        if (data.error) {
          bgTable.showMessage(`<div class="notice notice--error"><strong>Search failed.</strong><p>${escapeHtml(data.error)}</p></div>`);
        } else {
          bgTable.setResults(data.materials);
        }
      } catch (err) {
        bgTable.showMessage('<div class="notice notice--error"><strong>Network error.</strong><p>Please try again.</p></div>');
      } finally {
        bgSearchBtn.disabled = false;
        bgSearchBtn.innerHTML = originalHTML;
      }
    }

    if (bgStatusToggle) {
      bgStatusToggle.querySelectorAll(".toggle-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          btn.classList.toggle("is-active");
          // Auto-rerun the search on status change once min/max are filled
          // in, so switching Known/Predicted updates the table immediately
          // without a separate button click.
          const min = document.getElementById("bgMin").value;
          const max = document.getElementById("bgMax").value;
          if (min !== "" && max !== "") runBandGapSearch();
        });
      });
    }

    bgSearchBtn.addEventListener("click", runBandGapSearch);
  }
})();
