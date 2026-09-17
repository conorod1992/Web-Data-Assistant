class WebDataAssistantPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._sourceType = "json";
    this._loading = false;
    this._searching = false;
    this._saving = false;
    this._error = "";
    this._status = "";

    this._sources = [];
    this._sourcesLoaded = false;
    this._sourcesError = "";
    this._refreshingSource = null;

    this._form = {
      name: "",
      url: "",
      method: "GET",
      headers: "",
      payload: "",
      verifySsl: true,
      scanInterval: "5",
      failureMode: "unavailable",
      maxStale: "",
    };

    this._jsonResult = null;
    this._jsonMode = "values";
    this._jsonFilter = "";
    this._selectedJson = new Set();
    this._jsonOverrides = new Map();

    this._htmlResult = null;
    this._htmlSearchText = "";
    this._htmlMatches = [];
    this._selectedExtraction = null;
    this._selectedPreviewId = null;
    this._scrapeUnit = "";
  }

  set hass(value) {
    this._hass = value;
    if (!this.shadowRoot.innerHTML) this._render();
    if (!this._sourcesLoaded) void this._loadSources();
  }

  set narrow(value) {
    this._narrow = value;
  }

  set panel(value) {
    this._panel = value;
  }

  connectedCallback() {
    this._render();
    if (this._hass && !this._sourcesLoaded) void this._loadSources();
  }

  _styles() {
    return `
      :host {
        display:block;
        min-height:100vh;
        background:var(--primary-background-color);
        color:var(--primary-text-color);
        font-family:var(--paper-font-body1_-_font-family, sans-serif);
      }
      * { box-sizing:border-box; }
      .page { max-width:1180px; margin:0 auto; padding:24px; }
      h1 { margin:0; font-size:28px; font-weight:500; }
      h2 { margin:0 0 16px; font-size:20px; font-weight:500; }
      h3 { margin:0; font-size:16px; font-weight:500; }
      p { line-height:1.5; }
      code { font-family:var(--code-font-family, monospace); overflow-wrap:anywhere; }
      .subtitle { margin:8px 0 24px; color:var(--secondary-text-color); }
      .card {
        margin-bottom:18px;
        padding:20px;
        border:1px solid var(--divider-color);
        border-radius:var(--ha-card-border-radius, 12px);
        background:var(--ha-card-background, var(--card-background-color));
        box-shadow:var(--ha-card-box-shadow, none);
      }
      .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
      .full { grid-column:1/-1; }
      .field { display:flex; flex-direction:column; gap:7px; color:var(--secondary-text-color); font-size:13px; }
      input, select, textarea {
        width:100%; min-height:44px; padding:10px 12px;
        border:1px solid var(--divider-color); border-radius:8px;
        background:var(--card-background-color); color:var(--primary-text-color);
        font:inherit; outline:none;
      }
      textarea { min-height:88px; resize:vertical; }
      input:focus, select:focus, textarea:focus { border-color:var(--primary-color); box-shadow:0 0 0 1px var(--primary-color); }
      .tabs { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-bottom:18px; }
      .tab {
        padding:14px; border:1px solid var(--divider-color); border-radius:10px;
        background:var(--card-background-color); color:var(--primary-text-color);
        text-align:left; cursor:pointer; font:inherit;
      }
      .tab strong { display:block; margin-bottom:4px; }
      .tab span { color:var(--secondary-text-color); font-size:13px; }
      .tab.active { border-color:var(--primary-color); box-shadow:inset 0 0 0 1px var(--primary-color); }
      details { margin-top:14px; padding-top:14px; border-top:1px solid var(--divider-color); }
      summary { color:var(--secondary-text-color); cursor:pointer; user-select:none; }
      .advanced { margin-top:16px; }
      .checkbox { display:flex; align-items:center; gap:10px; color:var(--primary-text-color); }
      .checkbox input { width:auto; min-height:auto; }
      .actions { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-top:18px; }
      button.primary, button.secondary {
        min-height:42px; padding:0 16px; border-radius:8px; font:inherit; cursor:pointer;
      }
      button.primary { border:0; background:var(--primary-color); color:var(--text-primary-color, white); }
      button.secondary { border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color); }
      button:disabled { opacity:.55; cursor:default; }
      .hint { color:var(--secondary-text-color); font-size:13px; }
      .notice { margin-top:14px; padding:12px 14px; border-radius:8px; font-size:14px; }
      .notice.error { color:var(--error-color,#db4437); background:color-mix(in srgb,var(--error-color,#db4437) 10%,transparent); }
      .notice.success { color:var(--success-color,#43a047); background:color-mix(in srgb,var(--success-color,#43a047) 10%,transparent); }
      .warning { padding:12px 14px; border-radius:8px; background:var(--secondary-background-color); color:var(--secondary-text-color); line-height:1.45; }
      .heading { display:flex; justify-content:space-between; align-items:start; gap:14px; margin-bottom:14px; }
      .heading p { margin:5px 0 0; color:var(--secondary-text-color); font-size:14px; }

      .source-list { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:12px; }
      .source-card { border:1px solid var(--divider-color); border-radius:10px; padding:14px; min-width:0; }
      .source-card-head { display:flex; justify-content:space-between; align-items:start; gap:10px; }
      .source-title { font-weight:500; overflow-wrap:anywhere; }
      .source-url { margin-top:6px; color:var(--secondary-text-color); font-size:12px; overflow-wrap:anywhere; }
      .source-meta { display:flex; flex-wrap:wrap; gap:6px 12px; margin-top:12px; color:var(--secondary-text-color); font-size:12px; }
      .health { display:inline-flex; align-items:center; gap:6px; white-space:nowrap; font-size:12px; }
      .health-dot { width:8px; height:8px; border-radius:50%; background:var(--disabled-text-color); }
      .health.available .health-dot { background:var(--success-color,#43a047); }
      .health.degraded .health-dot,
      .health.retained .health-dot { background:var(--warning-color,#ff9800); }
      .health.unavailable .health-dot { background:var(--error-color,#db4437); }

      .json-list { max-height:430px; overflow-y:auto; border:1px solid var(--divider-color); border-radius:10px; }
      .json-row { display:grid; grid-template-columns:32px minmax(0,1fr) minmax(120px,.7fr); gap:10px; align-items:center; padding:11px 12px; border-bottom:1px solid var(--divider-color); cursor:pointer; }
      .json-row:last-child { border-bottom:0; }
      .json-row:hover, .match:hover { background:var(--secondary-background-color); }
      .json-path { font-family:var(--code-font-family,monospace); font-size:13px; overflow-wrap:anywhere; }
      .json-value { color:var(--secondary-text-color); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:right; }
      .sensor-review { margin-top:18px; padding-top:16px; border-top:1px solid var(--divider-color); }
      .sensor-review h3 { margin-bottom:10px; }
      .sensor-review-row { display:grid; grid-template-columns:minmax(0,1fr) minmax(120px,.35fr); gap:12px; padding:12px 0; border-top:1px solid var(--divider-color); }
      .sensor-review-row:first-of-type { border-top:0; }
      .sensor-path { grid-column:1/-1; color:var(--secondary-text-color); font-family:var(--code-font-family,monospace); font-size:12px; overflow-wrap:anywhere; }

      .preview-layout { display:grid; grid-template-columns:minmax(0,1.55fr) minmax(290px,.45fr); gap:16px; }
      .frame-wrap { min-height:520px; overflow:hidden; border:1px solid var(--divider-color); border-radius:10px; background:white; }
      iframe { display:block; width:100%; height:620px; border:0; background:white; }
      .side { display:flex; flex-direction:column; gap:12px; }
      .search-row { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:end; }
      .matches { display:flex; flex-direction:column; gap:8px; max-height:390px; overflow-y:auto; }
      .match { padding:10px; border:1px solid var(--divider-color); border-radius:8px; background:var(--card-background-color); cursor:pointer; }
      .match.selected { border-color:var(--primary-color); box-shadow:inset 0 0 0 1px var(--primary-color); }
      .match-context { margin-top:5px; color:var(--secondary-text-color); font-size:12px; }
      .selected { padding:12px; border:1px solid var(--divider-color); border-radius:8px; background:var(--secondary-background-color); }
      .selected p { margin:6px 0 0; }
      .save-card { position:sticky; bottom:0; z-index:5; }
      @media(max-width:850px) {
        .page { padding:16px; }
        .grid,.preview-layout { grid-template-columns:1fr; }
        iframe { height:500px; }
      }
      @media(max-width:560px) {
        .tabs,.search-row,.sensor-review-row { grid-template-columns:1fr; }
        .json-row { grid-template-columns:28px minmax(0,1fr); }
        .json-value { grid-column:2; text-align:left; }
      }
    `;
  }

  _render() {
    if (!this.shadowRoot) return;
    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <div class="page">
        <h1>Web Data Assistant</h1>
        <p class="subtitle">Create Home Assistant sensors from websites and JSON APIs without writing selectors, paths, or templates.</p>

        ${this._renderSources()}

        <section class="card">
          <h2>Create a source</h2>
          <div class="tabs">
            ${this._tab("json", "JSON / API", "Load structured data and choose one or more values.")}
            ${this._tab("scrape", "Web page", "Preview a page and identify the visible value you want.")}
          </div>
          <div class="grid">
            ${this._field("Source name", `<input id="name" type="text" placeholder="e.g. Carlow Weather" value="${this._attr(this._form.name)}">`)}
            ${this._field("URL", `<input id="url" type="url" placeholder="https://example.com/data" value="${this._attr(this._form.url)}">`)}
          </div>
          <details>
            <summary>Advanced request settings</summary>
            <div class="grid advanced">
              ${this._field("Request method", `<select id="method"><option value="GET" ${this._form.method === "GET" ? "selected" : ""}>GET</option><option value="POST" ${this._form.method === "POST" ? "selected" : ""}>POST</option></select>`)}
              <label class="checkbox"><input id="verify-ssl" type="checkbox" ${this._form.verifySsl ? "checked" : ""}> Verify SSL certificate</label>
              ${this._field("Headers (JSON object)", `<textarea id="headers" placeholder='{"Authorization":"Bearer …"}'>${this._html(this._form.headers)}</textarea>`, true)}
              ${this._field("Request body", `<textarea id="payload" placeholder="Optional request body">${this._html(this._form.payload)}</textarea>`, true)}
            </div>
          </details>
          <div class="actions">
            <button id="load" class="primary" ${this._loading ? "disabled" : ""}>${this._loading ? "Loading…" : "Load source"}</button>
            <span class="hint">Home Assistant performs the request; browser CORS restrictions do not apply.</span>
          </div>
          ${this._error ? `<div class="notice error">${this._html(this._error)}</div>` : ""}
          ${this._status ? `<div class="notice success">${this._html(this._status)}</div>` : ""}
        </section>

        ${this._sourceType === "json" ? this._renderJson() : this._renderScrape()}
        ${this._renderBehaviour()}
        ${this._renderSave()}
      </div>
    `;

    this._bind();
    if (this._htmlResult) queueMicrotask(() => this._bindFrame());
  }

  _renderSources() {
    if (!this._sourcesLoaded) {
      return `<section class="card"><h2>Configured sources</h2><p class="hint">Loading configured sources…</p></section>`;
    }
    if (this._sourcesError) {
      return `<section class="card"><h2>Configured sources</h2><div class="notice error">${this._html(this._sourcesError)}</div></section>`;
    }
    if (!this._sources.length) {
      return `<section class="card"><h2>Configured sources</h2><p class="hint">No Web Data Assistant sources have been created yet.</p></section>`;
    }

    const cards = this._sources.map((source) => {
      const health = this._sourceHealth(source);
      const lastSuccess = source.last_successful_update ? this._formatDate(source.last_successful_update) : "Never";
      const type = source.source_type === "json" ? "JSON / API" : "Web page";
      const retaining = source.failure_mode === "keep_last" ? "Keep last value" : "Unavailable on failure";
      const extractionErrors = Number(source.extraction_error_count || 0);
      return `
        <div class="source-card">
          <div class="source-card-head">
            <div>
              <div class="source-title">${this._html(source.title)}</div>
              <div class="source-url">${this._html(source.url || "")}</div>
            </div>
            <span class="health ${health.className}"><span class="health-dot"></span>${this._html(health.label)}</span>
          </div>
          <div class="source-meta">
            <span>${this._html(type)}</span>
            <span>${Number(source.entity_count || 0)} sensor${Number(source.entity_count || 0) === 1 ? "" : "s"}</span>
            <span>Every ${Number(source.scan_interval || 5)} min</span>
            <span>${this._html(retaining)}</span>
            <span>Last success: ${this._html(lastSuccess)}</span>
            ${extractionErrors ? `<span>${extractionErrors} extraction issue${extractionErrors === 1 ? "" : "s"}</span>` : ""}
          </div>
          <div class="actions">
            <button class="secondary refresh-source" data-entry-id="${this._attr(source.entry_id)}" ${this._refreshingSource === source.entry_id || source.state !== "loaded" ? "disabled" : ""}>${this._refreshingSource === source.entry_id ? "Refreshing…" : "Refresh now"}</button>
          </div>
        </div>`;
    }).join("");

    return `<section class="card"><div class="heading"><div><h2>Configured sources</h2><p>Current source health is shown without exposing request credentials or retrieved values.</p></div></div><div class="source-list">${cards}</div></section>`;
  }

  _sourceHealth(source) {
    if (source.state !== "loaded") return { className:"unavailable", label:"Not loaded" };
    const extractionErrors = Number(source.extraction_error_count || 0);
    if (source.source_available && extractionErrors) {
      return { className:"degraded", label:`${extractionErrors} extraction issue${extractionErrors === 1 ? "" : "s"}` };
    }
    if (source.source_available) return { className:"available", label:"Available" };
    if (source.failure_mode === "keep_last" && source.last_successful_update) return { className:"retained", label:"Source unavailable · retained" };
    return { className:"unavailable", label:"Source unavailable" };
  }

  _tab(type, title, subtitle) {
    return `<button class="tab ${this._sourceType === type ? "active" : ""}" data-source="${type}"><strong>${title}</strong><span>${subtitle}</span></button>`;
  }

  _field(label, control, full = false) {
    return `<label class="field ${full ? "full" : ""}">${label}${control}</label>`;
  }

  _renderJson() {
    if (!this._jsonResult) {
      return `<section class="card"><h2>2. Choose data</h2><p class="hint">Load the API first. Web Data Assistant will show the values from its real JSON response here.</p></section>`;
    }

    const all = this._jsonResult.values || [];
    const query = this._jsonFilter.trim().toLowerCase();
    const visible = query ? all.filter((item) => `${item.display_path} ${item.preview}`.toLowerCase().includes(query)) : all;
    const byPath = new Map(all.map((item) => [item.path,item]));
    const rows = visible.map((item) => `
      <label class="json-row">
        <input class="json-check" type="checkbox" data-path="${this._attr(item.path)}" ${this._selectedJson.has(item.path) ? "checked" : ""}>
        <span class="json-path">${this._html(item.display_path)}</span>
        <span class="json-value" title="${this._attr(item.preview)}">${this._html(item.preview)}</span>
      </label>`).join("");

    const reviewRows = [...this._selectedJson].map((path) => {
      const item = byPath.get(path);
      const metadata = this._jsonMetadata(path, item);
      return `
        <div class="sensor-review-row">
          <div class="sensor-path">${this._html(item?.display_path || path || "(root)")}</div>
          ${this._field("Sensor name", `<input class="json-name" data-path="${this._attr(path)}" type="text" value="${this._attr(metadata.name)}">`)}
          ${this._field("Unit (optional)", `<input class="json-unit" data-path="${this._attr(path)}" type="text" placeholder="e.g. °C, %, kWh" value="${this._attr(metadata.unit)}">`)}
        </div>`;
    }).join("");

    return `
      <section class="card">
        <div class="heading"><div><h2>2. Choose JSON data</h2><p>${all.length} selectable scalar values ${this._jsonResult.truncated ? "shown" : "found"}.</p></div></div>
        <div class="tabs">
          <button class="tab ${this._jsonMode === "values" ? "active" : ""}" data-json-mode="values"><strong>Individual sensors</strong><span>Create a separate entity for each selected value.</span></button>
          <button class="tab ${this._jsonMode === "full" ? "active" : ""}" data-json-mode="full"><strong>Keep full response</strong><span>Store the whole JSON document as structured sensor data.</span></button>
        </div>
        ${this._jsonMode === "full" ? `
          <div class="warning">The complete JSON response will be stored in an entity attribute. Large or frequently changing responses can substantially increase Recorder database usage.</div>
        ` : `
          ${this._jsonResult.truncated ? `<div class="warning" style="margin-bottom:12px;">This response contains more than 250 scalar values. Guided selection shows the first 250 to keep the browser responsive.</div>` : ""}
          <input id="json-filter" type="search" placeholder="Filter paths or current values…" value="${this._attr(this._jsonFilter)}" style="margin-bottom:12px;">
          <div class="json-list">${rows || `<div class="hint" style="padding:16px;">No values match this filter.</div>`}</div>
          <p class="hint">${this._selectedJson.size} value${this._selectedJson.size === 1 ? "" : "s"} selected.</p>
          ${reviewRows ? `<div class="sensor-review"><h3>Review sensors</h3><p class="hint">Friendly names and units can be adjusted without touching the generated JSON paths.</p>${reviewRows}</div>` : ""}
        `}
      </section>`;
  }

  _renderScrape() {
    if (!this._htmlResult) {
      return `<section class="card"><h2>2. Find the value</h2><p class="hint">Load the page first. A script-free local preview will appear here so you can click the value directly or find it using its current text.</p></section>`;
    }

    const matches = this._htmlMatches.map((match, index) => {
      const selected = this._selectedExtraction === match;
      return `
        <div class="match ${selected ? "selected" : ""}" data-match="${index}">
          <div>${this._html(match.text || "(No text)")}</div>
          ${match.context && match.context !== match.text ? `<div class="match-context">${this._html(match.context)}</div>` : ""}
          <div class="match-context">&lt;${this._html(match.tag || "element")}&gt;</div>
        </div>`;
    }).join("");

    const selected = this._selectedExtraction;
    return `
      <section class="card">
        <div class="heading"><div><h2>2. Find the value</h2><p>Click it in the page preview, or search using text that is visible on the page right now.</p></div></div>
        <div class="preview-layout">
          <div class="frame-wrap"><iframe id="preview" sandbox="allow-same-origin"></iframe></div>
          <aside class="side">
            <div class="search-row">
              ${this._field("Current text or value", `<input id="html-search" type="search" placeholder="e.g. 14.6 °C" value="${this._attr(this._htmlSearchText)}">`)}
              <button id="find-text" class="secondary" ${this._searching ? "disabled" : ""}>${this._searching ? "Finding…" : "Find text"}</button>
            </div>
            <div class="hint">${this._htmlMatches.length ? `${this._htmlMatches.length} specific match${this._htmlMatches.length === 1 ? "" : "es"} found.` : "Search results will appear here. Direct clicking always remains available."}</div>
            <div class="matches">${matches}</div>
            ${selected ? `
              <div class="selected">
                <h3>Selected value</h3>
                <p>${this._html(selected.text || "(No text)")}</p>
                ${this._field("Unit (optional)", `<input id="scrape-unit" type="text" placeholder="e.g. °C, %, km/h" value="${this._attr(this._scrapeUnit)}">`)}
                <details><summary>Advanced extraction details</summary><p class="hint">Selector: <code>${this._html(selected.selector)}</code><br>Match index: ${Number(selected.index || 0)}</p></details>
              </div>` : ""}
          </aside>
        </div>
      </section>`;
  }

  _renderBehaviour() {
    const showStale = this._form.failureMode === "keep_last";
    return `
      <section class="card">
        <h2>3. Refresh and failure behaviour</h2>
        <div class="grid">
          ${this._field("Update interval (minutes)", `<input id="interval" type="number" min="1" max="1440" value="${this._attr(this._form.scanInterval)}">`)}
          ${this._field("If the source cannot be reached", `<select id="failure"><option value="unavailable" ${this._form.failureMode === "unavailable" ? "selected" : ""}>Mark sensors unavailable</option><option value="keep_last" ${showStale ? "selected" : ""}>Keep the last known value</option></select>`)}
          ${showStale ? this._field("Maximum age of retained value (minutes)", `<input id="stale" type="number" min="1" max="525600" placeholder="Leave empty to keep indefinitely" value="${this._attr(this._form.maxStale)}"><span class="hint">Optional. If updates keep failing beyond this age, the retained value becomes unavailable, including across Home Assistant restarts.</span>`, true) : ""}
        </div>
      </section>`;
  }

  _renderSave() {
    return `
      <section class="card save-card">
        <div class="heading" style="margin:0;align-items:center;">
          <div><h2 style="margin-bottom:4px;">Create source</h2><p style="margin:0;">All selected values from one endpoint share the same HTTP request.</p></div>
          <button id="save" class="primary" ${!this._canSave() || this._saving ? "disabled" : ""}>${this._saving ? "Creating…" : "Create in Home Assistant"}</button>
        </div>
      </section>`;
  }

  _bind() {
    const valueBindings = {
      name: ["name", "input"], url: ["url", "input"], method: ["method", "change"],
      headers: ["headers", "input"], payload: ["payload", "input"], scanInterval: ["interval", "input"],
      maxStale: ["stale", "input"], htmlSearchText: ["html-search", "input"], scrapeUnit: ["scrape-unit", "input"],
    };
    Object.entries(valueBindings).forEach(([stateKey, [id, eventName]]) => {
      this.shadowRoot.getElementById(id)?.addEventListener(eventName, (event) => {
        if (stateKey === "htmlSearchText") this._htmlSearchText = event.target.value;
        else if (stateKey === "scrapeUnit") this._scrapeUnit = event.target.value;
        else this._form[stateKey] = event.target.value;
        this._refreshSave();
      });
    });

    this.shadowRoot.getElementById("verify-ssl")?.addEventListener("change", (event) => {
      this._form.verifySsl = event.target.checked;
    });
    this.shadowRoot.getElementById("failure")?.addEventListener("change", (event) => {
      this._form.failureMode = event.target.value;
      this._render();
    });

    this.shadowRoot.querySelectorAll("[data-source]").forEach((button) => button.addEventListener("click", () => {
      this._sourceType = button.dataset.source;
      this._resetResults();
      this._render();
    }));
    this.shadowRoot.querySelectorAll("[data-json-mode]").forEach((button) => button.addEventListener("click", () => {
      this._jsonMode = button.dataset.jsonMode;
      this._render();
    }));
    this.shadowRoot.querySelectorAll(".json-check").forEach((checkbox) => checkbox.addEventListener("change", (event) => {
      const path = event.target.dataset.path;
      if (event.target.checked) {
        this._selectedJson.add(path);
        const item = (this._jsonResult?.values || []).find((candidate) => candidate.path === path);
        this._jsonMetadata(path, item);
      } else {
        this._selectedJson.delete(path);
        this._jsonOverrides.delete(path);
      }
      this._render();
    }));
    this.shadowRoot.querySelectorAll(".json-name").forEach((input) => input.addEventListener("input", (event) => {
      const metadata = this._jsonMetadata(event.target.dataset.path);
      metadata.name = event.target.value;
      this._refreshSave();
    }));
    this.shadowRoot.querySelectorAll(".json-unit").forEach((input) => input.addEventListener("input", (event) => {
      const metadata = this._jsonMetadata(event.target.dataset.path);
      metadata.unit = event.target.value;
    }));
    this.shadowRoot.getElementById("json-filter")?.addEventListener("input", (event) => {
      this._jsonFilter = event.target.value;
      this._render();
    });
    this.shadowRoot.querySelectorAll("[data-match]").forEach((element) => element.addEventListener("click", () => {
      this._selectedExtraction = this._htmlMatches[Number(element.dataset.match)];
      this._selectedPreviewId = null;
      this._render();
    }));
    this.shadowRoot.querySelectorAll(".refresh-source").forEach((button) => button.addEventListener("click", () => this._refreshSource(button.dataset.entryId)));

    this.shadowRoot.getElementById("load")?.addEventListener("click", () => this._load());
    this.shadowRoot.getElementById("find-text")?.addEventListener("click", () => this._findText());
    this.shadowRoot.getElementById("save")?.addEventListener("click", () => this._save());
  }

  _bindFrame() {
    const frame = this.shadowRoot.getElementById("preview");
    if (!frame || !this._htmlResult) return;
    frame.srcdoc = this._htmlResult.html || "";
    frame.addEventListener("load", () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      doc.addEventListener("click", (event) => {
        const node = event.target?.closest?.("[data-wda-preview-id]");
        if (!node) return;
        event.preventDefault();
        event.stopPropagation();
        const id = node.getAttribute("data-wda-preview-id");
        const extraction = this._htmlResult.elements?.[id];
        if (!extraction) return;
        this._selectedExtraction = extraction;
        this._selectedPreviewId = id;
        this._render();
      }, true);
      this._highlightSelection(doc);
    });
  }

  _highlightSelection(doc) {
    if (!this._selectedExtraction) return;
    let target = null;
    if (this._selectedPreviewId !== null) {
      target = doc.querySelector(`[data-wda-preview-id="${CSS.escape(String(this._selectedPreviewId))}"]`);
    } else {
      try {
        const nodes = doc.querySelectorAll(this._selectedExtraction.selector);
        target = nodes[Number(this._selectedExtraction.index || 0)] || null;
      } catch (_err) {
        target = null;
      }
    }
    if (target) {
      target.style.boxShadow = "0 0 0 3px #03a9f4 inset";
      target.scrollIntoView({ block:"center", behavior:"smooth" });
    }
  }

  _request() {
    const text = this._form.headers.trim();
    let headers = {};
    if (text) {
      try { headers = JSON.parse(text); }
      catch (_err) { throw new Error("Headers must be a valid JSON object."); }
      if (!headers || Array.isArray(headers) || typeof headers !== "object") throw new Error("Headers must be a JSON object.");
      headers = Object.fromEntries(Object.entries(headers).map(([key,value]) => [String(key),String(value)]));
    }
    return {
      url:this._form.url.trim(), method:this._form.method, headers,
      payload:this._form.payload || undefined, verify_ssl:this._form.verifySsl,
    };
  }

  async _loadSources() {
    if (!this._hass) return;
    try {
      const result = await this._hass.callWS({ type:"web_data_assistant/list_sources" });
      this._sources = result.sources || [];
      this._sourcesError = "";
    } catch (err) {
      this._sourcesError = err?.message || "Configured sources could not be loaded.";
    } finally {
      this._sourcesLoaded = true;
      this._render();
    }
  }

  async _refreshSource(entryId) {
    if (!this._hass || !entryId) return;
    this._refreshingSource = entryId;
    this._render();
    try {
      const updated = await this._hass.callWS({ type:"web_data_assistant/refresh_source", entry_id:entryId });
      this._sources = this._sources.map((source) => source.entry_id === entryId ? updated : source);
      this._sourcesError = "";
    } catch (err) {
      this._sourcesError = err?.message || "The source could not be refreshed.";
    } finally {
      this._refreshingSource = null;
      this._render();
    }
  }

  async _load() {
    if (!this._hass) return;
    if (!this._form.name.trim() || !this._form.url.trim()) {
      this._error = "Enter a source name and URL first.";
      this._status = "";
      this._render();
      return;
    }
    let request;
    try { request = this._request(); }
    catch (err) { this._error = err.message; this._status = ""; this._render(); return; }

    this._loading = true; this._error = ""; this._status = ""; this._render();
    try {
      if (this._sourceType === "json") {
        this._jsonResult = await this._hass.callWS({ type:"web_data_assistant/preview_json", ...request });
        this._htmlResult = null; this._selectedJson.clear(); this._jsonOverrides.clear();
        const count = this._jsonResult.values?.length || 0;
        this._status = this._jsonResult.truncated
          ? `Loaded the source. Showing the first ${count} selectable JSON values.`
          : `Loaded ${count} selectable JSON values.`;
      } else {
        this._htmlResult = await this._hass.callWS({ type:"web_data_assistant/preview_html", ...request });
        this._jsonResult = null; this._htmlMatches = []; this._selectedExtraction = null; this._selectedPreviewId = null;
        this._status = "Page loaded. Click a value or search for its current text.";
      }
    } catch (err) {
      this._error = err?.message || "The source could not be loaded.";
    } finally {
      this._loading = false; this._render();
    }
  }

  async _findText() {
    if (!this._hass || !this._htmlResult) return;
    const searchText = this._htmlSearchText.trim();
    if (!searchText) {
      this._error = "Enter the current text or value to find.";
      this._status = "";
      this._render();
      return;
    }
    let request;
    try { request = this._request(); }
    catch (err) { this._error = err.message; this._render(); return; }

    this._searching = true; this._error = ""; this._status = ""; this._render();
    try {
      const result = await this._hass.callWS({ type:"web_data_assistant/search_html", search_text:searchText, ...request });
      this._htmlMatches = result.matches || [];
      this._selectedExtraction = this._htmlMatches.length === 1 ? this._htmlMatches[0] : null;
      this._selectedPreviewId = null;
      this._status = this._htmlMatches.length
        ? `Found ${this._htmlMatches.length} specific match${this._htmlMatches.length === 1 ? "" : "es"}.`
        : "No matching page element was found for that text.";
    } catch (err) {
      this._error = err?.message || "The page could not be searched.";
    } finally {
      this._searching = false; this._render();
    }
  }

  _jsonMetadata(path, item = null) {
    if (!this._jsonOverrides.has(path)) {
      const candidate = item || (this._jsonResult?.values || []).find((entry) => entry.path === path);
      this._jsonOverrides.set(path, {
        name:this._friendly(candidate?.display_path || path || "root"),
        unit:"",
      });
    }
    return this._jsonOverrides.get(path);
  }

  _entities() {
    const sourceName = this._form.name.trim() || "Web data";
    if (this._sourceType === "scrape") {
      if (!this._selectedExtraction) return [];
      const entity = {
        key:this._slug(sourceName) || "web_value",
        name:sourceName,
        selector:this._selectedExtraction.selector,
        index:Number(this._selectedExtraction.index || 0),
        value_type:"text",
      };
      if (this._scrapeUnit.trim()) entity.unit = this._scrapeUnit.trim();
      return [entity];
    }
    if (this._jsonMode === "full") return [{ key:"full_response", name:sourceName, path:"", value_type:"json" }];

    const byPath = new Map((this._jsonResult?.values || []).map((item) => [item.path,item]));
    const used = new Set();
    return [...this._selectedJson].map((path) => {
      const item = byPath.get(path);
      const metadata = this._jsonMetadata(path,item);
      let key = this._slug(path.replaceAll("/","_")) || "root";
      const base = key; let suffix = 2;
      while (used.has(key)) key = `${base}_${suffix++}`;
      used.add(key);
      const entity = {
        key,
        name:metadata.name.trim() || this._friendly(item?.display_path || path || "root"),
        path,
        value_type:this._valueType(item?.value_type),
      };
      if (metadata.unit.trim()) entity.unit = metadata.unit.trim();
      return entity;
    });
  }

  async _save() {
    if (!this._hass || !this._canSave()) return;
    let request;
    try { request = this._request(); }
    catch (err) { this._error = err.message; this._render(); return; }

    const interval = Number(this._form.scanInterval || 5);
    const message = {
      type:"web_data_assistant/create_source",
      source_name:this._form.name.trim(), source_type:this._sourceType, entities:this._entities(),
      scan_interval:Number.isFinite(interval) ? Math.max(1,Math.min(1440,interval)) : 5,
      failure_mode:this._form.failureMode, ...request,
    };
    if (this._form.failureMode === "keep_last" && this._form.maxStale.trim()) {
      const stale = Number(this._form.maxStale);
      if (Number.isFinite(stale)) message.max_stale_minutes = Math.max(1,Math.min(525600,stale));
    }

    const createdName = this._form.name.trim();
    this._saving = true; this._error = ""; this._status = ""; this._render();
    try {
      await this._hass.callWS(message);
      this._resetResults();
      this._status = `Created ${createdName} successfully.`;
      await this._loadSources();
    } catch (err) {
      this._error = err?.message || "Home Assistant could not create the source.";
    } finally {
      this._saving = false; this._render();
    }
  }

  _resetResults() {
    this._jsonResult = null; this._selectedJson.clear(); this._jsonOverrides.clear(); this._jsonFilter = "";
    this._htmlResult = null; this._htmlMatches = []; this._htmlSearchText = ""; this._scrapeUnit = "";
    this._selectedExtraction = null; this._selectedPreviewId = null;
    this._error = ""; this._status = "";
  }

  _canSave() {
    if (!this._form.name.trim() || !this._form.url.trim()) return false;
    if (this._sourceType === "scrape") return Boolean(this._htmlResult && this._selectedExtraction);
    if (!this._jsonResult) return false;
    if (this._jsonMode === "full") return true;
    if (!this._selectedJson.size) return false;
    return [...this._selectedJson].every((path) => this._jsonMetadata(path).name.trim());
  }

  _refreshSave() {
    const button = this.shadowRoot.getElementById("save");
    if (button) button.disabled = !this._canSave() || this._saving;
  }

  _friendly(path) {
    let leaf = String(path).split(".").pop() || String(path);
    leaf = leaf.replace(/\[\d+\]$/, "").replace(/[_-]+/g," ").trim();
    return leaf ? leaf.replace(/\b\w/g,(char) => char.toUpperCase()) : "Web value";
  }

  _valueType(typeName) {
    if (typeName === "bool") return "boolean";
    if (typeName === "int" || typeName === "float") return "number";
    return "text";
  }

  _formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(undefined,{ dateStyle:"medium", timeStyle:"short" }).format(date);
  }

  _slug(value) {
    return String(value || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
  }

  _html(value) {
    return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
  }

  _attr(value) {
    return this._html(value).replaceAll("`","&#096;");
  }
}

if (!customElements.get("web-data-assistant-panel")) {
  customElements.define("web-data-assistant-panel", WebDataAssistantPanel);
}
