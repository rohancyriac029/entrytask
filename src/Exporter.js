/**
 * @fileoverview Exporter.js — JSON scene export and preview.
 *
 * Handles:
 *  - Building the JSON payload from SceneManager
 *  - Triggering a browser download of the .json file
 *  - Rendering syntax-highlighted JSON in the preview panel (no libraries)
 */

import SceneManager from './SceneManager.js';

// ─── Syntax Highlighting ──────────────────────────────────────────────────────

/**
 * Manual JSON syntax highlighter — no external library.
 * Uses regex replacements to wrap JSON token types in <span> tags.
 *
 * @param {string} json - Pre-formatted JSON string (from JSON.stringify with indent).
 * @returns {string} HTML string with token spans.
 */
function syntaxHighlight(json) {
  // Escape HTML first
  json = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = 'json-number';
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'json-key' : 'json-string';
      } else if (/true|false/.test(match)) {
        cls = 'json-bool';
      } else if (/null/.test(match)) {
        cls = 'json-null';
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

const Exporter = {
  /**
   * Builds the scene JSON, validates it, and triggers a browser file download.
   *
   * @param {HTMLElement} [warningEl] - Optional element to show inline warning in.
   * @returns {boolean} True if export succeeded, false if scene was empty.
   */
  download(warningEl) {
    const data = SceneManager.exportJSON();

    if (!data) {
      if (warningEl) {
        warningEl.textContent = '⚠ Add at least one asset before exporting.';
        warningEl.classList.add('visible');
        setTimeout(() => warningEl.classList.remove('visible'), 3000);
      }
      return false;
    }

    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `marine_scene_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Revoke after brief delay
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  },

  /**
   * Generates highlighted JSON and injects it into the preview panel.
   *
   * @param {HTMLElement} preEl - The <pre> element to populate.
   * @param {HTMLElement} [warningEl] - Optional warning element.
   * @returns {boolean} True if preview was generated.
   */
  preview(preEl, warningEl) {
    const data = SceneManager.exportJSON();

    if (!data) {
      if (warningEl) {
        warningEl.textContent = '⚠ Add at least one asset to preview.';
        warningEl.classList.add('visible');
        setTimeout(() => warningEl.classList.remove('visible'), 3000);
      }
      return false;
    }

    const jsonStr = JSON.stringify(data, null, 2);
    preEl.innerHTML = syntaxHighlight(jsonStr);
    return true;
  },

  /**
   * Loads a JSON file from disk and returns parsed data.
   * Used for the Import JSON stretch goal.
   *
   * @returns {Promise<object|null>}
   */
  importFromFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return resolve(null);

        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const data = JSON.parse(evt.target.result);
            resolve(data);
          } catch (err) {
            console.error('[Exporter] Failed to parse imported JSON:', err);
            resolve(null);
          }
        };
        reader.readAsText(file);
      };
      input.click();
    });
  },
};

export default Exporter;
