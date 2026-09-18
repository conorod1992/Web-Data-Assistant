const WebDataAssistantSetupUxPanel = customElements.get("web-data-assistant-panel");

if (WebDataAssistantSetupUxPanel && !WebDataAssistantSetupUxPanel.prototype.__setupUxInstalled) {
  const originalStyles = WebDataAssistantSetupUxPanel.prototype._styles;
  const originalRender = WebDataAssistantSetupUxPanel.prototype._render;
  const originalRequest = WebDataAssistantSetupUxPanel.prototype._request;

  WebDataAssistantSetupUxPanel.prototype._styles = function () {
    return originalStyles.call(this) + `
      .header-editor { grid-column:1/-1; display:flex; flex-direction:column; gap:10px; }
      .header-editor-title { font-size:13px; color:var(--secondary-text-color); }
      .header-editor-title strong { display:block; color:var(--primary-text-color); font-size:14px; margin-bottom:4px; }
      .header-row { display:grid; grid-template-columns:minmax(140px,.7fr) minmax(180px,1fr) auto; gap:8px; align-items:end; }
      .header-row button { min-width:88px; }
      .header-tools { display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
      .raw-headers { margin-top:0; padding-top:0; border-top:0; }
      .raw-headers textarea { margin-top:10px; }
      .ha-preview-list { display:flex; flex-direction:column; gap:10px; }
      .ha-preview-entity { padding:14px; border:1px solid var(--divider-color); border-radius:10px; background:var(--secondary-background-color); }
      .ha-preview-entity-head { display:flex; justify-content:space-between; gap:12px; align-items:start; }
      .ha-preview-state { display:grid; grid-template-columns:90px minmax(0,1fr); gap:8px; margin-top:10px; align-items:start; }
      .ha-preview-label { color:var(--secondary-text-color); font-size:12px; }
      .ha-preview-value { overflow-wrap:anywhere; }
      .ha-preview-attrs { margin-top:10px; padding-top:10px; border-top:1px solid var(--divider-color); }
      .ha-preview-attr { display:grid; grid-template-columns:minmax(100px,.45fr) minmax(0,1fr); gap:8px; padding:4px 0; }
      .ha-preview-policy { margin-top:10px; color:var(--secondary-text-color); font-size:12px; }
      @media(max-width:650px) {
        .header-row { grid-template-columns:1fr; }
        .header-row button { justify-self:start; }
      }
    `;
  };

  WebDataAssistantSetupUxPanel.prototype._ensureHeaderRows = function () {
    const source = String(this._form?.headers || "");
    if (Array.isArray(this._headerRows) && this._headerRowsSource === source) return;

    this._rawHeadersDraft = source;
    if (!source.trim()) {
      this._headerRows = [];
      this._headerRowsSource = source;
      return;
    }

    try {
      const parsed = JSON.parse(source);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
      this._headerRows = Object.entries(parsed).map(([name, value]) => ({
        name:String(name),
        value:String(value),
      }));
    } catch (_err) {
      this._headerRows = [];
    }
    this._headerRowsSource = source;
  };

  WebDataAssistantSetupUxPanel.prototype._headersFromRows = function () {
    this._ensureHeaderRows();
    const headers = {};
    const seen = new Set();

    for (const row of this._headerRows) {
      const name = String(row.name || "").trim();
      const value = String(row.value ?? "");
      if (!name && !value) continue;
      if (!name) throw new Error("Enter a header name or remove the incomplete row.");

      const normalised = name.toLowerCase();
      if (seen.has(normalised)) throw new Error("Header names must be unique.");
      seen.add(normalised);
      headers[name] = value;
    }
    return headers;
  };

  WebDataAssistantSetupUxPanel.prototype._syncHeadersFromRows = function () {
    const headers = this._headersFromRows();
    this._form.headers = Object.keys(headers).length ? JSON.stringify(headers) : "";
    this._headerRowsSource = this._form.headers;
    this._rawHeadersDraft = this._form.headers ? JSON.stringify(headers, null, 2) : "";
  };

  WebDataAssistantSetupUxPanel.prototype._headerEditorHtml = function () {
    this._ensureHeaderRows();
    const rows = this._headerRows.map((row, index) => {
      const nameField = this._field(
        "Header name " + (index + 1),
        '<input class="header-name" data-index="' + index + '" type="text" placeholder="e.g. Authorization" autocomplete="off" value="' + this._attr(row.name) + '">'
      );
      const valueField = this._field(
        "Header value " + (index + 1),
        '<input class="header-value" data-index="' + index + '" type="text" placeholder="e.g. Bearer …" autocomplete="off" spellcheck="false" value="' + this._attr(row.value) + '">'
      );
      return '<div class="header-row">' + nameField + valueField + '<button class="secondary remove-header" data-index="' + index + '" type="button">Remove</button></div>';
    }).join("");

    return '<div class="header-editor-title"><strong>Request headers</strong><span>Add only the headers this source needs. Names and values are sent with the Home Assistant request.</span></div>'
      + (rows || '<div class="hint">No custom headers.</div>')
      + '<div class="header-tools"><button id="add-header" class="secondary" type="button">Add header</button></div>'
      + '<details class="raw-headers"><summary>Raw headers JSON</summary>'
      + '<textarea id="raw-headers" aria-label="Raw headers JSON" placeholder=\'{"Authorization":"Bearer …"}\'>' + this._html(this._rawHeadersDraft || "") + '</textarea>'
      + '<div class="actions"><button id="apply-raw-headers" class="secondary" type="button">Apply JSON</button></div>'
      + '<p class="hint">For advanced use or pasting an existing headers object. Applying valid JSON replaces the rows above.</p></details>';
  };

  WebDataAssistantSetupUxPanel.prototype._jsonPreviewForPath = function (path) {
    const candidates = this._jsonResult?.values || [];
    const candidate = candidates.find((item) => item.path === path);
    if (candidate) return candidate.preview;

    const rootField = (this._jsonResult?.root_fields || []).find((item) => item.path === path);
    if (rootField) return rootField.preview;

    if (path === "" && this._jsonResult) return "Structured response";
    return "Current value unavailable in setup preview";
  };

  WebDataAssistantSetupUxPanel.prototype._scrapePreviewForEntity = function (entity) {
    const item = (this._scrapeSelections || []).find((candidate) =>
      candidate.selector === entity.selector
      && Number(candidate.index || 0) === Number(entity.index || 0)
    );
    if (!item) return "Current value will be read from the page";
    if (item.context === "Stored page value") return "Current value will be read from the page";
    return item.text || "Current value will be read from the page";
  };

  WebDataAssistantSetupUxPanel.prototype._longTextPolicyLabel = function (entity) {
    if (this._sourceType === "json" && entity.path === undefined && Object.keys(entity.attributes || {}).length) {
      return "Structured JSON values are stored as attributes, so Home Assistant's 255-character state limit does not apply to those attribute values.";
    }
    if (entity.value_type === "json") {
      return "The JSON document is stored as structured attributes rather than as a long Home Assistant state.";
    }
    const policy = entity.long_text_policy || this._form.longTextPolicy || "truncate";
    if (policy === "attribute_only") return "If longer than 255 characters: state becomes Loaded and the full value is kept in full_value.";
    if (policy === "unavailable") return "If longer than 255 characters: mark this sensor unavailable.";
    return "If longer than 255 characters: shorten the state and preserve the complete value in full_value.";
  };

  WebDataAssistantSetupUxPanel.prototype._previewStateForEntity = function (entity) {
    if (this._sourceType === "scrape") return this._scrapePreviewForEntity(entity);
    if (entity.value_type === "json" || entity.path === undefined) return "Loaded";
    return this._jsonPreviewForPath(entity.path);
  };

  WebDataAssistantSetupUxPanel.prototype._previewEntityHtml = function (entity) {
    const state = this._previewStateForEntity(entity);
    const attributes = Object.entries(entity.attributes || {});
    const visibleAttributes = attributes.slice(0, 12);
    const attributeRows = visibleAttributes.map(([name, path]) =>
      '<div class="ha-preview-attr"><code>' + this._html(name) + '</code><span class="ha-preview-value">' + this._html(this._jsonPreviewForPath(path)) + '</span></div>'
    ).join("");
    const more = attributes.length > visibleAttributes.length
      ? '<div class="hint">…and ' + (attributes.length - visibleAttributes.length) + ' more attribute' + (attributes.length - visibleAttributes.length === 1 ? '' : 's') + '.</div>'
      : "";
    const attributesHtml = attributes.length
      ? '<div class="ha-preview-attrs"><div class="ha-preview-label">' + attributes.length + ' attribute' + (attributes.length === 1 ? '' : 's') + '</div>' + attributeRows + more + '</div>'
      : "";

    return '<div class="ha-preview-entity">'
      + '<div class="ha-preview-entity-head"><div><strong>' + this._html(entity.name || "Web data sensor") + '</strong><div class="hint">Sensor</div></div>'
      + (entity.unit ? '<span class="hint">Unit: ' + this._html(entity.unit) + '</span>' : '') + '</div>'
      + '<div class="ha-preview-state"><span class="ha-preview-label">State</span><span class="ha-preview-value"><code>' + this._html(state) + '</code></span></div>'
      + attributesHtml
      + '<div class="ha-preview-policy">' + this._html(this._longTextPolicyLabel(entity)) + '</div>'
      + '<details><summary>Technical details</summary><p class="hint">Stable entity key: <code>' + this._html(entity.key || "") + '</code></p></details>'
      + '</div>';
  };

  WebDataAssistantSetupUxPanel.prototype._creationPreviewHtml = function () {
    if (this._repairMode) return "";
    let entities = [];
    try {
      entities = this._entities();
    } catch (_err) {
      return "";
    }
    if (!entities.length) return "";

    return '<section class="card ha-create-preview"><div class="heading"><div><h2>What Home Assistant will create</h2>'
      + '<p>This preview is built from the same entity definitions that will be sent when you save.</p></div></div>'
      + '<div class="ha-preview-list">' + entities.map((entity) => this._previewEntityHtml(entity)).join("") + '</div></section>';
  };

  WebDataAssistantSetupUxPanel.prototype._refreshCreationPreview = function () {
    const current = this.shadowRoot.querySelector(".ha-create-preview");
    const html = this._creationPreviewHtml();
    if (!html) {
      current?.remove();
      return;
    }

    const holder = document.createElement("div");
    holder.innerHTML = html;
    const replacement = holder.firstElementChild;
    if (!replacement) return;

    if (current) {
      current.replaceWith(replacement);
      return;
    }

    const save = this.shadowRoot.querySelector(".save-card");
    if (save) save.before(replacement);
  };

  WebDataAssistantSetupUxPanel.prototype._decorateHeaderEditor = function () {
    const textarea = this.shadowRoot.getElementById("headers");
    if (!textarea) return;
    const field = textarea.closest("label.field");
    if (!field) return;

    const editor = document.createElement("div");
    editor.className = "header-editor";
    editor.innerHTML = this._headerEditorHtml();
    field.replaceWith(editor);

    if (this._repairMode) {
      editor.querySelectorAll("input,textarea,button").forEach((element) => {
        element.disabled = true;
      });
    }
  };

  WebDataAssistantSetupUxPanel.prototype._bindCreationPreview = function () {
    const selectors = [
      "#name",
      ".json-name",
      ".json-unit",
      ".json-long-text",
      ".json-attribute-name",
      ".json-state",
      "#aggregate-unit",
      "#aggregate-long-text",
      ".scrape-added-name",
      ".scrape-added-unit",
      ".scrape-added-long-text",
      "#long-text-policy",
    ].join(",");

    this.shadowRoot.querySelectorAll(selectors).forEach((element) => {
      const eventName = element.tagName === "SELECT" || element.type === "radio" ? "change" : "input";
      element.addEventListener(eventName, () => {
        queueMicrotask(() => this._refreshCreationPreview());
      });
    });
  };

  WebDataAssistantSetupUxPanel.prototype._bindHeaderEditor = function () {
    this.shadowRoot.querySelectorAll(".header-name").forEach((input) => {
      input.addEventListener("input", (event) => {
        const row = this._headerRows[Number(event.target.dataset.index)];
        if (!row) return;
        row.name = event.target.value;
        try {
          this._syncHeadersFromRows();
          this._error = "";
        } catch (err) {
          this._error = err.message;
        }
      });
    });

    this.shadowRoot.querySelectorAll(".header-value").forEach((input) => {
      input.addEventListener("input", (event) => {
        const row = this._headerRows[Number(event.target.dataset.index)];
        if (!row) return;
        row.value = event.target.value;
        try {
          this._syncHeadersFromRows();
          this._error = "";
        } catch (err) {
          this._error = err.message;
        }
      });
    });

    this.shadowRoot.querySelectorAll(".remove-header").forEach((button) => {
      button.addEventListener("click", () => {
        this._headerRows.splice(Number(button.dataset.index), 1);
        this._syncHeadersFromRows();
        this._render();
      });
    });

    this.shadowRoot.getElementById("add-header")?.addEventListener("click", () => {
      this._ensureHeaderRows();
      this._headerRows.push({ name:"", value:"" });
      this._render();
    });

    this.shadowRoot.getElementById("raw-headers")?.addEventListener("input", (event) => {
      this._rawHeadersDraft = event.target.value;
    });

    this.shadowRoot.getElementById("apply-raw-headers")?.addEventListener("click", () => {
      const text = String(this._rawHeadersDraft || "").trim();
      if (!text) {
        this._headerRows = [];
        this._form.headers = "";
        this._headerRowsSource = "";
        this._error = "";
        this._render();
        return;
      }

      try {
        const parsed = JSON.parse(text);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
          throw new Error("Headers must be a JSON object.");
        }
        this._headerRows = Object.entries(parsed).map(([name, value]) => ({
          name:String(name),
          value:String(value),
        }));
        this._headerRowsSource = this._form.headers;
        this._syncHeadersFromRows();
        this._error = "";
        this._render();
      } catch (err) {
        this._error = err.message === "Headers must be a JSON object."
          ? err.message
          : "Headers must be a valid JSON object.";
        this._render();
      }
    });
  };

  WebDataAssistantSetupUxPanel.prototype._render = function () {
    const existingEditor = this.shadowRoot?.querySelector(".header-editor");
    const existingTextarea = this.shadowRoot?.getElementById("headers");
    const advancedWasOpen = Boolean(
      existingEditor?.closest("details")?.open
      || existingTextarea?.closest("details")?.open
    );
    const rawWasOpen = Boolean(this.shadowRoot?.querySelector(".raw-headers")?.open);

    originalRender.call(this);

    const newTextarea = this.shadowRoot?.getElementById("headers");
    const advanced = newTextarea?.closest("details");
    if (advanced && advancedWasOpen) advanced.open = true;

    this._decorateHeaderEditor();
    const raw = this.shadowRoot?.querySelector(".raw-headers");
    if (raw && rawWasOpen) raw.open = true;
    this._bindHeaderEditor();
    this._refreshCreationPreview();
    this._bindCreationPreview();
  };

  WebDataAssistantSetupUxPanel.prototype._request = function () {
    const headers = this._headersFromRows();
    this._form.headers = Object.keys(headers).length ? JSON.stringify(headers) : "";
    this._headerRowsSource = this._form.headers;
    return {
      url:this._form.url.trim(),
      method:this._form.method,
      headers,
      payload:this._form.payload || undefined,
      verify_ssl:this._form.verifySsl,
    };
  };

  WebDataAssistantSetupUxPanel.prototype.__setupUxInstalled = true;
}
