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

  WebDataAssistantJsonUxPanel.prototype.__jsonNavigationInstalled = true;
}
