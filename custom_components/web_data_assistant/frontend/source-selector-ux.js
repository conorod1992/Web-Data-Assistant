/** Shared selector review for guided creation and Repair. No remote HTML rendering. */
class WdaSelectorOptions extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  configure({ match, state, request, hass, attribute = null, disabled = false }) {
    this.match = match;
    this.state = state;
    this.request = request;
    this.hass = hass;
    this.attribute = attribute || match?.attribute || null;
    this.disabled = disabled;
    this.render();
  }

  disconnectedCallback() {
    // A source switch, new text search or cancelled Repair must not apply the
    // result of a request that was started by the removed picker.
    if (this.state) {
      this.state.epoch += 1;
      this.state.busy = false;
      this.state.tested = null;
    }
  }

  static createState(match) {
    return { open: false, selector: match?.selector || "", index: String(match?.index ?? 0), epoch: 0, busy: false, tested: null, error: "" };
  }

  html(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  get candidates() {
    return (Array.isArray(this.match?.candidates) ? this.match.candidates : []).slice(0, 5);
  }

  describe(candidate) {
    if (!candidate) return "Not assessed — test a custom selector below.";
    const count = candidate.match_count;
    const label = ({ strong: "Strong", moderate: "Moderate", fragile: "Fragile" })[candidate.stability] || "Custom / not assessed";
    const matches = Number.isInteger(count) && count > 0
      ? count === 1 ? "Unique match" : `Match ${Number(candidate.index) + 1} of ${count} (index ${candidate.index})`
      : `Index ${candidate.index || 0}; match count not available`;
    return `${label} · ${matches}`;
  }

  currentCandidate() {
    return this.candidates.find((item) => item.selector === this.match?.selector && item.index === this.match?.index)
      || (this.match ? { ...this.match, stability: this.match.match_count > 1 ? "fragile" : undefined } : null);
  }

  invalidate() {
    this.state.epoch += 1;
    this.state.tested = null;
    this.state.busy = false;
    this.state.error = "";
    this.refreshTestResult();
  }

  emitSelection(match) {
    this.dispatchEvent(new CustomEvent("selector-chosen", { detail: match, bubbles: true, composed: true }));
  }

  async testSelector() {
    if (this.disabled || this.state.busy) return;
    const selector = this.state.selector.trim();
    const indexText = this.state.index.trim();
    let request;
    try {
      if (!selector || selector.length > 2000) throw new Error("Enter a CSS selector (up to 2,000 characters).");
      if (!/^\d+$/.test(indexText) || !Number.isSafeInteger(Number(indexText))) throw new Error("Match index must be a whole number starting at 0.");
      request = this.request();
      if (!request.url) throw new Error("Enter a page URL first.");
    } catch (err) {
      this.state.error = err.message;
      this.refreshTestResult();
      return;
    }
    const epoch = ++this.state.epoch;
    const signature = JSON.stringify(request);
    this.state.tested = null;
    this.state.busy = true;
    this.state.error = "";
    this.refreshTestResult();
    try {
      const message = { type: "web_data_assistant/test_html_selector", ...request, selector, index: Number(indexText) };
      // Preserve a stored attribute extraction when repairing it.
      if (this.attribute) message.attribute = this.attribute;
      const result = await this.hass.callWS(message);
      if (!this.isConnected || epoch !== this.state.epoch) return;
      if (signature !== JSON.stringify(this.request())) throw new Error("The request settings changed. Test the selector again.");
      this.state.tested = { ...result, signature };
    } catch (err) {
      if (this.isConnected && epoch === this.state.epoch) this.state.error = err?.message || "The selector could not be tested.";
    } finally {
      if (this.isConnected && epoch === this.state.epoch) {
        this.state.busy = false;
        this.refreshTestResult();
      }
    }
  }

  useTestedSelector() {
    if (this.disabled || this.state.busy || !this.state.tested) return;
    try {
      const tested = this.state.tested;
      if (tested.signature !== JSON.stringify(this.request()) || tested.selector !== this.state.selector.trim() || tested.index !== Number(this.state.index.trim())) {
        throw new Error("The selector or request settings changed. Test again before using it.");
      }
      const { signature, ...result } = tested;
      this.emitSelection({ ...result, candidates: [], attribute: this.attribute });
    } catch (err) {
      this.state.tested = null;
      this.state.error = err.message;
      this.refreshTestResult();
    }
  }

  refreshTestResult() {
    const button = this.shadowRoot.getElementById("test-selector");
    if (button) {
      button.disabled = this.disabled || this.state.busy;
      button.textContent = this.state.busy ? "Testing…" : "Test selector";
    }
    const use = this.shadowRoot.getElementById("use-selector");
    if (use) use.disabled = this.disabled || this.state.busy || !this.state.tested;
    const result = this.shadowRoot.getElementById("test-result");
    if (!result) return;
    if (this.state.error) {
      result.innerHTML = `<p role="alert">${this.html(this.state.error)}</p>`;
    } else if (this.state.tested) {
      const tested = this.state.tested;
      result.innerHTML = `<p><strong>${this.html(this.describe(tested))}</strong></p><p class="value">${this.html(tested.text || "(Empty text)")}</p><p>${this.html(tested.context)}</p><p>Sample from the current HTTP response. Confirm this is the intended value before using it.</p>`;
    } else {
      result.textContent = "Custom edits are not used until you test and apply them.";
    }
  }

  render() {
    if (!this.state) return;
    const current = this.currentCandidate();
    const selectedIndex = this.candidates.findIndex((candidate) => candidate.selector === this.match?.selector && candidate.index === this.match?.index);
    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block;margin:12px 0;font:inherit;color:var(--primary-text-color)}
        p{margin:8px 0;line-height:1.45;font-size:13px}code,.value{overflow-wrap:anywhere;white-space:pre-wrap}
        .summary{padding:12px;border:1px solid var(--divider-color);border-radius:8px}
        details{margin-top:10px}summary{cursor:pointer;font-weight:600;padding:6px 0}
        .hint{color:var(--secondary-text-color)}.options{display:grid;gap:8px;margin-top:10px}
        .option{display:flex;gap:10px;padding:10px;border:1px solid var(--divider-color);border-radius:6px;align-items:flex-start;cursor:pointer}
        .option input{margin-top:4px}.option span{min-width:0}.option code{display:block;margin:5px 0}
        .custom{display:grid;grid-template-columns:minmax(0,1fr) 150px;gap:10px;margin-top:14px}
        .custom label{display:grid;gap:6px;font-size:13px}input[type=text],input[type=number]{box-sizing:border-box;min-width:0;width:100%;padding:10px;border:1px solid var(--divider-color);border-radius:5px;background:var(--card-background-color);color:inherit;font:inherit}
        button{cursor:pointer;border:1px solid var(--divider-color);border-radius:5px;padding:9px 12px;background:var(--card-background-color);color:var(--primary-color);font:inherit}
        button:disabled{opacity:.5;cursor:default}.actions{display:flex;gap:10px;margin:12px 0;flex-wrap:wrap}[role=alert]{color:var(--error-color)}
        @media(max-width:550px){.custom{grid-template-columns:1fr}}
      </style>
      ${current ? `<div class="summary"><strong>Selector stability: ${this.html(this.describe(current))}</strong><p>${this.html(current.reason || "Custom or previously stored selector; stability has not been assessed.")}</p><code>${this.html(current.selector)}</code></div>` : ""}
      <details ${this.state.open ? "open" : ""}>
        <summary>Advanced selector options</summary>
        <p class="hint">Ratings are heuristics from one response, not a promise of future stability. The current text identifies the element only during setup; it is not used in generated selectors.</p>
        <div class="options" role="group" aria-label="Suggested selectors">
          ${this.candidates.map((candidate, index) => `<label class="option"><input type="radio" name="candidate" value="${index}" ${index === selectedIndex ? "checked" : ""} ${this.disabled ? "disabled" : ""}><span><strong>${index === 0 ? "Recommended · " : ""}${this.html(this.describe(candidate))}</strong><code>${this.html(candidate.selector)}</code><span>${this.html(candidate.reason)}</span></span></label>`).join("")}
        </div>
        ${this.match ? `<p class="hint">All suggested selectors identify the same selected element in the searched response.</p><p class="value">Selected sample: ${this.html(this.match.text || "(Empty text)")}</p>` : ""}
        <div class="custom">
          <label>Custom CSS selector<input id="custom-selector" type="text" maxlength="2000" value="${this.html(this.state.selector)}" spellcheck="false" ${this.disabled ? "disabled" : ""}></label>
          <label>Match index (starts at 0)<input id="custom-index" type="number" min="0" step="1" value="${this.html(this.state.index)}" ${this.disabled ? "disabled" : ""}></label>
        </div>
        <div class="actions"><button id="test-selector" type="button">Test selector</button><button id="use-selector" type="button">Use tested selector</button></div>
        <div id="test-result" class="hint" aria-live="polite"></div>
        <p class="hint">New selections remember the number of matches. A changed count becomes an extraction error, not an automatic switch. Reordering with the same count can still fool a positional selector.</p>
      </details>`;
    this.shadowRoot.querySelector("details").addEventListener("toggle", (event) => { this.state.open = event.target.open; });
    this.shadowRoot.querySelectorAll('input[name="candidate"]').forEach((radio) => radio.addEventListener("change", () => {
      const candidate = this.candidates[Number(radio.value)];
      if (!radio.checked || !candidate || this.disabled) return;
      this.emitSelection({ ...this.match, ...candidate, attribute: this.attribute });
    }));
    this.shadowRoot.getElementById("custom-selector").addEventListener("input", (event) => { this.state.selector = event.target.value; this.invalidate(); });
    this.shadowRoot.getElementById("custom-index").addEventListener("input", (event) => { this.state.index = event.target.value; this.invalidate(); });
    this.shadowRoot.getElementById("test-selector").addEventListener("click", () => this.testSelector());
    this.shadowRoot.getElementById("use-selector").addEventListener("click", () => this.useTestedSelector());
    this.refreshTestResult();
  }
}

if (!customElements.get("wda-selector-options")) customElements.define("wda-selector-options", WdaSelectorOptions);

// Integrate with the panel's existing feature modules. The selector picker owns
// its DOM and request state; no MutationObserver or external page DOM is used.
const SelectorPanel = customElements.get("web-data-assistant-panel");
if (SelectorPanel && !SelectorPanel.prototype.__selectorOptionsInstalled) {
  const originalRenderScrape = SelectorPanel.prototype._renderScrape;
  const originalBind = SelectorPanel.prototype._bind;
  const originalAdd = SelectorPanel.prototype._addScrapeValue;
  const originalEntities = SelectorPanel.prototype._entities;
  const originalPopulate = SelectorPanel.prototype._populateEditableSource;

  SelectorPanel.prototype._renderScrape = function () {
    const html = originalRenderScrape.call(this).replace(/<details><summary>Advanced extraction details<\/summary>[\s\S]*?<\/details>/, "");
    const picker = "<wda-selector-options></wda-selector-options>";
    const addAction = '<div class="actions"><button id="add-scrape-value"';
    if (html.includes(addAction)) return html.replace(addAction, picker + addAction);
    const end = html.lastIndexOf("</section>");
    return end < 0 ? html : html.slice(0, end) + picker + html.slice(end);
  };

  SelectorPanel.prototype._bind = function () {
    originalBind.call(this);
    const picker = this.shadowRoot.querySelector("wda-selector-options");
    if (!picker) return;
    const match = this._repairMode ? this._repairSelectedMatch : this._selectedExtraction;
    // Raw request settings are used only as an in-memory invalidation key.
    const requestKey = JSON.stringify([this._form.url, this._form.method, this._form.headers, this._form.payload, this._form.verifySsl, this._repairMode?.entityKey]);
    if (this._selectorOptionsMatch !== match || this._selectorRequestKey !== requestKey) {
      this._selectorOptionsState = WdaSelectorOptions.createState(match);
      this._selectorOptionsMatch = match;
      this._selectorRequestKey = requestKey;
    }
    this._selectorOptionsState ||= WdaSelectorOptions.createState(match);
    picker.configure({
      match, attribute: this._repairMode?.entity?.attribute,
      state: this._selectorOptionsState, hass: this._hass,
      request: () => this._request(),
      disabled: Boolean(this._saving || this._repairSaving || this._searching || this._repairSearching),
    });
    picker.addEventListener("selector-chosen", (event) => {
      if (this._saving || this._repairSaving) return;
      const chosen = event.detail;
      if (this._repairMode) this._repairSelectedMatch = chosen;
      else this._selectedExtraction = chosen;
      this._selectorOptionsMatch = chosen;
      this._selectorOptionsState.selector = chosen.selector;
      this._selectorOptionsState.index = String(chosen.index);
      this._selectorOptionsState.tested = null;
      this._selectorOptionsState.error = "";
      this._render();
    });
  };

  SelectorPanel.prototype._addScrapeValue = function () {
    const chosen = this._selectedExtraction;
    const count = this._scrapeSelections.length;
    originalAdd.call(this);
    if (!chosen || this._scrapeSelections.length !== count + 1) return;
    const added = this._scrapeSelections[count];
    if (Number.isInteger(chosen.match_count) && chosen.match_count > 0) added.expected_match_count = chosen.match_count;
    if (chosen.attribute) added.attribute = chosen.attribute;
  };

  SelectorPanel.prototype._entities = function () {
    const entities = originalEntities.call(this);
    if (this._sourceType !== "scrape") return entities;
    entities.forEach((entity, index) => {
      const selected = this._scrapeSelections[index];
      if (Number.isInteger(selected?.expected_match_count)) entity.expected_match_count = selected.expected_match_count;
      if (selected?.attribute) entity.attribute = selected.attribute;
    });
    return entities;
  };

  if (originalPopulate) {
    SelectorPanel.prototype._populateEditableSource = async function (config, mode = "edit") {
      await originalPopulate.call(this, config, mode);
      if (config.source_type !== "scrape") return;
      this._scrapeSelections.forEach((selected, index) => {
        const stored = config.entities[index];
        if (Number.isInteger(stored?.expected_match_count)) selected.expected_match_count = stored.expected_match_count;
        if (stored?.attribute) selected.attribute = stored.attribute;
      });
    };
  }
  SelectorPanel.prototype.__selectorOptionsInstalled = true;
}
