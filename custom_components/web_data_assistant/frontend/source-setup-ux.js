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
        this._headerRowsSource = null;
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
