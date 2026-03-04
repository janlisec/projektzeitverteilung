(() => {
	// Default-Zielwerte je Item-Name (keine Normierung nötig)
  	const DEFAULT_TARGETS = {
    	"CCSA Forschung": 30,
    	"CE Forschung": 5,
    	"GS Forschung": 25,
    	"UMI Forschung": 10,
    	"Eigene Qualifizierung": 15,
	  	"Referenzmaterialien": 10,
	  	"GS Gremien": 5
  	};
	
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
  
  let statusesSelector = null;
  if (document.querySelector(SELECTORS.statusesA)) {
    statusesSelector = SELECTORS.statusesA;         // Variante A
  } else if (document.querySelector(SELECTORS.statusesB)) {
    statusesSelector = SELECTORS.statusesB;         // Variante B
  } else {
    alert("Keine Status-Elemente gefunden (weder Variante A noch B).");
    return;
  }
  
  const STRICT_COUNT_CHECK = true;
  
  const getCloneIndex = (id) => {
    if (!id) return null;
    const m = id.match(/clone(\d+)/i);
    return m ? parseInt(m[1], 10) : null;
  };

  const collect = (selector) =>
    Array.from(document.querySelectorAll(selector))
      .map(el => ({ el, idx: getCloneIndex(el.id) }))
      .filter(x => x.idx !== null)
      .sort((a, b) => a.idx - b.idx);

  const normalizeText = (s) =>
    (s || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  const extractMaxStr = (el) => {
    let raw = (typeof el.value === 'string' && el.value) ? el.value : el.textContent;
    raw = normalizeText(raw);
    let afterSlash = raw.includes('/') ? raw.split('/').pop().trim() : raw;
    let m = afterSlash.match(/\d{1,3}(?:\.\d{3})*,\d+|\d+,\d+/);
    if (m) return m[0];
    m = afterSlash.match(/\d+(?:\.\d+)?/);
    if (m) return m[0].replace('.', ',');

    return null;
  };

  const parseDEtoNumber = (s) => {
    if (s == null) return NaN;
    const num = parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
    return isNaN(num) ? NaN : num;
  };

  const formatDE = (num, digits = 2) => (Number(num).toFixed(digits)).replace('.', ',');

  const setInputValue = (input, val) => {
    // val ist String mit Komma (de)
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter ? setter.call(input, val) : input.value = val;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  
  const getComboBoxControlFromInner = (inner) => {
    const root = inner.closest('.sapMComboBoxBase, .sapMComboBox');
    if (!root || !window.sap?.ui?.getCore) return null;
    return window.sap.ui.getCore().byId(root.id);
  };

  const getSelectableItems = (combo) => {
    const items = combo?.getItems?.() || [];
    const result = [];
    for (const it of items) {
      const enabled = it.getEnabled?.() ?? true;
      const key = it.getKey?.() || it.getProperty?.('key') || '';
      const text = it.getText?.() || it.getProperty?.('text') || '';
      if (enabled && String(key) !== '' && String(text).trim() !== '') {
        result.push({ item: it, key, text });
      }
    }
    return result;
  };

  const gatherStatusTimes = () => {
    const statuses = collect(statusesSelector); // [{el, idx}...]
    const rows = [];
    for (const { el, idx } of statuses) {
      const s = extractMaxStr(el);        // z.B. "1,25"
      const v = parseDEtoNumber(s);       // z.B. 1.25
      rows.push({ idx, str: s, val: isNaN(v) ? 0 : v });
    }
    return rows; // bereits nach idx sortiert
  };

  const getSampleSelectableItems = () => {
    const inners = collect(SELECTORS.comboBoxInners);
    if (inners.length === 0) return [];
    const combo = getComboBoxControlFromInner(inners[0].el);
    if (!combo) return [];
    return getSelectableItems(combo); // [{item,key,text}]
  };

  const showWeightsModal = (items, totalHours, { times, optFunction }) => {
  // items: [{text, key?}]  (Key wird nicht angezeigt)
  // times: number[]  (Zeitwerte je Zeile)
  // optFunction: (times: number[], weights: number[]) => { load: number[], total?: number }
  // Return Promise -> resolves mit weightsShown (Array Länge k, Summe = 1)
  return new Promise((resolve, reject) => {
    if (!Array.isArray(times) || times.length === 0) {
      console.warn('[showWeightsModal] times fehlt oder ist leer – "Verteilung real" kann nicht berechnet werden.');
    }
    if (typeof optFunction !== 'function') {
      console.warn('[showWeightsModal] optFunction fehlt – "Verteilung real" kann nicht berechnet werden.');
    }

    // --- Overlay/Modal Grundaufbau ---
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,.3);
      z-index: 999999; display: flex; align-items: center; justify-content: center;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background: #fff; color: #111; min-width: 640px; max-width: 980px;
      border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,.25);
      font: 14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      padding: 16px 16px 12px;
    `;

    const h = document.createElement('div');
    h.innerHTML = `
      <div style="font-weight:600; font-size:16px; margin-bottom:8px">
        Zielanteile je Item festlegen
      </div>
      <div style="margin-bottom:12px; color:#333">
        Summe der aktuellen Zeiten: <b>${formatDE(totalHours, 2)} h</b><br>
        Anzahl Items: <b>${items.length}</b><br>
        Gib beliebige Zielwerte pro Item an (z. B. 1, 2, 1, 1).<br>
        <i>Verteilen</i> berechnet:
        <ul style="margin:6px 0 0 16px; padding:0;">
          <li><b>Verteilung</b>: normierte Zielanteile (Summe = 1)</li>
          <li><b>Verteilung real</b>: resultierende Verteilung nach Aufteilung durch den Algorithmus</li>
        </ul>
      </div>
    `;

    const tblWrap = document.createElement('div');
    tblWrap.style.cssText = `max-height: 50vh; overflow: auto; border: 1px solid #ddd; border-radius: 6px;`;

    const tbl = document.createElement('table');
    tbl.style.cssText = `width: 100%; border-collapse: collapse;`;

    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr style="background:#f6f6f6">
        <th style="text-align:left; padding:8px; border-bottom:1px solid #ddd; width:60px;">#</th>
        <th style="text-align:left; padding:8px; border-bottom:1px solid #ddd;">Text</th>
        <th style="text-align:left; padding:8px; border-bottom:1px solid #ddd; width:160px;">Zielwert</th>
        <th style="text-align:left; padding:8px; border-bottom:1px solid #ddd; width:160px;">Verteilung</th>
        <th style="text-align:left; padding:8px; border-bottom:1px solid #ddd; width:180px;">Verteilung real</th>
      </tr>
    `;

    const tbody = document.createElement('tbody');

    items.forEach((it, i) => {
		
		// Fill from DEFAULT_Targets if specified at top and item is present
		let defaultValue = "";
		if (DEFAULT_TARGETS && typeof DEFAULT_TARGETS === "object") {
  			const key = String(it.text).trim();
  			if (DEFAULT_TARGETS.hasOwnProperty(key)) {
    			defaultValue = String(DEFAULT_TARGETS[key]).replace(".", ",");
  			}	
		}
		
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding:8px; border-bottom:1px solid #eee;">${i + 1}</td>
        <td style="padding:8px; border-bottom:1px solid #eee;">${String(it.text)}</td>
        <td style="padding:8px; border-bottom:1px solid #eee;">
          <input type="text" data-idx="${i}" inputmode="decimal"
                 style="width:120px; padding:6px 8px; border:1px solid #ccc; border-radius:4px"
                 placeholder="z.B. 1"
				 value="${defaultValue}">
        </td>
        <td style="padding:8px; border-bottom:1px solid #eee;">
          <span class="dist-cell" data-idx="${i}" style="display:inline-block; min-width:90px;">–</span>
        </td>
        <td style="padding:8px; border-bottom:1px solid #eee;">
          <span class="real-cell" data-idx="${i}" style="display:inline-block; min-width:110px;">–</span>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbl.appendChild(thead);
    tbl.appendChild(tbody);
    tblWrap.appendChild(tbl);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = `display:flex; gap:8px; justify-content:flex-end; margin-top:12px;`;

    const distributeBtn = document.createElement('button');
    distributeBtn.textContent = 'Verteilen';
    distributeBtn.style.cssText = `
      padding:8px 12px; border:1px solid #ccc; border-radius:6px;
      background:#fafafa; cursor:pointer;
    `;

    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Anwenden';
    applyBtn.style.cssText = `
      padding:8px 12px; border:none; border-radius:6px;
      background:#0b74de; color:#fff; cursor:pointer;
    `;

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Abbrechen';
    cancelBtn.style.cssText = `
      padding:8px 12px; border:1px solid #ccc; border-radius:6px;
      background:#fff; cursor:pointer;
    `;

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(distributeBtn);
    btnRow.appendChild(applyBtn);

    modal.appendChild(h);
    modal.appendChild(tblWrap);
    modal.appendChild(btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // --- Hilfsfunktionen ---
    const inputs = Array.from(tbody.querySelectorAll('input[type="text"]'));
    const distCells = Array.from(tbody.querySelectorAll('.dist-cell'));
    const realCells = Array.from(tbody.querySelectorAll('.real-cell'));

    const parseDEtoNumberLocal = (s) => {
      if (!s) return 0;
      const v = parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
      return isNaN(v) ? 0 : Math.max(0, v);
    };

    const normalize = (arr) => {
      const sum = arr.reduce((a, b) => a + b, 0);
      if (sum > 0) return arr.map(v => v / sum);
      // Fallback: gleichmäßig
      return Array(arr.length).fill(1 / arr.length);
    };

    const fmtPct = (x) => `${(x * 100).toFixed(2).replace('.', ',')} %`;

    const recomputeDistributions = () => {
      // 1) Normierte Zielverteilung
      const raw = inputs.map(inp => parseDEtoNumberLocal(inp.value.trim()));
      const norm = normalize(raw);

      // 2) "Verteilung real" via optFunction
      let real = Array(norm.length).fill(0);
      let realHours = Array(norm.length).fill(0);
      const total = (Array.isArray(times) ? times.reduce((a, b) => a + b, 0) : 0);

      if (Array.isArray(times) && typeof optFunction === 'function' && total > 0) {
        try {
          const dist = optFunction(times, norm) || {};
          const load = Array.isArray(dist.load) ? dist.load : [];
          const usedTotal = (typeof dist.total === 'number' && dist.total > 0) ? dist.total : total;

          if (load.length === norm.length) {
            realHours = load.slice();
            real = load.map(v => v / usedTotal);
          } else {
            console.warn('[showWeightsModal] optFunction.load Länge != items.length – Realverteilung nicht darstellbar.');
          }
        } catch (e) {
          console.warn('[showWeightsModal] optFunction-Fehler:', e);
        }
      }

      // 3) UI aktualisieren (Prozent + Tooltips mit Stunden)
      distCells.forEach((cell, i) => {
        const targetHours = (total > 0) ? norm[i] * total : 0;
        cell.textContent = `${fmtPct(norm[i])}`;
        cell.title = `Gewicht: ${formatDE(norm[i], 4)} | Ziel (h): ${formatDE(targetHours, 2)}`;
      });

      realCells.forEach((cell, i) => {
        cell.textContent = `${fmtPct(real[i] || 0)}`;
        cell.title = `Reale Last (h): ${formatDE(realHours[i] || 0, 2)}`;
      });

      return { norm, real };
    };

    // --- Events ---
    distributeBtn.addEventListener('click', () => {
      recomputeDistributions();
    });

    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(overlay);
      reject(new Error('Abgebrochen'));
    });

    applyBtn.addEventListener('click', () => {
      const { norm } = recomputeDistributions(); // sicherstellen, dass „Verteilung“ & „Verteilung real“ aktuell sind
      document.body.removeChild(overlay);
      resolve(norm); // Rückgabe bleibt: normierte Zielgewichte
    });

  });
};

  const approximateDistributionWeighted = (times, weights) => {
  const k = weights.length;
  const S = times.reduce((a, b) => a + b, 0);
  const targets = weights.map(w => w * S);

  // Wir sortieren Werte absteigend (klassisch),
  // aber das neue Scoring verhindert Ungleichverteilung.
  const entries = times.map((value, index) => ({ value, index }))
                       .sort((a, b) => b.value - a.value);

  const load = Array(k).fill(0);
  const assignment = Array(times.length).fill(0);

  for (const { value, index } of entries) {
    let bestItem = 0;
    let bestCost = Infinity;

    for (let i = 0; i < k; i++) {
      const before = load[i] - targets[i];
      const after  = (load[i] + value) - targets[i];

      // Quadratischer Fehleranstieg
      const deltaCost = (after * after) - (before * before);

      // Minimierung
      if (deltaCost < bestCost) {
        bestCost = deltaCost;
        bestItem = i;
      }
    }

    assignment[index] = bestItem;
    load[bestItem] += value;
  }

  return {
    assignment,
    load,
    targets,
    total: S
  };
  };
  const fillTimes = () => {
    const timeInputs = collect(SELECTORS.timeInputs);
    const statuses   = collect(statusesSelector);

    if (STRICT_COUNT_CHECK && timeInputs.length !== statuses.length) {
      alert(`Abbruch: timeInputs=${timeInputs.length}, statuses=${statuses.length}`);
      return { aborted: true, filled: 0, skipped: 0, errors: 0 };
    }

    const mapInputs   = new Map(timeInputs.map(x => [x.idx, x.el]));
    const mapStatuses = new Map(statuses.map(x => [x.idx, x.el]));
    const commonIdx   = [...mapInputs.keys()].filter(k => mapStatuses.has(k)).sort((a, b) => a - b);

    let filled = 0, skipped = 0, errors = 0;

    for (const idx of commonIdx) {
      const inputEl  = mapInputs.get(idx);
      const statusEl = mapStatuses.get(idx);

      const valStr = extractMaxStr(statusEl); // "x,xx"
      if (!valStr) { skipped++; continue; }
      if (valStr === '0,00') { skipped++; continue; }

      try {
        inputEl.focus();
        setInputValue(inputEl, valStr); // belässt deutsches Komma
        inputEl.blur();
        filled++;
      } catch (e) {
        errors++;
      }
    }

    return { aborted: false, filled, skipped, errors };
  };

  const selectBoxesByAssignment = (assignment, items, times) => {
    const inners = collect(SELECTORS.comboBoxInners);
    if (inners.length === 0 || items.length === 0) {
      return { selected: 0, skipped: inners.length, errors: 0 };
    }
    const mapInners = new Map(inners.map(x => [x.idx, x.el]));
    const statuses = collect(statusesSelector);
    const rowsIdx = statuses.map(x => x.idx);

    let selected = 0, skipped = 0, errors = 0;

    for (let row = 0; row < rowsIdx.length; row++) {
		
	if (times[row] === 0) {
		skipped++;
		continue;
	}

      const idx = rowsIdx[row];
      const innerEl = mapInners.get(idx);
      if (!innerEl) { skipped++; continue; }

      const combo = getComboBoxControlFromInner(innerEl);
      if (!combo) { skipped++; continue; }

      let i = assignment[row] ?? 0;
      if (i < 0 || i >= items.length) i = 0;

      try {
        const target = items[i];

        combo.setSelectedItem?.(target.item);
        combo.setSelectedKey?.(target.key);

        combo.fireSelectionChange?.({ selectedItem: target.item });
        combo.fireChange?.({ value: target.text, selectedItem: target.item });

        innerEl.dispatchEvent(new Event('input', { bubbles: true }));
        innerEl.dispatchEvent(new Event('change', { bubbles: true }));

        combo.setValueState?.(window.sap?.ui?.core?.ValueState?.None ?? 'None');
        combo.close?.();
        combo.rerender?.();

        selected++;
      } catch (e) {
        errors++;
      }
    }

    return { selected, skipped, errors };
  };

  (async () => {
    const rows = gatherStatusTimes();               // [{idx, str, val}] in Zeilenreihenfolge
    const times = rows.map(r => r.val);             // numerische Zeiten
    const total = times.reduce((a, b) => a + b, 0);
    const itemsSample = getSampleSelectableItems(); // [{item,key,text}]

    if (itemsSample.length === 0) {
      alert('Keine wählbaren Items in den ComboBoxen gefunden.');
      return;
    }

    let weightsNorm;
    try {
	  weightsNorm = await showWeightsModal(
		  itemsSample.map(x => ({ text: x.text, key: x.key })), 
		  total,
		{
          times,
          optFunction: approximateDistributionWeighted
		}
      );
    } catch (e) {
      console.info('Verteilung abgebrochen.');
      return;
    }

    const dist = approximateDistributionWeighted(times, weightsNorm);
    console.group('[Zuordnung]');
    console.log('Zielanteile je Item (normiert):', weightsNorm);
    console.log('Zielwerte (h):', dist.targets.map(x => Number(x.toFixed(4))));
    console.log('Tatsächliche Lasten (h):', dist.load.map(x => Number(x.toFixed(4))));
    console.log('Gesamt (h):', Number(dist.total.toFixed(4)));
    console.log('Assignment (Item-Index je Zeile):', dist.assignment);
    console.groupEnd();

    const resTimes = fillTimes();

    const resBoxes = selectBoxesByAssignment(dist.assignment, itemsSample, times);

    alert(
      `${resTimes.aborted ? 'Zeiten: abgebrochen' :
        `Zeiten: ${resTimes.filled} gefüllt, ${resTimes.skipped} übersprungen, ${resTimes.errors} Fehler`}
      \nComboBoxen: ${resBoxes.selected} gesetzt, ${resBoxes.skipped} übersprungen, ${resBoxes.errors} Fehler`
    );
  })();
})();
