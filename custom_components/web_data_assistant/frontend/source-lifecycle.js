const WebDataAssistantPanel = customElements.get("web-data-assistant-panel");

if (WebDataAssistantPanel && !WebDataAssistantPanel.prototype.__sourceLifecycleInstalled) {
  const originalStyles = WebDataAssistantPanel.prototype._styles;
  const originalBind = WebDataAssistantPanel.prototype._bind;

  WebDataAssistantPanel.prototype._styles = function () {
    return `${originalStyles.call(this)}
      .danger { border-color:color-mix(in srgb,var(--error-color,#db4437) 45%,var(--divider-color)); color:var(--error-color,#db4437); }
      .delete-confirm { margin-top:12px; padding:12px; border:1px solid color-mix(in srgb,var(--error-color,#db4437) 35%,var(--divider-color)); border-radius:8px; background:color-mix(in srgb,var(--error-color,#db4437) 7%,transparent); }
      .delete-confirm p { margin:0; }
    `;
  };

  WebDataAssistantPanel.prototype._renderSources = function () {
    if (!this._sourcesLoaded) return `<section class="card"><h2>Configured sources</h2><p class="hint">Loading configured sources…</p></section>`;
    if (this._sourcesError && !this._sources.length) return `<section class="card"><h2>Configured sources</h2><div class="notice error">${this._html(this._sourcesError)}</div></section>`;
    if (!this._sources.length) return `<section class="card"><h2>Configured sources</h2><p class="hint">No Web Data Assistant sources have been created yet.</p></section>`;

    const cards = this._sources.map((source) => {
      const health = this._sourceHealth(source);
      const lastSuccess = source.last_successful_update ? this._formatDate(source.last_successful_update) : "Never";
      const type = source.source_type === "json" ? "JSON / API" : "Web page";
      const retaining = source.failure_mode === "keep_last" ? "Keep last value" : "Unavailable on failure";
      const extractionErrors = Number(source.extraction_error_count || 0);
      const confirmingDelete = this._deleteConfirmEntryId === source.entry_id;
      const deleting = this._deletingSource === source.entry_id;
      const confirm = confirmingDelete ? `<div class="delete-confirm"><p><strong>Delete ${this._html(source.title)}?</strong></p><p class="hint">This removes the source and its Home Assistant sensor entities. This cannot be undone.</p><div class="actions"><button class="secondary cancel-delete" data-entry-id="${this._attr(source.entry_id)}" ${deleting ? "disabled" : ""}>Cancel</button><button class="secondary danger confirm-delete" data-entry-id="${this._attr(source.entry_id)}" ${deleting ? "disabled" : ""}>${deleting ? "Deleting…" : "Delete source"}</button></div></div>` : "";
      return `<div class="source-card"><div class="source-card-head"><div><div class="source-title">${this._html(source.title)}</div><div class="source-url">${this._html(source.url || "")}</div></div><span class="health ${health.className}"><span class="health-dot"></span>${this._html(health.label)}</span></div><div class="source-meta"><span>${this._html(type)}</span><span>${Number(source.entity_count || 0)} sensor${Number(source.entity_count || 0) === 1 ? "" : "s"}</span><span>Every ${Number(source.scan_interval || 5)} min</span><span>${this._html(retaining)}</span><span>Last success: ${this._html(lastSuccess)}</span>${extractionErrors ? `<span>${extractionErrors} extraction issue${extractionErrors === 1 ? "" : "s"}</span>` : ""}</div><div class="actions"><button class="secondary refresh-source" data-entry-id="${this._attr(source.entry_id)}" ${this._refreshingSource === source.entry_id || source.state !== "loaded" || deleting ? "disabled" : ""}>${this._refreshingSource === source.entry_id ? "Refreshing…" : "Refresh now"}</button><button class="secondary danger request-delete" data-entry-id="${this._attr(source.entry_id)}" ${deleting ? "disabled" : ""}>Delete</button></div>${confirm}</div>`;
    }).join("");

    const sourceError = this._sourcesError ? `<div class="notice error" style="margin-bottom:12px;">${this._html(this._sourcesError)}</div>` : "";
    return `<section class="card"><div class="heading"><div><h2>Configured sources</h2><p>Current source health is shown without exposing request credentials or retrieved values.</p></div></div>${sourceError}<div class="source-list">${cards}</div></section>`;
  };

  WebDataAssistantPanel.prototype._bind = function () {
    originalBind.call(this);
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

  WebDataAssistantPanel.prototype._deleteSource = async function (entryId) {
    if (!this._hass || !entryId || this._deletingSource) return;
    const source = this._sources.find((item) => item.entry_id === entryId);
    this._deletingSource = entryId;
    this._sourcesError = "";
    this._render();
    try {
      await this._hass.callWS({ type:"web_data_assistant/delete_source", entry_id:entryId });
      this._sources = this._sources.filter((item) => item.entry_id !== entryId);
      this._deleteConfirmEntryId = null;
      this._status = source ? `Deleted ${source.title}.` : "Source deleted.";
    } catch (err) {
      this._sourcesError = err?.message || "The source could not be deleted.";
    } finally {
      this._deletingSource = null;
      this._render();
    }
  };

  WebDataAssistantPanel.prototype.__sourceLifecycleInstalled = true;
}
