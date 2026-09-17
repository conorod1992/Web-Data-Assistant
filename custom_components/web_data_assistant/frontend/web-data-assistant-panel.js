class WebDataAssistantPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._sourceType = "json";
    this._loading = false;
    this._saving = false;
    this._error = "";
    this._status = "";
    this._jsonResult = null;
    this._htmlResult = null;
    this._selectedJson = new Set();
    this._jsonMode = "values";
    this._jsonFilter = "";
    this._htmlFilter = "";
    this._selectedHtmlId = null;
  }

  set hass(value) {
    this._hass = value;
    if (!this.shadowRoot.innerHTML) {
      this._render();
    }
  }

  set narrow(value) {
    this._narrow = value;
  }

  set panel(value) {
    this._panel = value;
  }

  connectedCallback() {
    this._render();
  }

  _styles() {
    return `
      :host {
        display: block;
        color: var(--primary-text-color);
        background: var(--primary-background-color);
        min-height: 100vh;
        font-family: var(--paper-font-body1_-_font-family, sans-serif);
      }

      * { box-sizing: border-box; }

      .page {
        max-width: 1180px;
        margin: 0 auto;
        padding: 24px;
      }

      h1 {
        margin: 0;
        font-size: 28px;
        font-weight: 500;
      }

      h2 {
        margin: 0 0 16px;
        font-size: 20px;
        font-weight: 500;
      }

      h3 {
        margin: 0;
        font-size: 16px;
        font-weight: 500;
      }

      p { line-height: 1.5; }

      .subtitle {
        margin: 8px 0 24px;
        color: var(--secondary-text-color);
      }

      .card {
        background: var(--ha-card-background, var(--card-background-color));
        border: 1px solid var(--divider-color);
        border-radius: var(--ha-card-border-radius, 12px);
        padding: 20px;
        margin-bottom: 18px;
        box-shadow: var(--ha-card-box-shadow, none);
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
      }

      .full { grid-column: 1 / -1; }

      label.field {
        display: flex;
        flex-direction: column;
        gap: 7px;
        font-size: 13px;
        color: var(--secondary-text-color);
      }

      input,
      select,
      textarea {
        width: 100%;
        min-height: 44px;
        padding: 10px 12px;
        border: 1px solid var(--divider-color);
        border-radius: 8px;
        background: var(--card-background-color);
        color: var(--primary-text-color);
        font: inherit;
        outline: none;
      }

      textarea {
        min-height: 88px;
        resize: vertical;
      }

      input:focus,
      select:focus,
      textarea:focus {
        border-color: var(--primary-color);
        box-shadow: 0 0 0 1px var(--primary-color);
      }

      .source-tabs {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin-bottom: 18px;
      }

      .source-tab,
      .mode-tab {
        border: 1px solid var(--divider-color);
        border-radius: 10px;
        padding: 14px;
        background: var(--card-background-color);
        color: var(--primary-text-color);
        text-align: left;
        cursor: pointer;
        font: inherit;
      }

      .source-tab strong,
      .mode-tab strong { display: block; margin-bottom: 4px; }

      .source-tab span,
      .mode-tab span {
        color: var(--secondary-text-color);
        font-size: 13px;
      }

      .source-tab.active,
      .mode-tab.active {
        border-color: var(--primary-color);
        box-shadow: inset 0 0 0 1px var(--primary-color);
        background: color-mix(in srgb, var(--primary-color) 7%, var(--card-background-color));
      }

      details {
        margin-top: 14px;
        border-top: 1px solid var(--divider-color);
        padding-top: 14px;
      }

      summary {
        cursor: pointer;
        color: var(--secondary-text-color);
        user-select: none;
      }

      .advanced-grid { margin-top: 16px; }

      .actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        margin-top: 18px;
      }

      button.primary,
      button.secondary {
        min-height: 42px;
        border-radius: 8px;
        padding: 0 16px;
        font: inherit;
        cursor: pointer;
      }

      button.primary {
        border: none;
        background: var(--primary-color);
        color: var(--text-primary-color, white);
      }

      button.secondary {
        border: 1px solid var(--divider-color);
        background: var(--card-background-color);
        color: var(--primary-text-color);
      }

      button:disabled {
        opacity: 0.55;
        cursor: default;
      }

      .notice {
        margin-top: 14px;
        padding: 12px 14px;
        border-radius: 8px;
        font-size: 14px;
      }

      .notice.error {
        color: var(--error-color, #db4437);
        background: color-mix(in srgb, var(--error-color, #db4437) 10%, transparent);
      }

      .notice.success {
        color: var(--success-color, #43a047);
        background: color-mix(in srgb, var(--success-color, #43a047) 10%, transparent);
      }

      .section-heading {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        align-items: start;
        margin-bottom: 14px;
      }

      .section-heading p {
        margin: 5px 0 0;
        color: var(--secondary-text-color);
        font-size: 14px;
      }

      .mode-tabs {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin-bottom: 16px;
      }

      .filter-row { margin-bottom: 12px; }

      .json-list {
        border: 1px solid var(--divider-color);
        border-radius: 10px;
        overflow: hidden;
        max-height: 430px;
        overflow-y: auto;
      }

      .json-row {
        display: grid;
        grid-template-columns: 32px minmax(0, 1fr) minmax(120px, 0.7fr);
        gap: 10px;
        align-items: center;
        padding: 11px 12px;
        border-bottom: 1px solid var(--divider-color);
        cursor: pointer;
      }

      .json-row:last-child { border-bottom: 0; }
      .json-row:hover { background: var(--secondary-background-color); }

      .json-path {
        font-family: var(--code-font-family, monospace);
        font-size: 13px;
        overflow-wrap: anywhere;
      }

      .json-value {
        color: var(--secondary-text-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: right;
      }

      .hint {
        color: var(--secondary-text-color);
        font-size: 13px;
      }

      .warning {
        padding: 12px 14px;
        border-radius: 8px;
        background: var(--secondary-background-color);
        color: var(--secondary-text-color);
        line-height: 1.45;
      }

      .preview-layout {
        display: grid;
        grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.5fr);
        gap: 16px;
      }

      .preview-frame-wrap {
        min-height: 520px;
        border: 1px solid var(--divider-color);
        border-radius: 10px;
        overflow: hidden;
        background: white;
      }

      iframe {
        display: block;
        width: 100%;
        height: 620px;
        border: 0;
        background: white;
      }

      .match-panel {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .match-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 400px;
        overflow-y: auto;
      }

      .match {
        border: 1px solid var(--divider-color);
        border-radius: 8px;
        padding: 10px;
        cursor: pointer;
        background: var(--card-background-color);
      }

      .match.selected {
        border-color: var(--primary-color);
        box-shadow: inset 0 0 0 1px var(--primary-color);
      }

      .match .tag {
        color: var(--secondary-text-color);
        font-family: var(--code-font-family, monospace);
        font-size: 12px;
        margin-top: 6px;
      }

      .selected-box {
        padding: 12px;
        border: 1px solid var(--divider-color);
        border-radius: 8px;
        background: var(--secondary-background-color);
      }

      .selected-box p { margin: 6px 0 0; }

      .checkbox-line {
        display: flex;
        gap: 10px;
        align-items: center;
        color: var(--primary-text-color);
      }

      .checkbox-line input { width: auto; min-height: auto; }

      .save-card {
        position: sticky;
        bottom: 0;
        z-index: 5;
      }

      @media (max-width: 850px) {
        .page { padding: 16px; }
        .grid,
        .preview-layout { grid-template-columns: 1fr; }
        .preview-frame-wrap { min-height: 420px; }
        iframe { height: 500px; }
      }

      @media (max-width: 560px) {
        .source-tabs,
        .mode-tabs { grid-template-columns: 1fr; }
        .json-row { grid-template-columns: 28px minmax(0, 1fr); }
        .json-value { grid-column: 2; text-align: left; }
      }
    `;
  }

  _render() {
    if (!this.shadowRoot) return;
    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <div class="page">
        <h1>Web Data Assistant</h1>
        <p class="subtitle">Turn websites and JSON APIs into Home Assistant sensors without writing selectors, paths, or templates.</p>

        <section class="card">
          <h2>1. Choose a source</h2>
          <div class="source-tabs">
            <button class="source-tab ${this._sourceType === "json" ? "active" : ""}" data-source="json">
              <strong>JSON / API</strong>
              <span>Load structured data and choose the values you want.</span>
            </button>
            <button class="source-tab ${this._sourceType === "scrape" ? "active" : ""}" data-source="scrape">
              <strong>Web page</strong>
              <span>Load a page, preview it, and identify the visible value you want.</span>
            </button>
          </div>

          <div class="grid">
            <label class="field">
              Source name
              <input id="source-name" type="text" placeholder="e.g. Carlow Weather" value="${this._escapeAttribute(this._readValue("source-name"))}">
            </label>
            <label class="field">
              URL
              <input id="source-url" type="url" placeholder="https://example.com/data" value="${this._escapeAttribute(this._readValue("source-url"))}">
            </label>
          </div>

          <details>
            <summary>Advanced request settings</summary>
            <div class="grid advanced-grid">
              <label class="field">
                Request method
                <select id="method">
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                </select>
              </label>
              <label class="checkbox-line">
                <input id="verify-ssl" type="checkbox" checked>
                Verify SSL certificate
              </label>
              <label class="field full">
                Headers (JSON object)
                <textarea id="headers" placeholder='{"Authorization": "Bearer …"}'></textarea>
              </label>
              <label class="field full">
                Request body
                <textarea id="payload" placeholder="Optional request body"></textarea>
              </label>
            </div>
          </details>

          <div class="actions">
            <button id="load-source" class="primary" ${this._loading ? "disabled" : ""}>${this._loading ? "Loading…" : "Load source"}</button>
            <span class="hint">The request is made by Home Assistant, not by your browser.</span>
          </div>
          ${this._error ? `<div class="notice error">${this._escapeHtml(this._error)}</div>` : ""}
          ${this._status ? `<div class="notice success">${this._escapeHtml(this._status)}</div>` : ""}
        </section>

        ${this._sourceType === "json" ? this._renderJsonSection() : this._renderHtmlSection()}
        ${this._renderBehaviourSection()}
        ${this._renderSaveSection()}
      </div>
    `;

    this._bindEvents();
    if (this._htmlResult) {
      queueMicrotask(() => this._bindPreviewFrame());
    }
  }

  _renderJsonSection() {
    if (!this._jsonResult) {
      return `
        <section class="card">
          <h2>2. Choose data</h2>
          <p class="hint">Load the JSON source first. Its real response will appear here for guided selection.</p>
        </section>
      `;
    }

    const values = this._jsonResult.values || [];
    const filter = this._jsonFilter.trim().toLowerCase();
    const visible = filter
      ? values.filter((item) => `${item.display_path} ${item.preview}`.toLowerCase().includes(filter))
      : values;

    const rows = visible.map((item) => {
      const checked = this._selectedJson.has(item.path) ? "checked" : "";
      return `
        <label class="json-row">
          <input type="checkbox" class="json-check" data-path="${this._escapeAttribute(item.path)}" ${checked}>
          <span class="json-path">${this._escapeHtml(item.display_path)}</span>
          <span class="json-value" title="${this._escapeAttribute(item.preview)}">${this._escapeHtml(item.preview)}</span>
        </label>
      `;
    }).join("");

    return `
      <section class="card">
        <div class="section-heading">
          <div>
            <h2>2. Choose JSON data</h2>
            <p>${values.length} values discovered in the current response.</p>
          </div>
        </div>

        <div class="mode-tabs">
          <button class="mode-tab ${this._jsonMode === "values" ? "active" : ""}" data-json-mode="values">
            <strong>Individual sensors</strong>
            <span>Select one or more values to create as separate entities.</span>
          </button>
          <button class="mode-tab ${this._jsonMode === "full" ? "active" : ""}" data-json-mode="full">
            <strong>Keep full response</strong>
            <span>Store the complete JSON document as structured sensor data.</span>
          </button>
        </div>

        ${this._jsonMode === "full" ? `
          <div class="warning">
            The full response will be stored in a sensor attribute. This can be useful for templates and automations, but large or frequently changing JSON can increase Recorder database usage.
          </div>
        ` : `
          <div class="filter-row">
            <input id="json-filter" type="search" placeholder="Filter paths or values…" value="${this._escapeAttribute(this._jsonFilter)}">
          </div>
          <div class="json-list">
            ${rows || `<div class="hint" style="padding: 16px;">No values match this filter.</div>`}
          </div>
          <p class="hint">${this._selectedJson.size} value${this._selectedJson.size === 1 ? "" : "s"} selected.</p>
        `}
      </section>
    `;
  }

  _renderHtmlSection() {
    if (!this._htmlResult) {
      return `
        <section class="card">
          <h2>2. Find the value</h2>
          <p class="hint">Load the web page first. Web Data Assistant will create a safe local preview that you can inspect without giving the remote page access to Home Assistant.</p>
        </section>
      `;
    }

    const elements = this._htmlResult.elements || {};
    const query = this._htmlFilter.trim().toLowerCase();
    const matches = query
      ? Object.entries(elements).filter(([, item]) => (item.text || "").toLowerCase().includes(query))
      : [];

    const matchMarkup = query
      ? matches.slice(0, 50).map(([id, item]) => `
          <div class="match ${this._selectedHtmlId === id ? "selected" : ""}" data-preview-id="${this._escapeAttribute(id)}">
            <div>${this._escapeHtml(item.text || "(No text)")}</div>
            <div class="tag">&lt;${this._escapeHtml(item.tag)}&gt;</div>
          </div>
        `).join("")
      : `<div class="hint">Enter text that is currently visible on the page, or click a value directly in the preview.</div>`;

    const selected = this._selectedHtmlId !== null ? elements[this._selectedHtmlId] : null;

    return `
      <section class="card">
        <div class="section-heading">
          <div>
            <h2>2. Find the value</h2>
            <p>Click a value in the preview, or identify it using text that is visible on the page now.</p>
          </div>
        </div>

        <div class="preview-layout">
          <div class="preview-frame-wrap">
            <iframe id="page-preview" sandbox="allow-same-origin"></iframe>
          </div>
          <aside class="match-panel">
            <label class="field">
              Current text or value
              <input id="html-filter" type="search" placeholder="e.g. 14.6 °C" value="${this._escapeAttribute(this._htmlFilter)}">
            </label>
            <div class="hint">${query ? `${matches.length} matching element${matches.length === 1 ? "" : "s"} found.` : ""}</div>
            <div class="match-list">${matchMarkup}</div>
            ${selected ? `
              <div class="selected-box">
                <h3>Selected value</h3>
                <p>${this._escapeHtml(selected.text || "(No text)")}</p>
                <details>
                  <summary>Advanced extraction details</summary>
                  <p class="hint">Selector: <code>${this._escapeHtml(selected.selector)}</code><br>Match index: ${selected.index}</p>
                </details>
              </div>
            ` : ""}
          </aside>
        </div>
      </section>
    `;
  }

  _renderBehaviourSection() {
    return `
      <section class="card">
        <h2>3. Refresh and failure behaviour</h2>
        <div class="grid">
          <label class="field">
            Update interval (minutes)
            <input id="scan-interval" type="number" min="1" max="1440" value="${this._escapeAttribute(this._readValue("scan-interval") || "5")}">
          </label>
          <label class="field">
            If the source cannot be reached
            <select id="failure-mode">
              <option value="unavailable">Mark sensors unavailable</option>
              <option value="keep_last">Keep the last known value</option>
            </select>
          </label>
          <label class="field full" id="stale-wrapper" style="display:none;">
            Maximum age of retained value (minutes)
            <input id="max-stale" type="number" min="1" max="525600" placeholder="Leave empty to keep indefinitely">
            <span class="hint">Optional. After this long without a successful update, the retained value becomes unavailable.</span>
          </label>
        </div>
      </section>
    `;
  }

  _renderSaveSection() {
    const canSave = this._canSave();
    return `
      <section class="card save-card">
        <div class="section-heading" style="margin-bottom:0; align-items:center;">
          <div>
            <h2 style="margin-bottom:4px;">Create source</h2>
            <p style="margin:0;">The selected values will share one source request on each refresh.</p>
          </div>
          <button id="save-source" class="primary" ${!canSave || this._saving ? "disabled" : ""}>${this._saving ? "Creating…" : "Create in Home Assistant"}</button>
        </div>
      </section>
    `;
  }

  _bindEvents() {
    this.shadowRoot.querySelectorAll("[data-source]").forEach((button) => {
      button.addEventListener("click", () => {
        this._captureFormValues();
        this._sourceType = button.dataset.source;
        this._error = "";
        this._status = "";
        this._jsonResult = null;
        this._htmlResult = null;
        this._selectedJson.clear();
        this._selectedHtmlId = null;
        this._render();
      });
    });

    this.shadowRoot.getElementById("load-source")?.addEventListener("click", () => this._loadSource());
    this.shadowRoot.getElementById("save-source")?.addEventListener("click", () => this._saveSource());

    this.shadowRoot.querySelectorAll("[data-json-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        this._captureFormValues();
        this._jsonMode = button.dataset.jsonMode;
        this._render();
      });
    });

    this.shadowRoot.querySelectorAll(".json-check").forEach((checkbox) => {
      checkbox.addEventListener("change", (event) => {
        const path = event.target.dataset.path;
        if (event.target.checked) this._selectedJson.add(path);
        else this._selectedJson.delete(path);
        const hint = this.shadowRoot.querySelector(".json-list + .hint");
        if (hint) hint.textContent = `${this._selectedJson.size} value${this._selectedJson.size === 1 ? "" : "s"} selected.`;
        this._refreshSaveButton();
      });
    });

    this.shadowRoot.getElementById("json-filter")?.addEventListener("input", (event) => {
      this._captureFormValues();
      this._jsonFilter = event.target.value;
      this._render();
    });

    this.shadowRoot.getElementById("html-filter")?.addEventListener("input", (event) => {
      this._captureFormValues();
      this._htmlFilter = event.target.value;
      this._render();
    });

    this.shadowRoot.querySelectorAll(".match[data-preview-id]").forEach((match) => {
      match.addEventListener("click", () => {
        this._captureFormValues();
        this._selectedHtmlId = match.dataset.previewId;
        this._render();
      });
    });

    const failureMode = this.shadowRoot.getElementById("failure-mode");
    failureMode?.addEventListener("change", () => this._syncStaleVisibility());
    this._restoreCapturedValues();
    this._syncStaleVisibility();
  }

  _bindPreviewFrame() {
    const frame = this.shadowRoot.getElementById("page-preview");
    if (!frame || !this._htmlResult) return;
    frame.srcdoc = this._htmlResult.html || "";
    frame.addEventListener("load", () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      doc.addEventListener("click", (event) => {
        const element = event.target?.closest?.("[data-wda-preview-id]");
        if (!element) return;
        event.preventDefault();
        event.stopPropagation();
        this._captureFormValues();
        this._selectedHtmlId = element.getAttribute("data-wda-preview-id");
        this._render();
      }, true);

      if (this._selectedHtmlId !== null) {
        doc.querySelectorAll("[data-wda-preview-id]").forEach((element) => {
          element.style.boxShadow = "none";
        });
        const selected = doc.querySelector(`[data-wda-preview-id="${CSS.escape(this._selectedHtmlId)}"]`);
        if (selected) {
          selected.style.boxShadow = "0 0 0 3px #03a9f4 inset";
          selected.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      }
    });
  }

  _captureFormValues() {
    const ids = ["source-name", "source-url", "method", "headers", "payload", "scan-interval", "failure-mode", "max-stale"];
    this._formValues = this._formValues || {};
    ids.forEach((id) => {
      const el = this.shadowRoot.getElementById(id);
      if (el) this._formValues[id] = el.value;
    });
    const ssl = this.shadowRoot.getElementById("verify-ssl");
    if (ssl) this._formValues["verify-ssl"] = ssl.checked;
  }

  _restoreCapturedValues() {
    if (!this._formValues) return;
    Object.entries(this._formValues).forEach(([id, value]) => {
      const el = this.shadowRoot.getElementById(id);
      if (!el) return;
      if (id === "verify-ssl") el.checked = Boolean(value);
      else el.value = value;
    });
  }

  _readValue(id) {
    const current = this.shadowRoot?.getElementById(id);
    if (current) return current.value || "";
    return this._formValues?.[id] ?? "";
  }

  _requestSettings() {
    const headersText = this.shadowRoot.getElementById("headers")?.value.trim() || "";
    let headers = {};
    if (headersText) {
      try {
        headers = JSON.parse(headersText);
      } catch (err) {
        throw new Error("Headers must be a valid JSON object.");
      }
      if (!headers || Array.isArray(headers) || typeof headers !== "object") {
        throw new Error("Headers must be a JSON object.");
      }
      headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [String(key), String(value)]));
    }

    return {
      url: this.shadowRoot.getElementById("source-url")?.value.trim() || "",
      method: this.shadowRoot.getElementById("method")?.value || "GET",
      headers,
      payload: this.shadowRoot.getElementById("payload")?.value || undefined,
      verify_ssl: this.shadowRoot.getElementById("verify-ssl")?.checked !== false,
    };
  }

  async _loadSource() {
    if (!this._hass) return;
    this._captureFormValues();
    const name = this.shadowRoot.getElementById("source-name")?.value.trim();
    const url = this.shadowRoot.getElementById("source-url")?.value.trim();
    if (!name || !url) {
      this._error = "Enter a source name and URL first.";
      this._status = "";
      this._render();
      return;
    }

    let request;
    try {
      request = this._requestSettings();
    } catch (err) {
      this._error = err.message;
      this._status = "";
      this._render();
      return;
    }

    this._loading = true;
    this._error = "";
    this._status = "";
    this._render();

    try {
      if (this._sourceType === "json") {
        this._jsonResult = await this._hass.callWS({
          type: "web_data_assistant/preview_json",
          ...request,
        });
        this._htmlResult = null;
        this._selectedJson.clear();
        this._status = `Loaded ${this._jsonResult.values?.length || 0} selectable JSON values.`;
      } else {
        this._htmlResult = await this._hass.callWS({
          type: "web_data_assistant/preview_html",
          ...request,
        });
        this._jsonResult = null;
        this._selectedHtmlId = null;
        this._status = "Page loaded. Click a value in the preview or find it by its current text.";
      }
    } catch (err) {
      this._error = err?.message || "The source could not be loaded.";
    } finally {
      this._loading = false;
      this._render();
    }
  }

  _buildEntities() {
    const name = this.shadowRoot.getElementById("source-name")?.value.trim() || "Web data";
    if (this._sourceType === "json") {
      if (this._jsonMode === "full") {
        return [{ key: "full_response", name, path: "", value_type: "json" }];
      }
      const byPath = new Map((this._jsonResult?.values || []).map((item) => [item.path, item]));
      const used = new Set();
      return [...this._selectedJson].map((path) => {
        const item = byPath.get(path);
        const display = item?.display_path || path || "root";
        let key = this._slug(path.replaceAll("/", "_")) || "root";
        const base = key;
        let suffix = 2;
        while (used.has(key)) key = `${base}_${suffix++}`;
        used.add(key);
        return {
          key,
          name: this._friendlyName(display),
          path,
          value_type: this._valueType(item?.value_type),
        };
      });
    }

    const selected = this._htmlResult?.elements?.[this._selectedHtmlId];
    if (!selected) return [];
    return [{
      key: this._slug(name) || "web_value",
      name,
      selector: selected.selector,
      index: Number(selected.index || 0),
      value_type: "text",
    }];
  }

  async _saveSource() {
    if (!this._hass || !this._canSave()) return;
    this._captureFormValues();
    let request;
    try {
      request = this._requestSettings();
    } catch (err) {
      this._error = err.message;
      this._render();
      return;
    }

    const name = this.shadowRoot.getElementById("source-name")?.value.trim();
    const failureMode = this.shadowRoot.getElementById("failure-mode")?.value || "unavailable";
    const interval = Math.max(1, Number(this.shadowRoot.getElementById("scan-interval")?.value || 5));
    const staleRaw = this.shadowRoot.getElementById("max-stale")?.value.trim();

    const message = {
      type: "web_data_assistant/create_source",
      source_name: name,
      source_type: this._sourceType,
      entities: this._buildEntities(),
      scan_interval: interval,
      failure_mode: failureMode,
      ...request,
    };
    if (failureMode === "keep_last" && staleRaw) {
      message.max_stale_minutes = Math.max(1, Number(staleRaw));
    }

    this._saving = true;
    this._error = "";
    this._status = "";
    this._render();
    try {
      const result = await this._hass.callWS(message);
      this._status = `Created successfully${result?.entry_id ? ` (entry ${result.entry_id})` : ""}.`;
      this._selectedJson.clear();
      this._selectedHtmlId = null;
    } catch (err) {
      this._error = err?.message || "Home Assistant could not create the source.";
    } finally {
      this._saving = false;
      this._render();
    }
  }

  _canSave() {
    const name = this._readValue("source-name").trim();
    const url = this._readValue("source-url").trim();
    if (!name || !url) return false;
    if (this._sourceType === "json") {
      if (!this._jsonResult) return false;
      return this._jsonMode === "full" || this._selectedJson.size > 0;
    }
    return Boolean(this._htmlResult && this._selectedHtmlId !== null);
  }

  _refreshSaveButton() {
    const button = this.shadowRoot.getElementById("save-source");
    if (button) button.disabled = !this._canSave() || this._saving;
  }

  _syncStaleVisibility() {
    const mode = this.shadowRoot.getElementById("failure-mode")?.value;
    const wrapper = this.shadowRoot.getElementById("stale-wrapper");
    if (wrapper) wrapper.style.display = mode === "keep_last" ? "flex" : "none";
  }

  _friendlyName(displayPath) {
    let leaf = displayPath.split(".").pop() || displayPath;
    leaf = leaf.replace(/\[\d+\]$/, "");
    leaf = leaf.replace(/[_-]+/g, " ").trim();
    return leaf ? leaf.replace(/\b\w/g, (char) => char.toUpperCase()) : "Web value";
  }

  _valueType(typeName) {
    if (typeName === "bool") return "boolean";
    if (typeName === "int" || typeName === "float") return "number";
    return "text";
  }

  _slug(value) {
    return String(value || "")
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  _escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  _escapeAttribute(value) {
    return this._escapeHtml(value).replaceAll("`", "&#096;");
  }
}

if (!customElements.get("web-data-assistant-panel")) {
  customElements.define("web-data-assistant-panel", WebDataAssistantPanel);
}
