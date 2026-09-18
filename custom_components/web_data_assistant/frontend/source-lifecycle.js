const WebDataAssistantLifecyclePanel = customElements.get("web-data-assistant-panel");

if (WebDataAssistantLifecyclePanel && !WebDataAssistantLifecyclePanel.prototype.__sourceLifecycleInstalled) {
  const originalStyles = WebDataAssistantLifecyclePanel.prototype._styles;
  const originalBind = WebDataAssistantLifecyclePanel.prototype._bind;
  const originalRenderSave = WebDataAssistantLifecyclePanel.prototype._renderSave;
  const originalSave = WebDataAssistantLifecyclePanel.prototype._save;
  const originalEntities = WebDataAssistantLifecyclePanel.prototype._entities;
  const originalCanSave = WebDataAssistantLifecyclePanel.prototype._canSave;

  WebDataAssistantLifecyclePanel.prototype._styles = function () {
    return `${originalStyles.call(this)}
      .danger { border-color:color-mix(in srgb,var(--error-color,#db4437) 45%,var(--divider-color)); color:var(--error-color,#db4437); }
      .delete-confirm { margin-top:12px; padding:12px; border:1px solid color-mix(in srgb,var(--error-color,#db4437) 35%,var(--divider-color)); border-radius:8px; background:color-mix(in srgb,var(--error-color,#db4437) 7%,transparent); }
      .delete-confirm p { margin:0; }
      .editing-note { margin-top:8px; color:var(--primary-color); font-size:13px; }
      .repair-issues { display:flex; flex-direction:column; gap:8px; margin-top:12px; }
      .repair-issue { padding:10px 12px; border:1px solid color-mix(in srgb,var(--warning-color,#ff9800) 35%,var(--divider-color)); border-radius:8px; background:color-mix(in srgb,var(--warning-color,#ff9800) 6%,transparent); }
      .repair-issue-head { display:flex; justify-content:space-between; gap:12px; align-items:center; }
      .repair-issue details { margin-top:8px; padding-top:8px; font-size:12px; }
    `;
  };

  WebDataAssistantLifecyclePanel.prototype._renderSources = function () {
    if (!this._sourcesLoaded) return `<section class="card"><h2>Configured sources</h2><p class="hint">Loading configured sources…</p></section>`;
    if (this._sourcesError && !this._sources.length) return `<section class="card"><h2>Configured sources</h2><div class="notice error">${this._html(this._sourcesError)}</div></section>`;
    if (!this._sources.length) return `<section class="card"><h2>Configured sources</h2><p class="hint">No Web Data Assistant sources have been created yet.</p></section>`;

    const cards = this._sources.map((source) => {
      const health = this._sourceHealth(source);
      const lastSuccess = source.last_successful_update ? this._formatDate(source.last_successful_update) : "Never";
      const type = source.source_type === "json" ? "JSON / API" : "Web page";
      const retaining = source.failure_mode === "keep_last" ? "Keep last value" : "Unavailable on failure";
      const extractionErrors = Number(source.extraction_error_count || 0);
      const extractionIssues = Array.isArray(source.extraction_issues) ? source.extraction_issues : [];
      const repairIssues = extractionIssues.length ? `<div class="repair-issues">${extractionIssues.map((issue) => `<div class="repair-issue"><div class="repair-issue-head"><div><strong>${this._html(issue.name || issue.key || "Sensor")}</strong><div class="hint">This sensor's selected value could not be extracted.</div></div>${issue.repairable ? `<button class="secondary repair-entity" data-entry-id="${this._attr(source.entry_id)}" data-entity-key="${this._attr(issue.key)}" ${this._repairLoading || this._repairSaving ? "disabled" : ""}>Repair</button>` : `<button class="secondary edit-source" data-entry-id="${this._attr(source.entry_id)}">Use Edit</button>`}</div><details><summary>Technical details</summary><code>${this._html(issue.error || "Extraction failed")}</code></details></div>`).join("")}</div>` : "";
      const confirmingDelete = this._deleteConfirmEntryId === source.entry_id;
      const deleting = this._deletingSource === source.entry_id;
      const loadingEdit = this._loadingEditableSource === source.entry_id;
      const editing = this._editingEntryId === source.entry_id;
      const confirm = confirmingDelete ? `<div class="delete-confirm"><p><strong>Delete ${this._html(source.title)}?</strong></p><p class="hint">This removes the source and its Home Assistant sensor entities. This cannot be undone.</p><div class="actions"><button class="secondary cancel-delete" data-entry-id="${this._attr(source.entry_id)}" ${deleting ? "disabled" : ""}>Cancel</button><button class="secondary danger confirm-delete" data-entry-id="${this._attr(source.entry_id)}" ${deleting ? "disabled" : ""}>${deleting ? "Deleting…" : "Delete source"}</button></div></div>` : "";
      return `<div class="source-card"><div class="source-card-head"><div><div class="source-title">${this._html(source.title)}</div><div class="source-url">${this._html(source.url || "")}</div>${editing ? `<div class="editing-note">Editing now</div>` : ""}</div><span class="health ${health.className}"><span class="health-dot"></span>${this._html(health.label)}</span></div><div class="source-meta"><span>${this._html(type)}</span><span>${Number(source.entity_count || 0)} sensor${Number(source.entity_count || 0) === 1 ? "" : "s"}</span><span>Every ${Number(source.scan_interval || 5)} min</span><span>${this._html(retaining)}</span><span>Last success: ${this._html(lastSuccess)}</span>${extractionErrors ? `<span>${extractionErrors} extraction issue${extractionErrors === 1 ? "" : "s"}</span>` : ""}</div>${repairIssues}<div class="actions"><button class="secondary refresh-source" data-entry-id="${this._attr(source.entry_id)}" ${this._refreshingSource === source.entry_id || source.state !== "loaded" || deleting || loadingEdit ? "disabled" : ""}>${this._refreshingSource === source.entry_id ? "Refreshing…" : "Refresh now"}</button><button class="secondary edit-source" data-entry-id="${this._attr(source.entry_id)}" ${deleting || loadingEdit ? "disabled" : ""}>${loadingEdit ? "Opening…" : editing ? "Editing" : "Edit"}</button><button class="secondary duplicate-source" data-entry-id="${this._attr(source.entry_id)}" ${deleting || loadingEdit ? "disabled" : ""}>Duplicate</button><button class="secondary danger request-delete" data-entry-id="${this._attr(source.entry_id)}" ${deleting || loadingEdit ? "disabled" : ""}>Delete</button></div>${confirm}</div>`;
    }).join("");

    const sourceError = this._sourcesError ? `<div class="notice error" style="margin-bottom:12px;">${this._html(this._sourcesError)}</div>` : "";
    return `<section class="card"><div class="heading"><div><h2>Configured sources</h2><p>Current source health is shown without exposing request credentials or retrieved values.</p></div></div>${sourceError}<div class="source-list">${cards}</div></section>`;
  };

  WebDataAssistantLifecyclePanel.prototype._renderSave = function () {
    if (this._editingEntryId) {
      return `<section class="card save-card"><div class="heading" style="margin:0;align-items:center;"><div><h2 style="margin-bottom:4px;">Edit source</h2><p style="margin:0;">Save changes to the existing source. Sensors with unchanged keys keep their Home Assistant identity.</p></div><div class="actions" style="margin-top:0;"><button id="cancel-edit" class="secondary" ${this._saving ? "disabled" : ""}>Cancel edit</button><button id="save" class="primary" ${!this._canSave() || this._saving ? "disabled" : ""}>${this._saving ? "Saving…" : "Save changes"}</button></div></div></section>`;
    }
    if (this._duplicateMode) {
      return `<section class="card save-card"><div class="heading" style="margin:0;align-items:center;"><div><h2 style="margin-bottom:4px;">Duplicate source</h2><p style="margin:0;">Review the copied configuration, choose a new name if needed, then create it as a separate Home Assistant source.</p></div><div class="actions" style="margin-top:0;"><button id="cancel-duplicate" class="secondary" ${this._saving ? "disabled" : ""}>Cancel</button><button id="save" class="primary" ${!this._canSave() || this._saving ? "disabled" : ""}>${this._saving ? "Creating…" : "Create copy"}</button></div></div></section>`;
    }
    return originalRenderSave.call(this);
  };

  WebDataAssistantLifecyclePanel.prototype._bind = function () {
    originalBind.call(this);
    this.shadowRoot.querySelectorAll(".edit-source").forEach((button) => button.addEventListener("click", () => this._editSource(button.dataset.entryId)));
    this.shadowRoot.querySelectorAll(".duplicate-source").forEach((button) => button.addEventListener("click", () => this._duplicateSource(button.dataset.entryId)));
    this.shadowRoot.getElementById("cancel-edit")?.addEventListener("click", () => this._cancelLifecycleEditor());
    this.shadowRoot.getElementById("cancel-duplicate")?.addEventListener("click", () => this._cancelLifecycleEditor());
    this.shadowRoot.querySelectorAll(".request-delete").forEach((button) => button.addEventListener("click", () => {
      this._deleteConfirmEntryId = button.dataset.entryId;
      this._sourcesError = "";
      this._render();
    }));
    this.shadowRoot.querySelectorAll(".cancel-delete").forEach((button) => button.addEventListener("click", () => {
      if (this._deleteConfirmEntryId === button.dataset.entryId) this._deleteConfirmEntryId = null;
      this._render();
    }));
    this.shadowRoot.querySelectorAll(".confirm-delete").forEach((button) => button.addEventListener("click", () => this._deleteSource(button.dataset.entryId)));
  };

  WebDataAssistantLifecyclePanel.prototype._populateEditableSource = async function (config, mode = "edit") {
    this._resetResults();
    this._editingEntryId = mode === "edit" ? config.entry_id : null;
    this._duplicateMode = mode === "duplicate";
    this._editingOriginalEntities = structuredClone(config.entities || []);
    this._editingPreserveEntitiesOnly = false;
    this._sourceType = config.source_type || "json";
    this._form = {
      name: mode === "duplicate" ? `${String(config.source_name || "Web data")} copy` : String(config.source_name || ""),
      url: String(config.url || ""),
      method: String(config.method || "GET"),
      headers: config.headers && Object.keys(config.headers).length ? JSON.stringify(config.headers, null, 2) : "",
      payload: config.payload || "",
      verifySsl: config.verify_ssl !== false,
      scanInterval: String(config.scan_interval || 5),
      failureMode: config.failure_mode || "unavailable",
      maxStale: config.max_stale_minutes ? String(config.max_stale_minutes) : "",
      longTextPolicy: config.long_text_policy || "truncate",
    };

    if (this._sourceType === "scrape") {
      if (Array.isArray(this._scrapeSelections)) {
        this._scrapeSelections = this._editingOriginalEntities.map((entity) => ({
          selector: entity.selector,
          index: Number(entity.index || 0),
          text: entity.name || "Existing selected value",
          context: "Stored page value",
          name: entity.name || "Web value",
          unit: entity.unit || "",
          longTextPolicy: entity.long_text_policy || "",
        }));
        this._selectedExtraction = null;
        return;
      }

      const entity = this._editingOriginalEntities[0];
      if (entity) {
        this._selectedExtraction = {
          selector: entity.selector,
          index: Number(entity.index || 0),
          text: "Existing selected value",
          context: "The stored selector will continue to be used unless you search for a replacement.",
          tag: "element",
        };
        this._scrapeUnit = entity.unit || "";
        this._scrapeLongTextPolicy = entity.long_text_policy || "";
      }
      return;
    }

    const request = {
      type:"web_data_assistant/preview_json",
      url:this._form.url,
      method:this._form.method,
      headers:config.headers || {},
      verify_ssl:this._form.verifySsl,
    };
    if (this._form.payload) request.payload = this._form.payload;
    this._jsonResult = await this._hass.callWS(request);

    const entities = this._editingOriginalEntities;
    if (entities.length === 1 && entities[0].attributes && Object.keys(entities[0].attributes).length) {
      const entity = entities[0];
      const rootFields = this._jsonResult?.root_fields || [];
      const storedAttributePaths = Object.values(entity.attributes);
      const rootFieldPaths = rootFields.map((field) => field.path);
      const isStructuredRootImport = !entity.path && (
        (
          rootFieldPaths.length > 0
          && storedAttributePaths.length === rootFieldPaths.length
          && storedAttributePaths.every((path) => rootFieldPaths.includes(path))
        )
        || (
          rootFieldPaths.length === 0
          && Object.keys(entity.attributes).length === 1
          && entity.attributes.items === ""
        )
      );
      if (isStructuredRootImport) {
        this._jsonMode = "object";
        return;
      }

      this._jsonMode = "aggregate";
      this._jsonStatePath = entity.path || "";
      this._aggregateUnit = entity.unit || "";
      this._aggregateLongTextPolicy = entity.long_text_policy || "";
      if (entity.path) this._selectedJson.add(entity.path);
      Object.entries(entity.attributes).forEach(([name, path]) => {
        this._selectedJson.add(path);
        const metadata = this._jsonMetadata(path);
        metadata.attributeName = name;
      });
      return;
    }

    const editableEntities = entities.filter((entity) => entity.path !== undefined && entity.value_type !== "json");
    if (editableEntities.length === entities.length && entities.length) {
      this._jsonMode = "values";
      editableEntities.forEach((entity) => {
        this._selectedJson.add(entity.path);
        const metadata = this._jsonMetadata(entity.path);
        metadata.name = entity.name || metadata.name;
        metadata.unit = entity.unit || "";
        metadata.longTextPolicy = entity.long_text_policy || "";
      });
      return;
    }

    this._editingPreserveEntitiesOnly = true;
    this._status = "This legacy JSON extraction can keep its existing sensor definition while you edit the request and refresh settings.";
  };

  WebDataAssistantLifecyclePanel.prototype._openLifecycleSource = async function (entryId, mode) {
    if (!this._hass || !entryId || this._loadingEditableSource || this._saving) return;
    this._loadingEditableSource = entryId;
    this._sourcesError = "";
    this._render();
    try {
      const config = await this._hass.callWS({ type:"web_data_assistant/get_source", entry_id:entryId });
      await this._populateEditableSource(config, mode);
    } catch (err) {
      this._sourcesError = err?.message || `The source could not be opened for ${mode === "duplicate" ? "duplication" : "editing"}.`;
      this._editingEntryId = null;
      this._duplicateMode = false;
    } finally {
      this._loadingEditableSource = null;
      this._render();
    }
  };

  WebDataAssistantLifecyclePanel.prototype._editSource = function (entryId) {
    return this._openLifecycleSource(entryId, "edit");
  };

  WebDataAssistantLifecyclePanel.prototype._duplicateSource = function (entryId) {
    return this._openLifecycleSource(entryId, "duplicate");
  };

  WebDataAssistantLifecyclePanel.prototype._cancelLifecycleEditor = function () {
    this._editingEntryId = null;
    this._duplicateMode = false;
    this._editingOriginalEntities = [];
    this._editingPreserveEntitiesOnly = false;
    this._resetLifecycleForm();
    this._render();
  };

  WebDataAssistantLifecyclePanel.prototype._resetLifecycleForm = function () {
    this._sourceType = "json";
    this._form = {
      name:"",
      url:"",
      method:"GET",
      headers:"",
      payload:"",
      verifySsl:true,
      scanInterval:"5",
      failureMode:"unavailable",
      maxStale:"",
      longTextPolicy:"truncate",
    };
    this._resetResults();
  };

  WebDataAssistantLifecyclePanel.prototype._entities = function () {
    if (this._editingPreserveEntitiesOnly && this._editingOriginalEntities?.length) {
      return structuredClone(this._editingOriginalEntities);
    }

    const built = originalEntities.call(this);
    if ((!this._editingEntryId && !this._duplicateMode) || !this._editingOriginalEntities?.length) return built;

    if (this._sourceType === "scrape") {
      const originalByExtraction = new Map(
        this._editingOriginalEntities.map((entity) => [
          `${entity.selector || ""}::${Number(entity.index || 0)}`,
          entity,
        ])
      );
      built.forEach((entity) => {
        const original = originalByExtraction.get(
          `${entity.selector || ""}::${Number(entity.index || 0)}`
        );
        if (original?.key) entity.key = original.key;
      });
      return built;
    }

    if (this._jsonMode === "aggregate" || this._jsonMode === "object") {
      if (built[0] && this._editingOriginalEntities[0]?.key) built[0].key = this._editingOriginalEntities[0].key;
      return built;
    }

    const originalByPath = new Map(
      this._editingOriginalEntities
        .filter((entity) => entity.path !== undefined)
        .map((entity) => [entity.path, entity])
    );
    built.forEach((entity) => {
      const original = originalByPath.get(entity.path);
      if (original?.key) entity.key = original.key;
    });
    return built;
  };

  WebDataAssistantLifecyclePanel.prototype._canSave = function () {
    if (this._editingPreserveEntitiesOnly) return Boolean(this._form.name.trim() && this._form.url.trim() && this._editingOriginalEntities?.length);
    return originalCanSave.call(this);
  };

  WebDataAssistantLifecyclePanel.prototype._lifecycleMessage = function (type, entryId = null) {
    const request = this._request();
    const interval = Number(this._form.scanInterval || 5);
    const message = {
      type,
      source_name:this._form.name.trim(),
      source_type:this._sourceType,
      entities:this._entities(),
      scan_interval:Number.isFinite(interval) ? Math.max(1, Math.min(1440, interval)) : 5,
      failure_mode:this._form.failureMode,
      long_text_policy:this._form.longTextPolicy,
      ...request,
    };
    if (entryId) message.entry_id = entryId;
    if (this._form.failureMode === "keep_last" && this._form.maxStale.trim()) {
      const stale = Number(this._form.maxStale);
      if (Number.isFinite(stale)) message.max_stale_minutes = Math.max(1, Math.min(525600, stale));
    }
    return message;
  };

  WebDataAssistantLifecyclePanel.prototype._save = async function () {
    if (!this._editingEntryId && !this._duplicateMode) return originalSave.call(this);
    if (!this._hass || !this._canSave()) return;

    let message;
    try {
      message = this._editingEntryId
        ? this._lifecycleMessage("web_data_assistant/update_source", this._editingEntryId)
        : this._lifecycleMessage("web_data_assistant/create_source");
    } catch (err) {
      this._error = err.message;
      this._render();
      return;
    }

    const savedName = this._form.name.trim();
    const wasEdit = Boolean(this._editingEntryId);
    this._saving = true;
    this._error = "";
    this._status = "";
    this._render();
    try {
      await this._hass.callWS(message);
      this._editingEntryId = null;
      this._duplicateMode = false;
      this._editingOriginalEntities = [];
      this._editingPreserveEntitiesOnly = false;
      this._resetLifecycleForm();
      this._status = `${wasEdit ? "Updated" : "Created"} ${savedName} successfully.`;
      await this._loadSources();
    } catch (err) {
      this._error = err?.message || `Home Assistant could not ${wasEdit ? "update" : "create"} the source.`;
    } finally {
      this._saving = false;
      this._render();
    }
  };

  WebDataAssistantLifecyclePanel.prototype._deleteSource = async function (entryId) {
    if (!this._hass || !entryId || this._deletingSource) return;
    const source = this._sources.find((item) => item.entry_id === entryId);
    this._deletingSource = entryId;
    this._sourcesError = "";
    this._render();
    try {
      await this._hass.callWS({ type:"web_data_assistant/delete_source", entry_id:entryId });
      this._sources = this._sources.filter((item) => item.entry_id !== entryId);
      this._deleteConfirmEntryId = null;
      if (this._editingEntryId === entryId) {
        this._editingEntryId = null;
        this._editingOriginalEntities = [];
        this._editingPreserveEntitiesOnly = false;
        this._resetLifecycleForm();
      }
      this._status = source ? `Deleted ${source.title}.` : "Source deleted.";
    } catch (err) {
      this._sourcesError = err?.message || "The source could not be deleted.";
    } finally {
      this._deletingSource = null;
      this._render();
    }
  };

  WebDataAssistantLifecyclePanel.prototype.__sourceLifecycleInstalled = true;
}
