// ==UserScript==
// @name         Projektzeit-Verteilung Optimierer
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Automatisches Auslesen, Verteilen und Befüllen von Zeitwerten und Comboboxen in SAP UI5 basierten Projektzeit-Formularen
// @author       Jan Lisec
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
  "use strict";

  // ----------------------------------
  // CONFIGURATION
  // ----------------------------------

  const DEFAULT_TARGETS = {
    "CCSA Forschung": 30,
    "CE Forschung": 5,
    "GS Forschung": 25,
    "UMI Forschung": 10,
    "Eigene Qualifizierung": 15,
    "Referenzmaterialien": 10,
    "GS Gremien": 5
  };

  // Feste Selectors
  const SELECTORS = {
    timeInputs:
      'input.sapMInputBaseInner:not(.sapMComboBoxInner)[id*="clone"][id*="input"]',
    statusesA:
      '.sapMObjStatusText[id*="clone"][id*="status"]',
    statusesB:
      '.sapMLnk.sapMLnkMaxWidth[id*="clone"][id*="link"], .sapMLnk[id*="clone"][id*="link"]',
    comboBoxInners:
      'input.sapMComboBoxInner[id*="clone"][id*="box"]'
  };

  // Strikte Prüfung: gleiche Anzahl Status + Input
  const STRICT_COUNT_CHECK = true;

  // Auswahl der Status-Variante
  let statusesSelector = null;
  if (document.querySelector(SELECTORS.statusesA)) {
    statusesSelector = SELECTORS.statusesA;
  } else if (document.querySelector(SELECTORS.statusesB)) {
    statusesSelector = SELECTORS.statusesB;
  } else {
    alert("Keine Status-Elemente gefunden (weder Variante A noch B).");
    return;
  }
  
  // ----------------------------------
  // UTILITIES
  // ----------------------------------

  const util = {

    normalizeText(s) {
      return (s || "")
        .replace(/\u00A0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    },

    parseDEtoNumber(s) {
      if (s == null) return NaN;
      const num = parseFloat(String(s).replace(/\./g, "").replace(",", "."));
      return isNaN(num) ? NaN : num;
    },

    formatDE(num, digits = 2) {
      return Number(num).toFixed(digits).replace(".", ",");
    },

    getCloneIndex(id) {
      if (!id) return null;
      const m = id.match(/clone(\d+)/i);
      return m ? parseInt(m[1], 10) : null;
    },

    extractMaxStr(el) {
      let raw = (typeof el.value === "string" && el.value) ? el.value : el.textContent;
      raw = util.normalizeText(raw);
      let afterSlash = raw.includes("/") ? raw.split("/").pop().trim() : raw;

      let m = afterSlash.match(/\d{1,3}(?:\.\d{3})*,\d+|\d+,\d+/);
      if (m) return m[0];

      m = afterSlash.match(/\d+(?:\.\d+)?/);
      if (m) return m[0].replace(".", ",");

      return null;
    }
  };

// ----------------------------------
  // DOM HELPERS
  // ----------------------------------

  const dom = {

    $allIndexed(selector) {
      return [...document.querySelectorAll(selector)]
        .map(el => ({ el, idx: util.getCloneIndex(el.id) }))
        .filter(x => x.idx !== null)
        .sort((a, b) => a.idx - b.idx);
    },

    setInputValue(input, val) {
      const setter =
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter ? setter.call(input, val) : (input.value = val);

      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },

    getComboBoxControlFromInner(inner) {
      const root = inner.closest(".sapMComboBoxBase, .sapMComboBox");
      if (!root || !window.sap?.ui?.getCore) return null;
      return window.sap.ui.getCore().byId(root.id);
    },

    getSelectableItems(combo) {
      const items = combo?.getItems?.() || [];
      const result = [];
      for (const it of items) {
        const key = it.getKey?.() || it.getProperty?.("key") || "";
        const text = it.getText?.() || it.getProperty?.("text") || "";
        const enabled = it.getEnabled?.() ?? true;
        if (enabled && key !== "" && util.normalizeText(text) !== "") {
          result.push({ item: it, key, text });
        }
      }
      return result;
    }
  };
  
  // ----------------------------------
  // EXTRACTION MODULE
  // ----------------------------------

  const extract = {

    gatherStatusTimes() {
      const rows = dom.$allIndexed(statusesSelector);
      return rows.map(({ el, idx }) => {
        const s = util.extractMaxStr(el);
        const v = util.parseDEtoNumber(s);
        return { idx, str: s, val: isNaN(v) ? 0 : v };
      });
    },

    getSampleSelectableItems() {
      const inners = dom.$allIndexed(SELECTORS.comboBoxInners);
      if (inners.length === 0) return [];
      const combo = dom.getComboBoxControlFromInner(inners[0].el);
      if (!combo) return [];
      return dom.getSelectableItems(combo);
    }
  };
  
  // ----------------------------------
  // OPTIMIZATION MODULE
  // ----------------------------------

  const optimize = {

    weightedDistribution(times, weights) {
      const k = weights.length;
      const S = times.reduce((a, b) => a + b, 0);
      const targets = weights.map(w => w * S);

      // Pair values with original index
      const entries = times
        .map((value, index) => ({ value, index }))
        .sort((a, b) => b.value - a.value);

      const load = Array(k).fill(0);
      const assignment = Array(times.length).fill(0);

      for (const { value, index } of entries) {
        let bestItem = 0;
        let bestCost = Infinity;

        for (let i = 0; i < k; i++) {
          const before = load[i] - targets[i];
          const after = (load[i] + value) - targets[i];
          const delta = (after * after) - (before * before);
          if (delta < bestCost) {
            bestCost = delta;
            bestItem = i;
          }
        }

        assignment[index] = bestItem;
        load[bestItem] += value;
      }

      return { assignment, load, targets, total: S };
    }
  };
  
  // ----------------------------------
  // ASSIGNMENT MODULE
  // ----------------------------------

  const assign = {

    fillTimes(timesRows) {
      const timeInputs = dom.$allIndexed(SELECTORS.timeInputs);
      const statuses = dom.$allIndexed(statusesSelector);

      if (STRICT_COUNT_CHECK && timeInputs.length !== statuses.length) {
        alert(`Abbruch: timeInputs=${timeInputs.length}, statuses=${statuses.length}`);
        return { aborted: true, filled: 0, skipped: 0, errors: 0 };
      }

      const mapInputs = new Map(timeInputs.map(x => [x.idx, x.el]));
      const mapStatus = new Map(statuses.map(x => [x.idx, x.el]));
      const indices = [...mapInputs.keys()].filter(k => mapStatus.has(k));

      let filled = 0, skipped = 0, errors = 0;

      for (const idx of indices) {
        const inputEl = mapInputs.get(idx);
        const statusEl = mapStatus.get(idx);
        const valStr = util.extractMaxStr(statusEl);

        if (!valStr || valStr === "0,00") {
          skipped++;
          continue;
        }

        try {
          inputEl.focus();
          dom.setInputValue(inputEl, valStr);
          inputEl.blur();
          filled++;
        } catch {
          errors++;
        }
      }

      return { aborted: false, filled, skipped, errors };
    },

    selectBoxes(assignment, times, items) {
      const inners = dom.$allIndexed(SELECTORS.comboBoxInners);
      if (inners.length === 0) {
        return { selected: 0, skipped: 0, errors: 0 };
      }

      const mapInners = new Map(inners.map(x => [x.idx, x.el]));
      const statuses = dom.$allIndexed(statusesSelector);
      const rowsIdx = statuses.map(x => x.idx);

      let selected = 0, skipped = 0, errors = 0;

      for (let row = 0; row < rowsIdx.length; row++) {
        // Zeit 0 → Box überspringen
        if (times[row] === 0) {
          skipped++;
          continue;
        }

        const idx = rowsIdx[row];
        const innerEl = mapInners.get(idx);
        if (!innerEl) {
          skipped++;
          continue;
        }

        const combo = dom.getComboBoxControlFromInner(innerEl);
        if (!combo) {
          skipped++;
          continue;
        }

        let i = assignment[row] ?? 0;
        if (i < 0 || i >= items.length) i = 0;

        try {
          const target = items[i];
          combo.setSelectedItem?.(target.item);
          combo.setSelectedKey?.(target.key);
          combo.fireSelectionChange?.({ selectedItem: target.item });
          combo.fireChange?.({ value: target.text, selectedItem: target.item });

          innerEl.dispatchEvent(new Event("input", { bubbles: true }));
          innerEl.dispatchEvent(new Event("change", { bubbles: true }));

          combo.setValueState?.(window.sap?.ui?.core?.ValueState?.None ?? "None");
          combo.close?.();
          combo.rerender?.();

          selected++;
        } catch {
          errors++;
        }
      }

      return { selected, skipped, errors };
    }
  };
  
  // ----------------------------------
  // MODAL MODULE
  // ----------------------------------

  const modal = {

    showWeightsDialog(items, times) {
      const totalHours = times.reduce((a, b) => a + b, 0);

      return new Promise((resolve, reject) => {

        // ---------- Modal Grundgerüst ----------
        const overlay = document.createElement("div");
        overlay.style = `
          position:fixed; inset:0; background:rgba(0,0,0,.3);
          z-index:999999; display:flex; align-items:center; justify-content:center;
        `;

        const modalEl = document.createElement("div");
        modalEl.style = `
          background:#fff; min-width:640px; max-width:960px;
          border-radius:8px; padding:16px; font:14px system-ui;
        `;

        const header = document.createElement("div");
        header.innerHTML = `
          <div style="font-size:16px;font-weight:600;margin-bottom:8px">
            Zielanteile je Item festlegen
          </div>
          <div style="margin-bottom:12px">
            Gesamtzeit: <b>${util.formatDE(totalHours)} h</b><br>
            Items: <b>${items.length}</b>
          </div>
        `;

        // ---------- Tabelle ----------
        const tbl = document.createElement("table");
        tbl.style = "width:100%; border-collapse:collapse;";
        tbl.innerHTML = `
          <thead>
            <tr style="background:#f6f6f6">
              <th style="padding:6px; text-align:left;">#</th>
              <th style="padding:6px; text-align:left;">Item</th>
              <th style="padding:6px; text-align:left;">Zielwert</th>
              <th style="padding:6px; text-align:left;">Verteilung</th>
              <th style="padding:6px; text-align:left;">Verteilung real</th>
            </tr>
          </thead>
        `;

        const tbody = document.createElement("tbody");
        tbl.appendChild(tbody);

        items.forEach((it, i) => {
          const def = DEFAULT_TARGETS[it.text.trim()] ?? "";
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td style="padding:6px">${i + 1}</td>
            <td style="padding:6px">${it.text}</td>
            <td style="padding:6px">
              <input type="text" data-idx="${i}" value="${def}"
                style="width:80px; padding:4px; border:1px solid #ccc;">
            </td>
            <td style="padding:6px"><span class="dist" data-i="${i}">–</span></td>
            <td style="padding:6px"><span class="real" data-i="${i}">–</span></td>
          `;
          tbody.appendChild(tr);
        });

        // ---------- Buttons ----------
        const btnRow = document.createElement("div");
        btnRow.style = "margin-top:12px; display:flex; gap:8px; justify-content:flex-end;";

        const btnCancel = document.createElement("button");
        btnCancel.textContent = "Abbrechen";

        const btnCalc = document.createElement("button");
        btnCalc.textContent = "Verteilen";

        const btnApply = document.createElement("button");
        btnApply.textContent = "Anwenden";

        btnRow.append(btnCancel, btnCalc, btnApply);

        modalEl.append(header, tbl, btnRow);
        overlay.appendChild(modalEl);
        document.body.appendChild(overlay);

        // ---------- Logik ----------
        const inputs = [...tbody.querySelectorAll("input")];
        const distCells = [...tbody.querySelectorAll(".dist")];
        const realCells = [...tbody.querySelectorAll(".real")];

        function normalize(arr) {
          const sum = arr.reduce((a, b) => a + b, 0);
          return sum > 0 ? arr.map(v => v / sum) : arr.map(() => 1 / arr.length);
        }

        function calc() {
          const raw = inputs.map(inp =>
            util.parseDEtoNumber(inp.value.replace(/\./g, "").replace(",", ".")) || 0
          );

          const norm = normalize(raw);
          const dist = optimize.weightedDistribution(times, norm);

          distCells.forEach((c, i) => {
            c.textContent = (norm[i] * 100).toFixed(1).replace(".", ",") + " %";
          });

          realCells.forEach((c, i) => {
            const p = (dist.load[i] / dist.total) * 100;
            c.textContent = (p).toFixed(1).replace(".", ",") + " %";
          });

          return norm;
        }

        btnCalc.onclick = calc;

        btnCancel.onclick = () => {
          overlay.remove();
          reject("abgebrochen");
        };

        btnApply.onclick = () => {
          const norm = calc();
          overlay.remove();
          resolve(norm);
        };

        // Direkt initial berechnen
        calc();
      });
    }
  };
  
  // ----------------------------------
  // MAIN FLOW
  // ----------------------------------

  async function main() {

    const rows = extract.gatherStatusTimes();
    const times = rows.map(r => r.val);

    const items = extract.getSampleSelectableItems();
    if (items.length === 0) {
      alert("Keine wählbaren Items in ComboBoxen gefunden.");
      return;
    }

    let weightsNorm;
    try {
      weightsNorm = await modal.showWeightsDialog(
        items.map(x => ({ text: x.text, key: x.key })),
        times
      );
    } catch {
      console.info("Abgebrochen.");
      return;
    }

    const dist = optimize.weightedDistribution(times, weightsNorm);

    const resTimes = assign.fillTimes(rows);
    const resBoxes = assign.selectBoxes(dist.assignment, times, items);

    alert(
      `Zeiten: ${resTimes.filled} gefüllt, ${resTimes.skipped} übersprungen, ${resTimes.errors} Fehler\n` +
      `ComboBoxen: ${resBoxes.selected} gesetzt, ${resBoxes.skipped} übersprungen, ${resBoxes.errors} Fehler`
    );
  }

  main();
})();
