const WebDataAssistantJsonUxPanel = customElements.get("web-data-assistant-panel");

if (WebDataAssistantJsonUxPanel && !WebDataAssistantJsonUxPanel.prototype.__jsonNavigationInstalled) {
  const originalStyles = WebDataAssistantJsonUxPanel.prototype._styles;
  const originalRenderJson = WebDataAssistantJsonUxPanel.prototype._renderJson;

  WebDataAssistantJsonUxPanel.prototype._styles = function () {
    return originalStyles.call(this) + `
      .json-tree { border:1px solid var(--divider-color); border-radius:10px; max-height:480px; overflow:auto; }
      .json-tree > .json-tree-node { border-bottom:1px solid var(--divider-color); }
      .json-tree > .json-tree-node:last-child { border-bottom:0; }
      .json-tree-branch { margin:0; padding:0; border:0; }
      .json-tree-branch > summary { display:flex; align-items:center; gap:8px; min-height:42px; padding:8px 12px; color:var(--primary-text-color); font-family:var(--code-font-family,monospace); cursor:pointer; list-style:none; }
      .json-tree-branch > summary::-webkit-details-marker { display:none; }
      .json-tree-branch > summary::before { content:"›"; width:14px; color:var(--secondary-text-color); transform-origin:center; transition:transform .12s ease; }
      .json-tree-branch[open] > summary::before { transform:rotate(90deg); }
      .json-tree-children { margin-left:18px; border-left:1px solid var(--divider-color); }
      .json-tree .json-row { border-bottom:0; border-top:1px solid var(--divider-color); }
      .json-tree-children > .json-row:first-child { border-top:0; }
      .json-tree-label { font-family:var(--code-font-family,monospace); font-size:13px; overflow-wrap:anywhere; }
      .json-tree-count { margin-left:auto; color:var(--secondary-text-color); font:12px var(--paper-font-body1_-_font-family,sans-serif); }
      .json-view-hint { display:flex; justify-content:space-between; gap:12px; align-items:center; margin:8px 0 12px; }
    `;
  };

  WebDataAssistantJsonUxPanel.prototype._jsonPointerParts = function (pointer) {
    if (!pointer) return [];
    return String(pointer)
      .slice(1)
      .split("/")
      .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  };

  WebDataAssistantJsonUxPanel.prototype._jsonTree = function (items) {
    const root = { children:new Map(), item:null };
    for (const item of items) {
      const parts = this._jsonPointerParts(item.path);
      if (!parts.length) {
        root.item = item;
        continue;
      }
      let node = root;
      for (const part of parts) {
        if (!node.children.has(part)) {
          node.children.set(part, { children:new Map(), item:null, label:part });
        }
        node = node.children.get(part);
      }
      node.item = item;
    }
    return root;
  };

  WebDataAssistantJsonUxPanel.prototype._jsonTreeLeafHtml = function (item, label) {
    const display = label ?? item.display_path ?? item.path ?? "(root)";
    return `<label class="json-row json-tree-leaf"><input class="json-check" type="checkbox" data-path="${this._attr(item.path)}" ${this._selectedJson.has(item.path) ? "checked" : ""}><span class="json-tree-label">${this._html(display)}</span><span class="json-value" title="${this._attr(item.preview)}">${this._html(item.preview)}</span></label>`;
  };

  WebDataAssistantJsonUxPanel.prototype._jsonTreeNodeCount = function (node) {
    let count = node.item ? 1 : 0;
    for (const child of node.children.values()) count += this._jsonTreeNodeCount(child);
    return count;
  };

  WebDataAssistantJsonUxPanel.prototype._jsonTreeNodeHtml = function (node, label, depth = 0) {
    const childEntries = [...node.children.entries()];
    if (!childEntries.length && node.item) {
      return this._jsonTreeLeafHtml(node.item, /^\d+$/.test(label) ? `[${label}]` : label);
    }

    const ownLeaf = node.item
      ? this._jsonTreeLeafHtml(node.item, /^\d+$/.test(label) ? `[${label}]` : label)
      : "";
    const children = childEntries
      .map(([childLabel, child]) => this._jsonTreeNodeHtml(child, childLabel, depth + 1))
      .join("");
    const displayLabel = /^\d+$/.test(label) ? `[${label}]` : label;
    const count = this._jsonTreeNodeCount(node);
    const open = depth < 1 ? " open" : "";
    return `<details class="json-tree-branch json-tree-node"${open}><summary><span class="json-tree-label">${this._html(displayLabel)}</span><span class="json-tree-count">${count} value${count === 1 ? "" : "s"}</span></summary><div class="json-tree-children">${ownLeaf}${children}</div></details>`;
  };

  WebDataAssistantJsonUxPanel.prototype._jsonTreeHtml = function (items) {
    const tree = this._jsonTree(items);
    const rootLeaf = tree.item ? this._jsonTreeLeafHtml(tree.item, "(root)") : "";
    const branches = [...tree.children.entries()]
      .map(([label, node]) => this._jsonTreeNodeHtml(node, label, 0))
      .join("");
    return `<div class="json-tree">${rootLeaf}${branches || '<div class="hint" style="padding:16px;">No selectable values were found.</div>'}</div>`;
  };

  WebDataAssistantJsonUxPanel.prototype._renderJson = function () {
    if (this._repairMode || !this._jsonResult || this._jsonMode === "object") {
      return originalRenderJson.call(this);
    }

    const all = this._jsonResult.values || [];
    const query = this._jsonFilter.trim().toLowerCase();
    if (query) return originalRenderJson.call(this);

    const byPath = new Map(all.map((item) => [item.path,item]));
    let details = "";
    if (this._jsonMode === "values") details = this._renderSeparateJsonReview(byPath);
    else if (this._jsonMode === "aggregate") details = this._renderAggregateJsonReview(byPath);

    return `<section class="card"><div class="heading"><div><h2>2. Choose JSON data</h2><p>${all.length} selectable scalar values ${this._jsonResult.truncated ? "shown" : "found"}.</p></div></div>
      <div class="tabs">
        <button class="tab ${this._jsonMode === "values" ? "active" : ""}" data-json-mode="values"><strong>Separate sensors</strong><span>Each selected value becomes its own entity and state.</span></button>
        <button class="tab ${this._jsonMode === "aggregate" ? "active" : ""}" data-json-mode="aggregate"><strong>One sensor + attributes</strong><span>Choose one state and keep the other selected values as attributes.</span></button>
        <button class="tab" data-json-mode="object"><strong>Import object as attributes</strong><span>Keep the response together on one entity, preserving nested JSON.</span></button>
      </div>
      ${this._jsonResult.truncated ? '<div class="warning" style="margin-bottom:12px;">This response contains more than 250 scalar values. Guided selection shows the first 250 to keep the browser responsive.</div>' : ""}
      <input id="json-filter" type="search" placeholder="Search paths or current values…" value="">
      <div class="json-view-hint"><span class="hint">Browse nested JSON by expanding branches. Searching switches to a flat result list.</span><span class="hint">${this._selectedJson.size} value${this._selectedJson.size === 1 ? "" : "s"} selected.</span></div>
      ${this._jsonTreeHtml(all)}
      ${details}
    </section>`;
  };


  const originalJsonMetadata = WebDataAssistantJsonUxPanel.prototype._jsonMetadata;
  const originalRenderSeparateJsonReview = WebDataAssistantJsonUxPanel.prototype._renderSeparateJsonReview;
  const originalRenderAggregateJsonReview = WebDataAssistantJsonUxPanel.prototype._renderAggregateJsonReview;
  const originalEntities = WebDataAssistantJsonUxPanel.prototype._entities;
  const originalBind = WebDataAssistantJsonUxPanel.prototype._bind;
  const originalPopulateEditableSource = WebDataAssistantJsonUxPanel.prototype._populateEditableSource;
  const originalPreviewEntityHtml = WebDataAssistantJsonUxPanel.prototype._previewEntityHtml;

  WebDataAssistantJsonUxPanel.prototype._jsonMetadata = function (path, item = null) {
    const metadata = originalJsonMetadata.call(this, path, item);
    if (metadata.deviceClassChoice === undefined) metadata.deviceClassChoice = "auto";
    if (metadata.stateClassChoice === undefined) metadata.stateClassChoice = "auto";
    return metadata;
  };

  WebDataAssistantJsonUxPanel.prototype._nativeMetadataSuggestion = function (path, item, metadata, unitOverride = null) {
    const valueType = this._valueType(item?.value_type);
    if (valueType !== "number") return { deviceClass:"", stateClass:"" };

    const unit = String(unitOverride ?? metadata?.unit ?? "").trim();
    const unitLower = unit.toLowerCase();
    const text = [
      item?.display_path || path || "",
      metadata?.name || "",
      unit,
    ].join(" ").toLowerCase().replaceAll("_", " ").replaceAll("-", " ");

    let deviceClass = "";
    if (/apparent\s*power/.test(text) || /(^|\s)(mva|va|kva)(\s|$)/i.test(unit)) deviceClass = "apparent_power";
    else if (/reactive\s*power/.test(text) || /(^|\s)(mvar|var|kvar)(\s|$)/i.test(unit)) deviceClass = "reactive_power";
    else if (/power\s*factor/.test(text)) deviceClass = "power_factor";
    else if (/temperature|\btemp\b|dew\s*point|feels\s*like/.test(text) || ["°c","°f","k"].includes(unitLower)) deviceClass = "temperature";
    else if (/humidity/.test(text)) deviceClass = "humidity";
    else if (/battery/.test(text) && (unit === "%" || !unit)) deviceClass = "battery";
    else if (/atmospheric|barometric|sea\s*level/.test(text) && /pressure/.test(text)) deviceClass = "atmospheric_pressure";
    else if (/pressure/.test(text) || /^(mbar|cbar|bar|mpa|pa|hpa|kpa|inhg|psi)$/i.test(unit)) deviceClass = "pressure";
    else if (/voltage|\bvolt\b/.test(text) || /^(mv|v|kv)$/i.test(unit)) deviceClass = "voltage";
    else if (/electric\s*current|amperage|\bamps?\b/.test(text) || /^(ma|a|ka)$/i.test(unit)) deviceClass = "current";
    else if (/frequency/.test(text) || /^(mhz|hz|khz|ghz)$/i.test(unit)) deviceClass = "frequency";
    else if (/energy|consumption/.test(text) || /^(mwh|wh|kwh|mwh|gwh|j|kj|mj)$/i.test(unit)) deviceClass = "energy";
    else if (/\bpower\b/.test(text) || /^(mw|w|kw|mw|gw)$/i.test(unit)) deviceClass = "power";
    else if (/wind\s*speed/.test(text)) deviceClass = "wind_speed";
    else if (/\bspeed\b/.test(text) || /^(m\/s|km\/h|mph|kn)$/i.test(unit)) deviceClass = "speed";
    else if (/rssi|signal\s*strength/.test(text) || /^(db|dbm)$/i.test(unit)) deviceClass = "signal_strength";
    else if (/illuminance|\blux\b/.test(text) || /^lx$/i.test(unit)) deviceClass = "illuminance";
    else if (/moisture/.test(text)) deviceClass = "moisture";
    else if (/precipitation\s*(rate|intensity)|rain\s*rate/.test(text) || /^(mm\/h|in\/h)$/i.test(unit)) deviceClass = "precipitation_intensity";
    else if (/precipitation|rainfall/.test(text)) deviceClass = "precipitation";
    else if (/data\s*rate|bitrate|bandwidth/.test(text) || /(bit|byte)s?\/s$/i.test(unit)) deviceClass = "data_rate";
    else if (/distance|\blength\b/.test(text)) deviceClass = "distance";
    else if (/duration|elapsed/.test(text)) deviceClass = "duration";
    else if (/weight|\bmass\b/.test(text)) deviceClass = "weight";
    else if (/flow\s*rate/.test(text)) deviceClass = "volume_flow_rate";
    else if (/\bvolume\b/.test(text)) deviceClass = "volume";
    else if (/carbon\s*dioxide|\bco2\b/.test(text)) deviceClass = "carbon_dioxide";
    else if (/carbon\s*monoxide|\bco\b/.test(text)) deviceClass = "carbon_monoxide";
    else if (/\bpm2[._ ]?5\b/.test(text)) deviceClass = "pm25";
    else if (/\bpm10\b/.test(text)) deviceClass = "pm10";
    else if (/\bpm1\b/.test(text)) deviceClass = "pm1";

    const totalWords = /\b(total|cumulative|lifetime|meter|consumed|consumption)\b/.test(text);
    const netWords = /\b(net|balance)\b/.test(text);
    let stateClass = "";
    if (["energy","gas","water"].includes(deviceClass) && totalWords) stateClass = "total_increasing";
    else if (["energy","gas","water","monetary"].includes(deviceClass) && netWords) stateClass = "total";
    else if (deviceClass && !["energy","gas","water","monetary","precipitation"].includes(deviceClass)) stateClass = "measurement";

    return { deviceClass, stateClass };
  };

  WebDataAssistantJsonUxPanel.prototype._resolvedNativeMetadata = function (path, item, metadata, unitOverride = null, deviceChoice = null, stateChoice = null) {
    const suggestion = this._nativeMetadataSuggestion(path, item, metadata, unitOverride);
    const device = deviceChoice ?? metadata?.deviceClassChoice ?? "auto";
    const state = stateChoice ?? metadata?.stateClassChoice ?? "auto";
    return {
      deviceClass: device === "auto" ? suggestion.deviceClass : device === "none" ? "" : device,
      stateClass: state === "auto" ? suggestion.stateClass : state === "none" ? "" : state,
      suggestedDeviceClass: suggestion.deviceClass,
      suggestedStateClass: suggestion.stateClass,
    };
  };

  WebDataAssistantJsonUxPanel.prototype._deviceClassOptions = function (selected, suggested) {
    const classes = [
      ["temperature","Temperature"],["humidity","Humidity"],["atmospheric_pressure","Atmospheric pressure"],
      ["pressure","Pressure"],["power","Power"],["apparent_power","Apparent power"],["reactive_power","Reactive power"],
      ["power_factor","Power factor"],["energy","Energy"],["voltage","Voltage"],["current","Current"],
      ["frequency","Frequency"],["battery","Battery"],["signal_strength","Signal strength"],["illuminance","Illuminance"],
      ["moisture","Moisture"],["wind_speed","Wind speed"],["speed","Speed"],["distance","Distance"],["duration","Duration"],
      ["precipitation","Precipitation"],["precipitation_intensity","Precipitation intensity"],["data_rate","Data rate"],
      ["weight","Weight"],["volume","Volume"],["volume_flow_rate","Volume flow rate"],["carbon_dioxide","Carbon dioxide"],
      ["carbon_monoxide","Carbon monoxide"],["pm1","PM1"],["pm25","PM2.5"],["pm10","PM10"]
    ];
    const suggestionLabel = suggested ? "Suggested: " + (classes.find(([value]) => value === suggested)?.[1] || suggested) : "Automatic (no suggestion)";
    return '<option value="auto" ' + (selected === "auto" ? "selected" : "") + '>' + this._html(suggestionLabel) + '</option>'
      + '<option value="none" ' + (selected === "none" ? "selected" : "") + '>None</option>'
      + classes.map(([value,label]) => '<option value="' + value + '" ' + (selected === value ? "selected" : "") + '>' + this._html(label) + '</option>').join("");
  };

  WebDataAssistantJsonUxPanel.prototype._stateClassOptions = function (selected, suggested) {
    const labels = { measurement:"Measurement", measurement_angle:"Angle measurement", total:"Total", total_increasing:"Total increasing" };
    const suggestionLabel = suggested ? "Suggested: " + labels[suggested] : "Automatic (no suggestion)";
    return '<option value="auto" ' + (selected === "auto" ? "selected" : "") + '>' + this._html(suggestionLabel) + '</option>'
      + '<option value="none" ' + (selected === "none" ? "selected" : "") + '>None</option>'
      + Object.entries(labels).map(([value,label]) => '<option value="' + value + '" ' + (selected === value ? "selected" : "") + '>' + label + '</option>').join("");
  };

  WebDataAssistantJsonUxPanel.prototype._renderSeparateJsonReview = function (byPath) {
    if (!this._selectedJson.size) return "";
    const reviewRows = [...this._selectedJson].map((path) => {
      const item = byPath.get(path);
      const metadata = this._jsonMetadata(path,item);
      const native = this._resolvedNativeMetadata(path,item,metadata);
      const nativeFields = this._valueType(item?.value_type) === "number"
        ? this._field("Home Assistant type", '<select class="json-device-class" data-path="' + this._attr(path) + '">' + this._deviceClassOptions(metadata.deviceClassChoice,native.suggestedDeviceClass) + '</select>')
          + this._field("Statistics behavior", '<select class="json-state-class" data-path="' + this._attr(path) + '">' + this._stateClassOptions(metadata.stateClassChoice,native.suggestedStateClass) + '</select>')
        : "";
      return '<div class="sensor-review-row"><div class="sensor-path">' + this._html(item?.display_path || path || "(root)") + '</div>'
        + this._field("Sensor name",'<input class="json-name" data-path="' + this._attr(path) + '" type="text" value="' + this._attr(metadata.name) + '">')
        + this._field("Unit (optional)",'<input class="json-unit" data-path="' + this._attr(path) + '" type="text" placeholder="e.g. °C, %, kWh" value="' + this._attr(metadata.unit) + '">')
        + nativeFields
        + this._field("Long text override",this._longTextSelect("json-long-text",path,metadata.longTextPolicy))
        + '</div>';
    }).join("");
    return '<div class="sensor-review"><h3>Review sensors</h3><p class="hint">Friendly names and units are editable. For numeric values, Web Data Assistant suggests native Home Assistant sensor metadata when the meaning is clear; you can override or disable it.</p>' + reviewRows + '</div>';
  };

  WebDataAssistantJsonUxPanel.prototype._renderAggregateJsonReview = function (byPath) {
    const base = originalRenderAggregateJsonReview.call(this, byPath);
    if (!this._selectedJson.size || !this._jsonStatePath) return base;
    const item = byPath.get(this._jsonStatePath);
    if (this._valueType(item?.value_type) !== "number") return base;

    if (this._aggregateDeviceClassChoice === undefined) this._aggregateDeviceClassChoice = "auto";
    if (this._aggregateStateClassChoice === undefined) this._aggregateStateClassChoice = "auto";
    const metadata = { name:this._form.name || "JSON data", unit:this._aggregateUnit };
    const native = this._resolvedNativeMetadata(
      this._jsonStatePath,item,metadata,this._aggregateUnit,
      this._aggregateDeviceClassChoice,this._aggregateStateClassChoice
    );
    const fields = '<div class="grid aggregate-native-metadata" style="margin-top:14px;">'
      + this._field("Home Assistant type",'<select id="aggregate-device-class">' + this._deviceClassOptions(this._aggregateDeviceClassChoice,native.suggestedDeviceClass) + '</select>')
      + this._field("Statistics behavior",'<select id="aggregate-state-class">' + this._stateClassOptions(this._aggregateStateClassChoice,native.suggestedStateClass) + '</select>')
      + '</div>';
    return base.replace('</div>', fields + '</div>');
  };

  WebDataAssistantJsonUxPanel.prototype._bind = function () {
    originalBind.call(this);
    this.shadowRoot.querySelectorAll(".json-device-class").forEach((select) => select.addEventListener("change",(event) => {
      this._jsonMetadata(event.target.dataset.path).deviceClassChoice = event.target.value;
      this._render();
    }));
    this.shadowRoot.querySelectorAll(".json-state-class").forEach((select) => select.addEventListener("change",(event) => {
      this._jsonMetadata(event.target.dataset.path).stateClassChoice = event.target.value;
      this._render();
    }));
    this.shadowRoot.getElementById("aggregate-device-class")?.addEventListener("change",(event) => {
      this._aggregateDeviceClassChoice = event.target.value;
      this._render();
    });
    this.shadowRoot.getElementById("aggregate-state-class")?.addEventListener("change",(event) => {
      this._aggregateStateClassChoice = event.target.value;
      this._render();
    });
    this.shadowRoot.querySelectorAll(".json-unit").forEach((input) => input.addEventListener("change",() => this._render()));
    this.shadowRoot.getElementById("aggregate-unit")?.addEventListener("change",() => this._render());
  };

  WebDataAssistantJsonUxPanel.prototype._entities = function () {
    const entities = originalEntities.call(this);
    if (this._sourceType !== "json") return entities;
    const byPath = new Map((this._jsonResult?.values || []).map((item) => [item.path,item]));

    if (this._jsonMode === "values") {
      entities.forEach((entity) => {
        const metadata = this._jsonMetadata(entity.path,byPath.get(entity.path));
        const native = this._resolvedNativeMetadata(entity.path,byPath.get(entity.path),metadata);
        if (native.deviceClass) entity.device_class = native.deviceClass;
        else delete entity.device_class;
        if (native.stateClass) entity.state_class = native.stateClass;
        else delete entity.state_class;
      });
    } else if (this._jsonMode === "aggregate" && entities[0]?.path) {
      const item = byPath.get(entities[0].path);
      const metadata = { name:entities[0].name, unit:entities[0].unit || "" };
      const native = this._resolvedNativeMetadata(
        entities[0].path,item,metadata,entities[0].unit || "",
        this._aggregateDeviceClassChoice ?? "auto",this._aggregateStateClassChoice ?? "auto"
      );
      if (native.deviceClass) entities[0].device_class = native.deviceClass;
      else delete entities[0].device_class;
      if (native.stateClass) entities[0].state_class = native.stateClass;
      else delete entities[0].state_class;
    }
    return entities;
  };

  if (originalPopulateEditableSource) {
    WebDataAssistantJsonUxPanel.prototype._populateEditableSource = async function (config, mode = "edit") {
      await originalPopulateEditableSource.call(this, config, mode);
      if (config.source_type !== "json") return;
      const entities = config.entities || [];
      if (this._jsonMode === "values") {
        entities.forEach((entity) => {
          if (entity.path === undefined) return;
          const metadata = this._jsonMetadata(entity.path);
          metadata.deviceClassChoice = entity.device_class || "none";
          metadata.stateClassChoice = entity.state_class || "none";
        });
      } else if (this._jsonMode === "aggregate" && entities[0]) {
        this._aggregateDeviceClassChoice = entities[0].device_class || "none";
        this._aggregateStateClassChoice = entities[0].state_class || "none";
      }
    };
  }

  if (originalPreviewEntityHtml) {
    WebDataAssistantJsonUxPanel.prototype._previewEntityHtml = function (entity) {
      const html = originalPreviewEntityHtml.call(this, entity);
      if (!entity.device_class && !entity.state_class) return html;
      const device = entity.device_class ? '<span>Home Assistant type: <strong>' + this._html(entity.device_class.replaceAll("_"," ")) + '</strong></span>' : "";
      const state = entity.state_class ? '<span>Statistics: <strong>' + this._html(entity.state_class.replaceAll("_"," ")) + '</strong></span>' : "";
      return html.replace('<details><summary>Technical details</summary>', '<div class="ha-preview-policy">' + device + (device && state ? ' · ' : '') + state + '</div><details><summary>Technical details</summary>');
    };
  }

  WebDataAssistantJsonUxPanel.prototype.__jsonNavigationInstalled = true;
}
