const WebDataAssistantPanel = customElements.get("web-data-assistant-panel");

if (WebDataAssistantPanel && !WebDataAssistantPanel.prototype.__sourceRepairInstalled) {
  const originalStyles = WebDataAssistantPanel.prototype._styles;
  const originalBind = WebDataAssistantPanel.prototype._bind;
  const originalRenderJson = WebDataAssistantPanel.prototype._renderJson;
  const originalRenderScrape = WebDataAssistantPanel.prototype._renderScrape;
  const originalRenderBehaviour = WebDataAssistantPanel.prototype._renderBehaviour;
  const originalRenderSave = WebDataAssistantPanel.prototype._renderSave;

  WebDataAssistantPanel.prototype._styles = function () {
    return `${originalStyles.call(this)}
      .repair-options { display:flex; flex-direction:column; gap:8px; margin-top:12px; }
      .repair-option { display:grid; grid-template-columns:28px minmax(0,1fr) minmax(100px,.5fr); gap:10px; align-items:center; padding:11px 12px; border:1px solid var(--divider-color); border-radius:8px; cursor:pointer; }
      .repair-option:hover { background:var(--secondary-background-color); }
      .repair-option input { width:auto; min-height:auto; }
      .repair-current { margin:10px 0 0; color:var(--secondary-text-color); font-size:13px; }
      .repair-banner { margin-bottom:14px; padding:12px 14px; border-radius:8px; background:color-mix(in srgb,var(--warning-color,#ff9800) 8%,transparent); }
    `;
  };

  WebDataAssistantPanel.prototype._repairRequestForm = function (config) {
    return {
      name:String(config.source_name || ""),
      url:String(config.url || ""),
      method:String(config.method || "GET"),
      headers:config.headers && Object.keys(config.headers).length ? JSON.stringify(config.headers, null, 2) : "",
      payload:config.payload || "",
      verifySsl:config.verify_ssl !== false,
      scanInterval:String(config.scan_interval || 5),
      failureMode:config.failure_mode || "unavailable",
      maxStale:config.max_stale_minutes ? String(config.max_stale_minutes) : "",
      longTextPolicy:config.long_text_policy || "truncate",
    };
  };

  WebDataAssistantPanel.prototype._renderJson = function () {
    if (!this._repairMode) return originalRenderJson.call(this);
    const values = this._jsonResult?.values || [];
    const query = String(this._repairJsonFilter || "").trim().toLowerCase();
    const visible = query
      ? values.filter((item) => `${item.display_path} ${item.preview}`.toLowerCase().includes(query))
      : values;
    const options = visible.map((item) => `<label class="repair-option"><input type="radio" name="repair-json-path" class="repair-json-path" value="${this._attr(item.path)}" ${this._repairJsonPath === item.path ? "checked" : ""}><span><strong>${this._html(item.display_path || item.path || "(root)")}</strong></span><span class="json-value" title="${this._attr(item.preview)}">${this._html(item.preview)}</span></label>`).join("");
    return `<section class="card"><div class="heading"><div><h2>2. Choose the replacement value</h2><p>Select the JSON value that should now power <strong>${this._html(this._repairMode.name)}</strong>. Its Home Assistant entity identity will not change.</p></div></div><div class="repair-banner">Current stored path: <code>${this._html(this._repairMode.entity.path || "(none)")}</code></div><input id="repair-json-filter" type="search" placeholder="Filter paths or current values…" value="${this._attr(this._repairJsonFilter || "")}"><div class="repair-options">${options || '<div class="hint">No JSON values match this filter.</div>'}</div></section>`;
  };

  WebDataAssistantPanel.prototype._renderScrape = function () {
    if (!this._repairMode) return originalRenderScrape.call(this);
    const matches = (this._repairHtmlMatches || []).map((match,index) => `<div class="match ${this._repairSelectedMatch === match ? "selected" : ""}" data-repair-match="${index}"><div><strong>${this._html(match.text || "(No text)")}</strong></div>${match.context && match.context !== match.text ? `<div class="match-context">${this._html(match.context)}</div>` : ""}<div class="match-context">&lt;${this._html(match.tag || "element")}&gt;</div></div>`).join("");
    const selected = this._repairSelectedMatch;
    return `<section class="card"><div class="heading"><div><h2>2. Find the replacement value</h2><p>Open the page separately if helpful, then enter text currently shown for <strong>${this._html(this._repairMode.name)}</strong>. Choose the correct contextual match.</p></div></div><div class="repair-banner">The existing selector no longer extracts this sensor reliably. Repair changes only this sensor's selector/index.</div><div class="search-row">${this._field("Current text or value",`<input id="repair-html-search" type="search" placeholder="e.g. 14.6 °C" value="${this._attr(this._repairHtmlSearchText || "")}">`)}<button id="repair-find-text" class="primary" ${this._repairSearching ? "disabled" : ""}>${this._repairSearching ? "Finding…" : "Find matches"}</button></div>${this._repairHtmlStatus ? `<div class="notice ${this._repairHtmlMatches?.length ? "success" : "error"}">${this._html(this._repairHtmlStatus)}</div>` : ""}${matches ? `<div class="matches">${matches}</div>` : ""}${selected ? `<div class="selected"><h3>Replacement selected</h3><p>${this._html(selected.text || "(No text)")}</p><details><summary>Technical details</summary><p class="hint">Selector: <code>${this._html(selected.selector)}</code><br>Match index: ${Number(selected.index || 0)}</p></details></div>` : ""}</section>`;
  };

  WebDataAssistantPanel.prototype._renderBehaviour = function () {
    if (this._repairMode) return "";
    return originalRenderBehaviour.call(this);
  };

  WebDataAssistantPanel.prototype._renderSave = function () {
    if (!this._repairMode) return originalRenderSave.call(this);
    const ready = this._repairMode.sourceType === "json"
      ? this._repairJsonPath !== null
      : Boolean(this._repairSelectedMatch);
    return `<section class="card save-card"><div class="heading" style="margin:0;align-items:center;"><div><h2 style="margin-bottom:4px;">Repair ${this._html(this._repairMode.name)}</h2><p style="margin:0;">Only this extraction is changed. The entity key and Home Assistant identity stay the same.</p></div><div class="actions" style="margin-top:0;"><button id="cancel-repair" class="secondary" ${this._repairSaving ? "disabled" : ""}>Cancel</button><button id="apply-repair" class="primary" ${!ready || this._repairSaving ? "disabled" : ""}>${this._repairSaving ? "Repairing…" : "Apply repair"}</button></div></div></section>`;
  };

  WebDataAssistantPanel.prototype._bind = function () {
    originalBind.call(this);

    this.shadowRoot.querySelectorAll(".repair-entity").forEach((button) => {
      button.addEventListener("click", () => this._openRepair(button.dataset.entryId, button.dataset.entityKey));
    });
    this.shadowRoot.getElementById("cancel-repair")?.addEventListener("click", () => this._cancelRepair());
    this.shadowRoot.getElementById("apply-repair")?.addEventListener("click", () => this._applyRepair());
    this.shadowRoot.getElementById("repair-json-filter")?.addEventListener("input", (event) => {
      this._repairJsonFilter = event.target.value;
      this._render();
    });
    this.shadowRoot.querySelectorAll(".repair-json-path").forEach((radio) => {
      radio.addEventListener("change", (event) => {
        if (event.target.checked) {
          this._repairJsonPath = event.target.value;
          this._render();
        }
      });
    });
    this.shadowRoot.getElementById("repair-html-search")?.addEventListener("input", (event) => {
      this._repairHtmlSearchText = event.target.value;
    });
    this.shadowRoot.getElementById("repair-find-text")?.addEventListener("click", () => this._findRepairText());
    this.shadowRoot.querySelectorAll("[data-repair-match]").forEach((element) => {
      element.addEventListener("click", () => {
        this._repairSelectedMatch = (this._repairHtmlMatches || [])[Number(element.dataset.repairMatch)];
        this._render();
      });
    });

    if (this._repairMode) {
      ["name","url","method","headers","payload","verify-ssl"].forEach((id) => {
        const element = this.shadowRoot.getElementById(id);
        if (element) element.disabled = true;
      });
      this.shadowRoot.querySelectorAll("[data-source]").forEach((button) => {
        button.disabled = true;
      });
    }
  };

  WebDataAssistantPanel.prototype._openRepair = async function (entryId, entityKey) {
    if (!this._hass || !entryId || !entityKey || this._repairLoading || this._repairSaving) return;
    this._repairLoading = `${entryId}:${entityKey}`;
    this._sourcesError = "";
    this._render();
    try {
      const config = await this._hass.callWS({
        type:"web_data_assistant/get_source",
        entry_id:entryId,
      });
      const entity = (config.entities || []).find((item) => String(item.key) === String(entityKey));
      if (!entity) throw new Error("The affected sensor could not be found.");

      this._resetResults();
      this._sourceType = config.source_type;
      this._form = this._repairRequestForm(config);
      this._repairMode = {
        entryId,
        entityKey,
        name:entity.name || entityKey,
        sourceType:config.source_type,
        entity:structuredClone(entity),
      };
      this._repairJsonPath = null;
      this._repairJsonFilter = "";
      this._repairHtmlSearchText = "";
      this._repairHtmlMatches = [];
      this._repairSelectedMatch = null;
      this._repairHtmlStatus = "";

      if (config.source_type === "json") {
        const request = {
          type:"web_data_assistant/preview_json",
          url:config.url,
          method:config.method || "GET",
          headers:config.headers || {},
          verify_ssl:config.verify_ssl !== false,
        };
        if (config.payload) request.payload = config.payload;
        this._jsonResult = await this._hass.callWS(request);
      }
    } catch (err) {
      this._sourcesError = err?.message || "The sensor could not be opened for repair.";
      this._repairMode = null;
    } finally {
      this._repairLoading = null;
      this._render();
    }
  };

  WebDataAssistantPanel.prototype._findRepairText = async function () {
    if (!this._hass || !this._repairMode || this._repairMode.sourceType !== "scrape") return;
    const searchText = String(this._repairHtmlSearchText || "").trim();
    if (!searchText) {
      this._repairHtmlStatus = "Enter the current text or value to find.";
      this._repairHtmlMatches = [];
      this._repairSelectedMatch = null;
      this._render();
      return;
    }

    let request;
    try {
      request = this._request();
    } catch (err) {
      this._repairHtmlStatus = err.message;
      this._render();
      return;
    }

    this._repairSearching = true;
    this._repairHtmlStatus = "";
    this._render();
    try {
      const result = await this._hass.callWS({
        type:"web_data_assistant/search_html",
        search_text:searchText,
        ...request,
      });
      this._repairHtmlMatches = result.matches || [];
      this._repairSelectedMatch = this._repairHtmlMatches.length === 1 ? this._repairHtmlMatches[0] : null;
      this._repairHtmlStatus = this._repairHtmlMatches.length
        ? `Found ${this._repairHtmlMatches.length} specific match${this._repairHtmlMatches.length === 1 ? "" : "es"}.`
        : "That text was not found in the page response.";
    } catch (err) {
      this._repairHtmlMatches = [];
      this._repairSelectedMatch = null;
      this._repairHtmlStatus = err?.message || "The page could not be searched.";
    } finally {
      this._repairSearching = false;
      this._render();
    }
  };

  WebDataAssistantPanel.prototype._applyRepair = async function () {
    if (!this._hass || !this._repairMode || this._repairSaving) return;
    const message = {
      type:"web_data_assistant/repair_entity",
      entry_id:this._repairMode.entryId,
      entity_key:this._repairMode.entityKey,
    };
    if (this._repairMode.sourceType === "json") {
      if (this._repairJsonPath === null) return;
      message.path = this._repairJsonPath;
    } else {
      if (!this._repairSelectedMatch) return;
      message.selector = this._repairSelectedMatch.selector;
      message.index = Number(this._repairSelectedMatch.index || 0);
    }

    const name = this._repairMode.name;
    this._repairSaving = true;
    this._error = "";
    this._render();
    try {
      const result = await this._hass.callWS(message);
      if (result.source) {
        this._sources = this._sources.map((source) =>
          source.entry_id === result.source.entry_id ? result.source : source
        );
      }
      this._repairMode = null;
      this._repairJsonPath = null;
      this._repairSelectedMatch = null;
      if (typeof this._resetLifecycleForm === "function") this._resetLifecycleForm();
      else this._resetResults();
      this._status = `Repaired ${name} successfully.`;
    } catch (err) {
      this._error = err?.message || "Home Assistant could not repair this sensor.";
    } finally {
      this._repairSaving = false;
      this._render();
    }
  };

  WebDataAssistantPanel.prototype._cancelRepair = function () {
    this._repairMode = null;
    this._repairJsonPath = "";
    this._repairJsonFilter = "";
    this._repairHtmlSearchText = "";
    this._repairHtmlMatches = [];
    this._repairSelectedMatch = null;
    this._repairHtmlStatus = "";
    if (typeof this._resetLifecycleForm === "function") this._resetLifecycleForm();
    else this._resetResults();
    this._render();
  };

  WebDataAssistantPanel.prototype.__sourceRepairInstalled = true;
}
