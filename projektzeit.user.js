// ==UserScript==
// @name         Projektzeit Verteilung (SAP UI5)
// @namespace    https://github.com/janlisec/
// @version      1.1
// @description  Verteilt Zeitwerte in SAP Fiori Oberflächen anhand gewichtetem Algorithmus
// @match        https://*/sap/bc/*
// @grant        none
// @run-at       document-end
//
// @updateURL    https://raw.githubusercontent.com/janlisec/projektzeitverteilung/main/projektzeit.user.js
// @downloadURL  https://raw.githubusercontent.com/janlisec/projektzeitverteilung/main/projektzeit.user.js
// ==/UserScript==

(function() {
  const url = "https://raw.githubusercontent.com/janlisec/projektzeitverteilung/main/projektzeit.js";

  // Floating Button hinzufügen
  function addButton() {
    if (document.getElementById("projektzeit-btn")) return;

    const btn = document.createElement("button");
    btn.id = "projektzeit-btn";
    btn.textContent = "Projektzeit verteilen";
    btn.style.cssText = `
      position: fixed;
      bottom: 80px;
      right: 20px;
      z-index: 999999;
      background: #0b74de;
      color: #fff;
      padding: 10px 16px;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      font-size: 14px;
      box-shadow: 0 3px 8px rgba(0,0,0,.2);
    `;
    btn.onclick = () => loadAndRunScript();
    document.body.appendChild(btn);
  }

  // Script laden und ausführen
  function loadAndRunScript() {
    fetch(url + "?v=" + Date.now())
      .then(r => r.text())
      .then(code => {
        console.log("[Projektzeit] Script geladen.");
        eval(code);
      })
      .catch(err => alert("Fehler beim Laden von projektzeit.js: " + err));
  }

  // Nach dem Laden der Seite Button einfügen
  window.addEventListener("load", () => {
    setTimeout(addButton, 1500); // UI5 braucht manchmal 1–2 sec bis DOM vollständig
  });

})();

