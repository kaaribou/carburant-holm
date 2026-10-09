/* HOLM Fuel Card — carte de l'intégration Carburant HOLM
 * Meilleur prix de la zone, tendance, classement des stations, favorites,
 * détails station (autres carburants, services, itinéraire).
 * Données : websocket carburant_holm/data (aucune entité à configurer).
 */
(() => {
  const VERSION = "1.5.1";
  const FUEL_COLOR = { gazole: "245,158,11", e10: "34,197,94", sp98: "59,130,246", sp95: "6,182,212", e85: "132,204,22", gplc: "168,85,247" };
  const SERVICE_ICON = [
    [/lavage/i, "mdi:car-wash"], [/boutique|alimentaire/i, "mdi:basket"], [/gonflage/i, "mdi:tire"], [/toilette/i, "mdi:toilet"],
    [/restauration|bar/i, "mdi:silverware-fork-knife"], [/dab|billet/i, "mdi:cash"], [/wifi/i, "mdi:wifi"], [/électrique|recharge/i, "mdi:ev-station"],
    [/automate|24/i, "mdi:credit-card-clock"], [/gpl|adblue/i, "mdi:water"], [/location/i, "mdi:car-key"], [/relais|colis/i, "mdi:package-variant"],
  ];
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const priceHTML = (p) => {
    if (p == null) return "–";
    const s = Number(p).toFixed(3).replace(".", ",");
    return `${s.slice(0, -1)}<small>${s.slice(-1)}</small><u>€</u>`;
  };
  const cts = (d) => (d == null ? null : `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d * 100).toFixed(1).replace(".", ",")} c`);
  const km = (d) => (d == null ? "" : `${d < 10 ? d.toFixed(1).replace(".", ",") : Math.round(d)} km`);
  const age = (iso, short) => {
    if (!iso) return { txt: "", cls: "old" };
    const t = new Date(iso), h = (Date.now() - t) / 3600000;
    const hm = t.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    if (h < 24 && new Date().toDateString() === t.toDateString()) return { txt: short ? hm : `aujourd'hui ${hm}`, cls: "fresh" };
    if (h < 48) return { txt: short ? "hier" : `hier ${hm}`, cls: "fresh" };
    const d = Math.floor(h / 24);
    return { txt: `il y a ${d} j`, cls: d <= 3 ? "mid" : "old" };
  };
  const ago = (iso) => {
    if (!iso) return "";
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : `il y a ${Math.round(m / 60)} h`;
  };
  // Garde la position de défilement pendant un nouveau rendu complet de la carte.
  // Sur iOS (WebKit, sans « scroll anchoring »), remplacer le contenu de la carte la fait rétrécir un instant :
  // la page, plus courte, remonte d'un coup. On fige la hauteur de la carte et on remet le défilement en place.
  const keepScroll = (host, fn) => {
    const saved = [];
    let n = host;
    while (n) {
      n = n.assignedSlot || n.parentNode || n.host;
      if (n && n.nodeType === 1 && n.scrollHeight > n.clientHeight) saved.push([n, n.scrollTop]);
    }
    const se = document.scrollingElement;
    if (se) saved.push([se, se.scrollTop]);
    const h = host.offsetHeight;
    if (h) host.style.minHeight = `${h}px`;
    try { fn(); } finally {
      const restore = () => saved.forEach(([el, t]) => { if (Math.abs(el.scrollTop - t) > 1) el.scrollTop = t; });
      restore();
      requestAnimationFrame(() => { restore(); host.style.minHeight = ""; requestAnimationFrame(restore); });
    }
  };
  const initials = (s) => (s || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  class HolmFuelCard extends HTMLElement {
    static getConfigElement() {
      return document.createElement("holm-fuel-card-editor");
    }
    static getStubConfig() {
      return { type: "custom:holm-fuel-card", rows: 6, show_chart: true, show_favorites: true };
    }
    setConfig(config) {
      this._config = { rows: 6, show_chart: true, show_favorites: true, ...config };
      this._fuel = this._config.fuel || this._fuel || null;
      this._open = null;
      if (!this.shadowRoot) this.attachShadow({ mode: "open" });
      this._render();
    }
    getCardSize() {
      return 8;
    }
    getGridOptions() {
      return { columns: 12, min_columns: 6, rows: "auto" };
    }
    set hass(hass) {
      const first = !this._hass;
      this._hass = hass;
      this._tone();
      if (first) this._load();
      else if (this._btn && hass.states[this._btn] && this._btnTs !== hass.states[this._btn].last_changed) {
        this._btnTs = hass.states[this._btn].last_changed;
        setTimeout(() => this._load(), 4000);
      }
    }
    connectedCallback() {
      clearInterval(this._iv);
      this._iv = setInterval(() => this._load(), 10 * 60000);
      if (this._hass) this._load();
    }
    disconnectedCallback() {
      clearInterval(this._iv);
    }
    async _load() {
      if (!this._hass || this._loading) return;
      this._loading = true;
      try {
        const r = await this._hass.callWS({ type: "carburant_holm/data", history_days: 45 });
        const zones = r.zones || [];
        const ids = (this._config.entry_ids && this._config.entry_ids.length ? this._config.entry_ids : this._config.entry_id ? [this._config.entry_id] : []);
        let picked = ids.map((id) => zones.find((z) => z.entry_id === id)).filter(Boolean);
        if (!picked.length) picked = [zones.find((z) => this._config.zone && z.zone === this._config.zone) || zones[0]].filter(Boolean);
        this._zones = picked;
        this._zone = picked.length > 1 ? HolmFuelCard.merge(picked) : picked[0] || null;
        this._error = zones.length ? null : "Aucune zone configurée : ajoute l'intégration Carburant HOLM.";
        if (this._zone) {
          const allowed = this._config.fuels && this._config.fuels.length ? this._zone.fuels.filter((f) => this._config.fuels.includes(f.key)) : this._zone.fuels;
          this._fuels = allowed.length ? allowed : this._zone.fuels;
          if (!this._fuel || !this._fuels.some((f) => f.key === this._fuel)) this._fuel = (this._fuels[0] || {}).key;
          this._byId = Object.fromEntries(this._zone.stations.map((s) => [s.id, s]));
          const ents = this._hass.entities || {};
          const zids = this._zones.map((z) => z.entry_id);
          this._btns = Object.keys(ents).filter((id) => id.startsWith("button.") && ents[id].platform === "carburant_holm" && (!ents[id].config_entry_id || zids.includes(ents[id].config_entry_id)));
          this._btn = this._btns[0];
          const cnt = {};
          this._zone.stations.forEach((s) => { const k = `${s.name}|${s.city}`; cnt[k] = (cnt[k] || 0) + 1; });
          this._dup = cnt;
          if (this._btn && this._hass.states[this._btn]) this._btnTs = this._hass.states[this._btn].last_changed;
        }
      } catch (e) {
        this._error = "Intégration Carburant HOLM introuvable ou indisponible.";
      }
      this._loading = false;
      this._render();
    }
    _refresh() {
      if (this._btns && this._btns.length) this._hass.callService("button", "press", { entity_id: this._btns });
      this.shadowRoot.querySelector(".ref")?.classList.add("spin");
      setTimeout(() => this._load(), 6000);
    }

    // plusieurs zones dans une même carte : stations réunies, classement et tendance recalculés
    static merge(zs) {
      const byId = new Map();
      zs.forEach((z) => z.stations.forEach((st) => {
        const prev = byId.get(st.id);
        if (!prev) byId.set(st.id, { ...st });
        else if (st.in_zone !== false && prev.in_zone === false) byId.set(st.id, { ...st });
      }));
      const fuels = [];
      zs.forEach((z) => z.fuels.forEach((f) => { if (!fuels.some((x) => x.key === f.key)) fuels.push(f); }));
      const stats = {}, history = {};
      fuels.forEach(({ key }) => {
        const ids = [...new Set(zs.flatMap((z) => (z.stats[key] || {}).ranking || []))].filter((id) => byId.get(id)?.fuels[key]?.price != null);
        ids.sort((a, b) => (byId.get(a).fuels[key].price - byId.get(b).fuels[key].price) || ((byId.get(a).distance ?? 999) - (byId.get(b).distance ?? 999)));
        const prices = ids.map((id) => byId.get(id).fuels[key].price);
        const tr = zs.map((z) => (z.stats[key] || {}).trend_7d).filter((v) => v != null);
        stats[key] = ids.length ? { count: ids.length, best: ids[0], best_price: prices[0], average: prices.reduce((a, b) => a + b, 0) / prices.length, max: Math.max(...prices), ranking: ids,
          trend_7d: tr.length ? tr.reduce((a, b) => a + b, 0) / tr.length : null } : { count: 0, ranking: [] };
        const days = {};
        zs.forEach((z) => (z.history[key] || []).forEach((d) => { (days[d.date] ||= []).push(d); }));
        history[key] = Object.keys(days).sort().map((d) => ({ date: d, min: Math.min(...days[d].map((x) => x.min)), avg: days[d].reduce((a, x) => a + x.avg, 0) / days[d].length }));
      });
      return { ...zs[0], zone: zs.map((z) => z.zone).join(" + "), multi: zs.length, mobile: zs.some((z) => z.mobile),
        fuels, stations: [...byId.values()], stats, history, favorites: [...new Set(zs.flatMap((z) => z.favorites))],
        stations_history: Object.assign({}, ...zs.map((z) => z.favorites_history || {}), ...zs.map((z) => z.stations_history || {})),
        updated: zs.map((z) => z.updated).filter(Boolean).sort()[0] };
    }
    // ville, ou adresse + ville quand deux stations portent le même nom (ex. deux « Super U Poitiers »)
    _where(s) {
      const dup = this._dup && this._dup[`${s.name}|${s.city}`] > 1;
      return dup && s.address ? `${s.address}, ${s.city}` : s.city;
    }
    // tri : default (classement puis favorites), price, distance, updated, name
    _sortMode() { return this._sort || this._config.sort || "default"; }
    _sorted(list, fuel, mode) {
      const P = (x) => { const v = x.fuels[fuel]?.price; return v == null ? Infinity : v; };
      const T = (x) => { const u = x.fuels[fuel]?.updated; return u ? -new Date(u).getTime() : Infinity; };
      const D = (x) => (x.distance == null ? Infinity : x.distance);
      const key = { price: (x) => [P(x), D(x)], distance: (x) => [D(x), P(x)], updated: (x) => [T(x), P(x)] }[mode];
      if (mode === "name") return [...list].sort((a, b) => a.name.localeCompare(b.name, "fr") || P(a) - P(b));
      if (!key) return list;
      return [...list].sort((a, b) => { const ka = key(a), kb = key(b); return ka[0] - kb[0] || ka[1] - kb[1]; });
    }
    _click() {
      return this._config.station_click || (this._config.layout === "compact" ? "maps" : "details");
    }

    _tone() {
      const t = (this._config && this._config.theme) || "auto";
      // sombre ou clair ? on regarde la couleur de fond réellement appliquée par le thème
      let dark = !!(this._hass && this._hass.themes && this._hass.themes.darkMode);
      try {
        const cs = getComputedStyle(this);
        const bg = (cs.getPropertyValue("--primary-background-color") || cs.getPropertyValue("--card-background-color") || "").trim();
        const m = bg.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i) || bg.match(/rgba?\(([^)]+)\)/i);
        if (m) {
          let rgb;
          if (bg.startsWith("#")) { const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1]; rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }
          else rgb = m[1].split(",").slice(0, 3).map((x) => parseFloat(x));
          if (rgb.every((x) => !isNaN(x))) dark = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 < 0.5;
        }
      } catch (e) { /* on garde darkMode */ }
      const tone = t === "auto" ? (dark ? "dark" : "light") : t;
      if (this.dataset.tone !== tone) this.dataset.tone = tone;
      const d = dark ? "1" : "0";
      if (this.dataset.dark !== d) this.dataset.dark = d;
    }

    _render() {
      keepScroll(this, () => this._renderNow());
    }
    _renderNow() {
      const root = this.shadowRoot;
      this._tone();
      if (!root) return;
      if (!this._zone) {
        root.innerHTML = `<style>${HolmFuelCard.css()}</style><ha-card><div class="empty"><ha-icon icon="mdi:gas-station-off"></ha-icon>${esc(this._error || "Chargement des prix…")}</div></ha-card>`;
        return;
      }
      this._charts = {};
      if (this._config.layout === "compact") return this._renderCompact();
      const z = this._zone, fuel = this._fuel, cfg = this._config;
      const col = FUEL_COLOR[fuel] || "38,198,218";
      const st = z.stats[fuel] || {};
      const best = this._byId[st.best];
      const ranking = (st.ranking || []).map((id) => this._byId[id]).filter(Boolean);
      const rows = ranking.slice(0, cfg.rows);
      const shown = new Set(rows.map((s) => s.id));
      const favs = cfg.show_favorites ? z.favorites.map((id) => this._byId[id]).filter((s) => s && !shown.has(s.id)) : [];
      const lo = st.best_price, hi = st.max;

      const tabs = this._fuels.map((f) => {
        const s = z.stats[f.key] || {};
        return `<button class="tab${f.key === fuel ? " on" : ""}" data-f="${f.key}" style="--c:${FUEL_COLOR[f.key] || "38,198,218"}"><span>${esc(f.label)}</span><b>${s.best_price != null ? s.best_price.toFixed(3).replace(".", ",") : "–"}</b></button>`;
      }).join("");

      let hero = `<div class="hero none">Aucun prix récent pour ce carburant dans la zone.</div>`;
      if (best) {
        const f = best.fuels[fuel] || {};
        const a = age(f.updated);
        const t7 = st.trend_7d, dAvg = st.average != null ? f.price - st.average : null;
        hero = `<div class="hero">
          <div class="logo big">${this._logo(best)}</div>
          <div class="hi">
            <div class="crown"><ha-icon icon="mdi:trophy"></ha-icon>${z.mobile ? "Moins cher à proximité" : z.multi ? "Moins cher de vos zones" : "Moins cher de la zone"}</div>
            <div class="hn">${esc(best.name)}</div>
            <div class="hs">${esc(this._where(best))}${best.distance != null ? ` · ${km(best.distance)}` : ""}</div>
          </div>
          <div class="price">${priceHTML(f.price)}</div>
          <div class="hb">
            <span class="chip"><i class="dot ${a.cls}"></i>${esc(a.txt)}</span>
            ${t7 != null ? `<span class="chip ${t7 < 0 ? "down" : t7 > 0 ? "up" : ""}"><ha-icon icon="${t7 < 0 ? "mdi:trending-down" : t7 > 0 ? "mdi:trending-up" : "mdi:trending-neutral"}"></ha-icon>${cts(t7)} / 7 j</span>` : ""}
            ${dAvg != null && st.count > 1 ? `<span class="chip down">${cts(dAvg)} vs moy.</span>` : ""}
            ${this._click() === "none" ? "" : `<a class="go" href="${this._maps(best)}" target="_blank" rel="noopener"><ha-icon icon="mdi:directions"></ha-icon>Itinéraire</a>`}
          </div>
        </div>`;
      }

      const chart = cfg.show_chart && !z.mobile ? this._chart(z.history[fuel] || [], col) : "";
      const sm = this._sortMode();
      const merged = sm !== "default";
      const list = merged
        ? this._sorted(rows.concat(favs), fuel, sm).map((s) => this._row(s, fuel, (s.fuels[fuel] || {}).rank, lo, hi)).join("")
        : rows.map((s, i) => this._row(s, fuel, i + 1, lo, hi)).join("");
      const favHTML = !merged && favs.length ? `<div class="sec"><ha-icon icon="mdi:star"></ha-icon>Tes stations</div>${favs.map((s) => this._row(s, fuel, (s.fuels[fuel] || {}).rank, lo, hi)).join("")}` : "";
      const title = cfg.title || `Carburant ${z.zone}`;

      root.innerHTML = `<style>${HolmFuelCard.css()}</style>
      <ha-card style="--c:${col}">
        <div class="amb"></div>
        <div class="wrap">
          <div class="head">
            <div class="hic"><ha-icon icon="mdi:gas-station"></ha-icon></div>
            <div class="ht"><div class="title">${esc(title)}</div>
              <div class="sub">${z.mobile ? `<ha-icon class="mob" icon="mdi:crosshairs-gps"></ha-icon>${z.tracker_name && !String(z.zone).includes(z.tracker_name) ? `autour de ${esc(z.tracker_name)} · ` : ""}` : ""}${st.count || 0} stations · ${z.multi ? `${z.multi} zones` : `${String(z.radius).replace(".", ",")} km`} · ${ago(z.updated)}</div></div>
            <button class="ref" title="Actualiser"><ha-icon icon="mdi:refresh"></ha-icon></button>
          </div>
          <div class="tabs">${tabs}</div>
          ${hero}
          ${chart}
          <div class="sec"><ha-icon icon="mdi:format-list-numbered"></ha-icon>${merged ? `Stations · ${{ price: "prix", distance: "distance", updated: "mise à jour", name: "nom" }[sm]}` : "Classement"}<span>${lo != null ? `${lo.toFixed(3).replace(".", ",")} → ${hi.toFixed(3).replace(".", ",")} €` : ""}</span></div>
          <div class="list">${list || `<div class="none">Aucune station.</div>`}</div>
          ${favHTML}
        </div>
      </ha-card>`;
      root.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => { this._fuel = b.dataset.f; this._open = null; this._render(); }));
      root.querySelector(".ref").addEventListener("click", () => this._refresh());
      this._bindChart(root);
      root.querySelectorAll(".row").forEach((r) => r.addEventListener("click", (e) => {
        if (e.target.closest("a")) return;
        const mode = this._click();
        if (mode === "none") return;
        if (mode === "maps") { const s = this._byId[r.dataset.id]; if (s) window.open(this._maps(s), "_blank", "noopener"); return; }
        this._open = this._open === r.dataset.id ? null : r.dataset.id;
        this._render();
      }));
      root.querySelectorAll("img[data-fb]").forEach((img) => img.addEventListener("error", () => { img.replaceWith(Object.assign(document.createElement("span"), { className: "ini", textContent: img.dataset.fb })); }));
    }
    _renderCompact() {
      const root = this.shadowRoot, z = this._zone, fuel = this._fuel, cfg = this._config;
      const col = FUEL_COLOR[fuel] || "38,198,218";
      const st = z.stats[fuel] || {};
      let list = (st.ranking || []).map((id) => this._byId[id]).filter(Boolean);
      if (cfg.favorites_only) {
        list = z.favorites.map((id) => this._byId[id]).filter((x) => x && x.fuels[fuel]);
        list.sort((a, b) => ((a.fuels[fuel].price ?? 99) - (b.fuels[fuel].price ?? 99)));
      } else {
        const shown = new Set(list.slice(0, cfg.rows).map((x) => x.id));
        const extra = cfg.show_favorites ? z.favorites.map((id) => this._byId[id]).filter((x) => x && x.fuels[fuel] && !shown.has(x.id)) : [];
        list = list.slice(0, cfg.rows).concat(extra);
      }
      const sm = this._sortMode();
      list = this._sorted(list, fuel, sm);
      const lo = st.best_price, hi = st.max;
      const pills = this._fuels.length > 1 ? `<div class="cpills">${this._fuels.map((f) => `<button class="cp${f.key === fuel ? " on" : ""}" data-f="${f.key}" style="--c:${FUEL_COLOR[f.key] || "38,198,218"}">${esc(f.label)}</button>`).join("")}</div>` : "";
      const days = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso)) / 86400000)) : null);
      const rows = list.map((x) => {
        const f = x.fuels[fuel] || {};
        const d = days(f.updated);
        const cheap = f.price != null && f.price === lo, dear = f.price != null && f.price === hi && hi !== lo;
        const fav = z.favorites.includes(x.id);
        const mode = this._click(), open = mode === "details" && this._open === x.id;
        const tag = mode === "maps" ? `a class="cr" href="${this._maps(x)}" target="_blank" rel="noopener"` : `div class="cr${mode === "details" ? " clk" : " ro"}${open ? " open" : ""}" data-id="${esc(x.id)}"`;
        return `<${tag}>
          <span class="clogo">${this._logo(x)}</span>
          <span class="cn"><b>${esc(x.name)}${fav ? `<ha-icon class="star" icon="mdi:star"></ha-icon>` : ""}</b><small>${esc(this._where(x))}${x.distance != null ? ` · ${km(x.distance)}` : ""}${x.in_zone === false ? " · hors zone" : ""}</small></span>
          <span class="cpz">${f.price != null ? `<i class="cdot ${cheap ? "g" : dear ? "r" : ""}"></i>${f.price.toFixed(3).replace(".", ",")} €` : `<span class="rupt">Rupture</span>`}</span>
          <span class="cj ${d == null ? "" : d <= 1 ? "ok" : d <= 3 ? "mid" : "old"}">${d == null ? "–" : "J+" + d}</span>
        </${mode === "maps" ? "a" : "div"}>${open ? `<div class="cdet">${this._detail(x)}</div>` : ""}`;
      }).join("");
      root.innerHTML = `<style>${HolmFuelCard.css()}</style>
      <ha-card class="compact" style="--c:${col}">
        <div class="wrap cw">
          <div class="chead"><ha-icon icon="${z.mobile ? "mdi:crosshairs-gps" : "mdi:gas-station"}"></ha-icon><span class="ct">${esc(cfg.title || `Stations ${z.zone}`)}</span>${pills}<button class="ref cref" title="Actualiser"><ha-icon icon="mdi:refresh"></ha-icon></button></div>
          <div class="ctab"><div class="cth">${[["", ""], ["distance", "Station"], ["price", "Prix"], ["updated", "MàJ"]].map(([k, l]) => k ? `<button class="cs${sm === k ? " on" : ""}" data-s="${k}" title="Trier">${l}${sm === k ? " ▾" : ""}</button>` : "<span></span>").join("")}</div>${rows || `<div class="none">Aucune station.</div>`}</div>
        </div>
      </ha-card>`;
      root.querySelectorAll(".cp").forEach((b) => b.addEventListener("click", () => { this._fuel = b.dataset.f; this._render(); }));
      root.querySelector(".cref").addEventListener("click", () => this._refresh());
      root.querySelectorAll(".cs").forEach((b) => b.addEventListener("click", () => { const k = b.dataset.s; this._sort = this._sortMode() === k ? "default" : k; this._render(); }));
      root.querySelectorAll(".cr.clk").forEach((r) => r.addEventListener("click", () => { this._open = this._open === r.dataset.id ? null : r.dataset.id; this._render(); }));
      this._bindChart(root);
      root.querySelectorAll("img[data-fb]").forEach((img) => img.addEventListener("error", () => { img.replaceWith(Object.assign(document.createElement("span"), { className: "ini", textContent: img.dataset.fb })); }));
    }
    _logo(s) {
      const ini = esc(initials(s.brand || s.name));
      return s.logo ? `<img src="${esc(s.logo)}" data-fb="${ini}" alt="">` : `<span class="ini">${ini}</span>`;
    }
    _maps(s) {
      return s.latitude != null ? `https://www.google.com/maps/dir/?api=1&destination=${s.latitude},${s.longitude}` : `https://www.google.com/maps/search/${encodeURIComponent(`${s.address} ${s.city}`)}`;
    }
    _row(s, fuel, rank, lo, hi) {
      const f = s.fuels[fuel] || {};
      const a = age(f.updated, true);
      const fav = this._zone.favorites.includes(s.id);
      const pct = f.price != null && hi > lo ? Math.max(4, 100 - ((f.price - lo) / (hi - lo)) * 96) : 100;
      const open = this._open === s.id;
      const det = open ? `<div class="det">${this._detail(s)}</div>` : "";
      return this._rowHTML(s, fuel, rank, lo, hi, f, a, fav, pct, open, det);
    }
    _detail(s) {
      {
        const others = this._zone.fuels.map((x) => {
          const g = s.fuels[x.key];
          if (!g) return "";
          return `<span class="fc" style="--c:${FUEL_COLOR[x.key]}"><b>${esc(x.label)}</b>${g.price != null ? g.price.toFixed(3).replace(".", ",") + " €" : `<em>rupture</em>`}</span>`;
        }).join("");
        const serv = (s.services || []).slice(0, 10).map((x) => {
          const ic = (SERVICE_ICON.find(([re]) => re.test(x)) || [0, "mdi:check-circle-outline"])[1];
          return `<span class="sv"><ha-icon icon="${ic}"></ha-icon>${esc(x)}</span>`;
        }).join("");
        const links = this._click() === "none" ? "" : `<div class="acts"><a href="${this._maps(s)}" target="_blank" rel="noopener"><ha-icon icon="mdi:google-maps"></ha-icon>Google Maps</a>${s.latitude != null ? `<a href="https://waze.com/ul?ll=${s.latitude},${s.longitude}&navigate=yes" target="_blank" rel="noopener"><ha-icon icon="mdi:waze"></ha-icon>Waze</a>` : ""}</div>`;
        const fuel = this._fuel, sh = ((this._zone.stations_history || this._zone.favorites_history || {})[s.id] || {})[fuel] || [];
        const zavg = Object.fromEntries((this._zone.history[fuel] || []).map((d) => [d.date, d.avg]));
        const shist = sh.map((d) => ({ date: d.date, min: d.price, avg: zavg[d.date] ?? null }));
        const schart = this._config.show_chart === false || this._zone.mobile && !this._zone.favorites.includes(s.id) ? "" : `<div class="stc">${this._chart(shist, FUEL_COLOR[fuel] || "38,198,218", "st-" + s.id, "cette station")}</div>`;
        return `
          ${schart}
          <div class="addr"><ha-icon icon="mdi:map-marker-outline"></ha-icon>${esc(s.address)}, ${esc(s.postal_code || "")} ${esc(s.city)}</div>
          <div class="fcs">${others}</div>
          ${s.automate_24_24 ? `<div class="sv24"><ha-icon icon="mdi:hours-24"></ha-icon>Automate 24 h/24</div>` : ""}
          ${serv ? `<div class="svs">${serv}</div>` : ""}
          ${links}`;
      }
    }
    _rowHTML(s, fuel, rank, lo, hi, f, a, fav, pct, open, det) {
      return `<div class="row${open ? " open" : ""}${rank === 1 ? " first" : ""}${this._click() === "none" ? " ro" : ""}" data-id="${esc(s.id)}">
        <div class="rk">${rank || "–"}</div>
        <div class="logo">${this._logo(s)}</div>
        <div class="ri"><div class="rn">${esc(s.name)}${fav ? `<ha-icon class="star" icon="mdi:star"></ha-icon>` : ""}</div>
          <div class="rs">${esc(this._where(s))}${s.distance != null ? ` · ${km(s.distance)}` : ""}${s.in_zone === false ? " · hors zone" : ""} · <i class="dot ${a.cls}"></i>${esc(a.txt)}</div>
          <div class="bar"><i style="width:${pct}%"></i></div></div>
        <div class="rp">${f.price != null ? priceHTML(f.price) : `<span class="rupt">Rupture</span>`}${f.price != null && lo != null && rank !== 1 ? `<em>${cts(f.price - lo)}</em>` : ""}</div>
        ${det}
      </div>`;
    }
    _chart(h, col, key = "zone", main = "meilleur") {
      if (!h || h.length < 2) return `<div class="chart nodata"><ha-icon icon="mdi:chart-line"></ha-icon>${key === "zone" ? "L'historique se construit jour après jour (tendance dès demain)." : "L'historique de cette station se construit jour après jour."}</div>`;
      const W = 320, H = 70, P = 4, B = 12;
      const vals = h.flatMap((d) => [d.min, d.avg]).filter((v) => v != null);
      const vmin = Math.min(...vals), vmax = Math.max(...vals);
      let lo = vmin, hi = vmax;
      if (hi - lo < 0.02) { lo -= 0.01; hi += 0.01; }
      const X = (i) => P + (i / (h.length - 1)) * (W - 2 * P), Y = (v) => P + (1 - (v - lo) / (hi - lo)) * (H - 2 * P - B);
      const line = (k) => h.filter((d) => d[k] != null).map((d, i) => `${i ? "L" : "M"}${X(h.indexOf(d)).toFixed(1)},${Y(d[k]).toFixed(1)}`).join(" ");
      const area = `${line("min")} L${X(h.length - 1)},${H - B} L${X(0)},${H - B} Z`;
      const d0 = new Date(h[0].date), d1 = new Date(h[h.length - 1].date);
      const f = (d) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
      const vals_on = this._config.chart_values !== false;
      (this._charts ||= {})[key] = { h, main };
      const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <defs><linearGradient id="fg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="rgb(${col})" stop-opacity=".35"/><stop offset="1" stop-color="rgb(${col})" stop-opacity="0"/></linearGradient></defs>
        ${vals_on ? `<path d="M0,${Y(vmax).toFixed(1)} H${W} M0,${Y(vmin).toFixed(1)} H${W}" class="grid"/>` : ""}
        <path d="${area}" fill="url(#fg)"/><path d="${line("avg")}" class="avg"/><path d="${line("min")}" class="min"/>
        <circle cx="${X(h.length - 1)}" cy="${Y(h[h.length - 1].min)}" r="3" class="pt"/></svg>`;
      const leg = `<div class="leg"><span>${f(d0)}</span><span><i class="lm"></i>${main} <i class="la"></i>moyenne</span><span>${f(d1)}</span></div>`;
      if (!vals_on) return `<div class="chart">${svg}${leg}</div>`;
      // valeurs : prix extrêmes sur l'axe, valeurs du jour au bout des courbes, bulle au survol
      const pct = (v) => (Y(v) / H) * 100;
      const last = h[h.length - 1];
      let yMin = pct(last.min), yAvg = last.avg != null ? pct(last.avg) : null;
      if (yAvg != null && Math.abs(yMin - yAvg) < 20) {   // étiquettes trop proches : on les écarte
        const mid = (yMin + yAvg) / 2, up = last.avg >= last.min;
        yAvg = mid + (up ? -10 : 10); yMin = mid + (up ? 10 : -10);
      }
      const p3 = (v) => v.toFixed(3).replace(".", ",");
      return `<div class="chart cv">
        <div class="plot">
          <span class="yl" style="top:${pct(vmax)}%">${p3(vmax)}</span>
          ${vmax - vmin >= 0.0005 ? `<span class="yl" style="top:${pct(vmin)}%">${p3(vmin)}</span>` : ""}
          <div class="area" data-k="${esc(key)}">${svg}<div class="hov"><i class="vl"></i><i class="hd hm"></i><i class="hd ha"></i><div class="tip"></div></div></div>
          <span class="ev m" style="top:${Math.max(4, Math.min(84, yMin))}%">${p3(last.min)}</span>
          ${yAvg != null ? `<span class="ev a" style="top:${Math.max(4, Math.min(84, yAvg))}%">${p3(last.avg)}</span>` : ""}
        </div>${leg}</div>`;
    }
    _bindChart(root) {
      root.querySelectorAll(".chart.cv .area").forEach((area) => {
        const c = (this._charts || {})[area.dataset.k];
        if (c) this._bindArea(area, c.h, c.main);
      });
    }
    _bindArea(area, h, main) {
      const hov = area.querySelector(".hov"), tip = hov.querySelector(".tip");
      const W = 320, P = 4;
      const show = (e) => {
        const r = area.getBoundingClientRect();
        const fx = Math.max(0, Math.min(1, ((e.clientX - r.left) / r.width * W - P) / (W - 2 * P)));
        const i = Math.round(fx * (h.length - 1)), d = h[i];
        const x = ((P + (i / (h.length - 1)) * (W - 2 * P)) / W) * 100;
        const vals = h.flatMap((q) => [q.min, q.avg]).filter((v) => v != null);
        let lo = Math.min(...vals), hi = Math.max(...vals);
        if (hi - lo < 0.02) { lo -= 0.01; hi += 0.01; }
        const yp = (v) => ((4 + (1 - (v - lo) / (hi - lo)) * (70 - 8 - 12)) / 70) * 100;
        hov.style.display = "block";
        hov.querySelector(".vl").style.left = `${x}%`;
        const hm = hov.querySelector(".hm"), ha = hov.querySelector(".ha");
        hm.style.cssText = `left:${x}%;top:${yp(d.min)}%`;
        ha.style.cssText = d.avg != null ? `left:${x}%;top:${yp(d.avg)}%` : "display:none";
        let day = new Date(d.date).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
        day = day.charAt(0).toUpperCase() + day.slice(1);
        const p3 = (v) => (v == null ? "–" : `${v.toFixed(3).replace(".", ",")} €`);
        tip.innerHTML = `<b>${day}</b><span><i class="lm"></i>${main} ${p3(d.min)}</span><span><i class="la"></i>moyenne ${p3(d.avg)}</span>`;
        tip.style.left = x > 55 ? "auto" : `calc(${x}% + 10px)`;
        tip.style.right = x > 55 ? `calc(${100 - x}% + 10px)` : "auto";
      };
      const hide = () => { hov.style.display = "none"; };
      area.addEventListener("pointermove", show);
      area.addEventListener("pointerdown", show);
      area.addEventListener("pointerleave", hide);
      area.addEventListener("pointercancel", hide);
      area.addEventListener("click", (e) => e.stopPropagation());   // ne replie pas la fiche de la station
    }

    static css() {
      return `
      :host { display: block; }
      ha-card { display: block; position: relative; overflow: hidden; container-type: inline-size; --c: 38,198,218;
        --ink: 255,255,255; --tx: #e6f2f5; --tx2: rgba(220,235,240,.62); --hi: #fff;
        border-radius: var(--ha-card-border-radius, 20px); background: linear-gradient(160deg, rgba(20,28,38,.92), rgba(10,15,22,.96));
        border: 1px solid rgba(var(--c), .2); box-shadow: 0 8px 26px rgba(0,0,0,.35), inset 0 1px 0 rgba(var(--ink),.04); color: var(--tx); }
      .amb { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(80% 50% at 100% 0%, rgba(var(--c), .18), transparent 70%); transition: background .6s; }
      button { font: inherit; color: inherit; border: 0; background: none; cursor: pointer; padding: 0; }
      a { color: inherit; text-decoration: none; }
      .wrap { position: relative; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
      .empty { padding: 24px; display: flex; gap: 10px; align-items: center; color: var(--tx2); }
      .head { display: flex; align-items: center; gap: 10px; }
      .hic { flex: 0 0 40px; height: 40px; border-radius: 13px; display: grid; place-items: center; color: rgb(var(--c)); background: rgba(var(--c), .15); box-shadow: inset 0 0 0 1px rgba(var(--c), .3); }
      .ht { flex: 1; min-width: 0; }
      .title { font-size: 16px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sub { font-size: 11.5px; color: var(--tx2); margin-top: 2px; }
      .ref { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: rgba(var(--ink),.06); color: var(--tx2); }
      .ref.spin ha-icon { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
      .tabs { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; }
      .tab { flex: 1 0 auto; min-width: 72px; display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 7px 10px; border-radius: 14px; background: rgba(var(--ink),.05); box-shadow: inset 0 0 0 1px rgba(var(--ink),.06); transition: background .25s, box-shadow .25s; }
      .tab span { font-size: 11px; font-weight: 700; color: var(--tx2); text-transform: uppercase; letter-spacing: .05em; }
      .tab b { font-size: 14px; font-weight: 800; color: rgb(var(--c)); font-variant-numeric: tabular-nums; }
      .tab.on { background: linear-gradient(180deg, rgba(var(--c), .3), rgba(var(--c), .12)); box-shadow: inset 0 0 0 1.5px rgba(var(--c), .7), 0 4px 14px -6px rgb(var(--c)); }
      .tab.on span { color: var(--hi); }

      .hero { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px 12px; padding: 12px; border-radius: 18px; background: linear-gradient(135deg, rgba(var(--c), .2), rgba(var(--c), .04)); box-shadow: inset 0 0 0 1px rgba(var(--c), .3); }
      .hero.none { display: flex; justify-content: center; color: var(--tx2); font-size: 13px; }
      .logo { flex: 0 0 34px; width: 34px; height: 34px; border-radius: 10px; background: #fff; display: grid; place-items: center; overflow: hidden; box-shadow: 0 2px 6px rgba(0,0,0,.35); }
      .logo.big { flex-basis: 54px; width: 54px; height: 54px; border-radius: 15px; }
      .logo img { width: 82%; height: 82%; object-fit: contain; }
      .ini { font-weight: 800; font-size: 12px; color: #1f2937; }
      .hi { flex: 1; min-width: 0; }
      .crown { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; color: rgb(var(--c)); }
      .crown ha-icon { --mdc-icon-size: 14px; }
      .hn { font-size: 15px; font-weight: 800; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .hs { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--tx2); margin-top: 1px; }
      .hb { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
      .hb .go { margin-left: auto; }
      .hb .chip .dot { margin-right: 3px; }
      .price { font-size: 30px; font-weight: 900; letter-spacing: -.02em; line-height: 1; color: var(--hi); font-variant-numeric: tabular-nums; text-shadow: 0 0 20px rgba(var(--c), .45); }
      .price small { font-size: .55em; vertical-align: top; margin-left: 1px; }
      .price u { text-decoration: none; font-size: .45em; font-weight: 700; margin-left: 3px; color: var(--tx2); }
            .chip { display: inline-flex; align-items: center; gap: 2px; padding: 2px 7px; border-radius: 8px; font-size: 10.5px; font-weight: 800; background: rgba(var(--ink),.08); color: var(--tx2); }
      .chip ha-icon { --mdc-icon-size: 13px; }
      .chip.down { color: rgb(74,222,128); background: rgba(74,222,128,.12); } .chip.up { color: rgb(248,113,113); background: rgba(248,113,113,.12); }
      .go { display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; border-radius: 10px; font-size: 11.5px; font-weight: 800; color: #fff; background: rgba(var(--c), .35); box-shadow: inset 0 0 0 1px rgba(var(--c), .6); }
      .go ha-icon { --mdc-icon-size: 15px; }

      .chart { padding: 6px 4px 0; }
      .chart svg { width: 100%; height: 70px; display: block; }
      .chart .min { fill: none; stroke: rgb(var(--c)); stroke-width: 2; vector-effect: non-scaling-stroke; }
      .chart .avg { fill: none; stroke: rgba(var(--ink),.45); stroke-width: 1.2; stroke-dasharray: 4 3; vector-effect: non-scaling-stroke; }
      .chart .pt { fill: #fff; stroke: rgb(var(--c)); stroke-width: 2; vector-effect: non-scaling-stroke; }
      .chart.nodata { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--tx2); padding: 8px 10px; border-radius: 12px; background: rgba(var(--ink),.04); }
      .leg { display: flex; justify-content: space-between; font-size: 10px; color: var(--tx2); }
      .leg i { display: inline-block; width: 12px; height: 3px; border-radius: 2px; vertical-align: middle; margin: 0 3px 0 8px; }
      .chart.cv .plot { position: relative; padding: 0 46px 0 40px; }
      .chart.cv .area { position: relative; touch-action: pan-y; cursor: crosshair; }
      .chart .grid { fill: none; stroke: rgba(var(--ink),.14); stroke-width: 1; stroke-dasharray: 2 3; vector-effect: non-scaling-stroke; }
      .yl, .ev { position: absolute; transform: translateY(-50%); font-size: 10px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; white-space: nowrap; }
      .yl { left: 0; width: 36px; text-align: right; color: var(--tx2); }
      .ev { right: 0; padding: 2px 4px; border-radius: 6px; }
      .ev.m { color: #fff; background: rgba(var(--c), .55); box-shadow: inset 0 0 0 1px rgba(var(--c), .8); }
      .ev.a { color: var(--tx2); background: rgba(var(--ink),.08); }
      .hov { display: none; position: absolute; inset: 0; pointer-events: none; }
      .hov .vl { position: absolute; top: 0; bottom: 12px; width: 1px; background: rgba(var(--ink),.35); }
      .hov .hd { position: absolute; width: 8px; height: 8px; border-radius: 50%; transform: translate(-50%, -50%); }
      .hov .hm { background: rgb(var(--c)); box-shadow: 0 0 0 2px #fff; }
      .hov .ha { background: rgba(var(--ink),.7); box-shadow: 0 0 0 2px rgba(0,0,0,.4); }
      .tip { position: absolute; top: -6px; display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; border-radius: 10px; background: rgba(15,23,32,.92); color: #fff; font-size: 11px; white-space: nowrap; box-shadow: 0 6px 18px rgba(0,0,0,.35); z-index: 2; }
      .tip b { font-size: 11px; }
      .tip i { display: inline-block; width: 10px; height: 3px; border-radius: 2px; vertical-align: middle; margin-right: 5px; }
      .tip .la { background: repeating-linear-gradient(90deg, rgba(255,255,255,.7) 0 3px, transparent 3px 5px); }
      .chart.cv .leg { padding: 0 46px 0 40px; }
      .stc { margin: 2px 0 8px; padding: 6px 4px 4px; border-radius: 12px; background: rgba(var(--ink),.04); cursor: default; }
      .stc .chart { padding-top: 4px; }
      .lm { background: rgb(var(--c)); } .la { background: repeating-linear-gradient(90deg, rgba(var(--ink),.5) 0 3px, transparent 3px 5px); }

      .sec { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 800; color: var(--tx2); text-transform: uppercase; letter-spacing: .05em; margin-top: 2px; }
      .sec ha-icon { --mdc-icon-size: 16px; color: rgb(var(--c)); }
      .sec span { margin-left: auto; text-transform: none; letter-spacing: 0; font-weight: 600; }
      .list { display: flex; flex-direction: column; gap: 6px; }
      .row { display: grid; grid-template-columns: 22px 34px 1fr auto; align-items: center; gap: 8px; padding: 8px 10px 8px 6px; border-radius: 14px; background: rgba(var(--ink),.04); box-shadow: inset 0 0 0 1px rgba(var(--ink),.05); cursor: pointer; transition: background .2s; }
      .row:hover { background: rgba(var(--ink),.07); }
      .row.first { box-shadow: inset 0 0 0 1px rgba(var(--c), .35); }
      .row.open { background: rgba(var(--c), .1); box-shadow: inset 0 0 0 1px rgba(var(--c), .5); }
      .rk { text-align: center; font-weight: 900; font-size: 13px; color: var(--tx2); }
      .row.first .rk { color: rgb(var(--c)); }
      .ri { min-width: 0; }
      .rn { display: flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .star { --mdc-icon-size: 14px; color: #facc15; flex: 0 0 auto; }
      .rs { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--tx2); margin-top: 1px; white-space: nowrap; overflow: hidden; }
      .dot { display: inline-block; flex: 0 0 7px; width: 7px; height: 7px; border-radius: 50%; }
      .dot.fresh { background: #4ade80; box-shadow: 0 0 5px #4ade80; } .dot.mid { background: #fbbf24; } .dot.old { background: #64748b; }
      .bar { height: 3px; border-radius: 2px; background: rgba(var(--ink),.07); margin-top: 5px; overflow: hidden; }
      .bar i { display: block; height: 100%; border-radius: 2px; background: linear-gradient(90deg, rgba(var(--c), .4), rgb(var(--c))); }
      .rp { text-align: right; font-size: 17px; font-weight: 900; font-variant-numeric: tabular-nums; line-height: 1.1; }
      .rp small { font-size: .6em; vertical-align: top; } .rp u { text-decoration: none; font-size: .55em; color: var(--tx2); margin-left: 2px; }
      .rp em { display: block; font-style: normal; font-size: 10.5px; font-weight: 700; color: rgb(248,113,113); }
      .rupt { font-size: 11px; font-weight: 800; color: #f87171; padding: 2px 6px; border-radius: 6px; background: rgba(248,113,113,.12); }
      .det { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 8px; padding: 6px 4px 2px 30px; animation: din .3s ease; }
      @keyframes din { from { opacity: 0; transform: translateY(-4px); } }
      .addr { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--tx2); }
      .addr ha-icon { --mdc-icon-size: 15px; }
      .fcs, .svs, .acts { display: flex; flex-wrap: wrap; gap: 5px; }
      .fc { display: inline-flex; gap: 5px; align-items: baseline; padding: 3px 8px; border-radius: 8px; font-size: 12px; background: rgba(var(--c), .14); box-shadow: inset 0 0 0 1px rgba(var(--c), .35); font-variant-numeric: tabular-nums; }
      .fc b { font-size: 10.5px; color: rgb(var(--c)); } .fc em { font-style: normal; color: #f87171; }
      .sv, .sv24 { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 8px; font-size: 11px; color: var(--tx2); background: rgba(var(--ink),.05); }
      .sv ha-icon, .sv24 ha-icon { --mdc-icon-size: 14px; }
      .sv24 { align-self: flex-start; color: #4ade80; background: rgba(74,222,128,.1); }
      .acts a { display: inline-flex; align-items: center; gap: 4px; padding: 6px 12px; border-radius: 10px; font-size: 12px; font-weight: 800; background: rgba(var(--ink),.08); }
      .acts ha-icon { --mdc-icon-size: 16px; }
      .none { padding: 10px; font-size: 12px; color: var(--tx2); text-align: center; }
      @container (max-width: 360px) { .price { font-size: 25px; } .logo.big { flex-basis: 44px; width: 44px; height: 44px; } .hero { gap: 9px; padding: 10px; } .rp { font-size: 15px; } }
      /* ---------- vue compacte ---------- */
      .cw { gap: 8px; padding: 10px 12px; }
      .chead { display: flex; align-items: center; gap: 8px; }
      .chead > ha-icon { --mdc-icon-size: 20px; color: rgb(var(--c)); }
      .ct { font-weight: 800; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .cpills { margin-left: auto; display: flex; gap: 3px; flex-wrap: wrap; justify-content: flex-end; }
      .cref { flex: 0 0 28px; width: 28px; height: 28px; }
      .cref ha-icon { --mdc-icon-size: 17px; }
      .chead .cpills + .cref, .chead .ct + .cref { margin-left: 4px; }
      .chead .ct + .cref { margin-left: auto; }
      .cp { padding: 3px 8px; border-radius: 8px; font-size: 10.5px; font-weight: 800; color: rgb(var(--c)); background: rgba(var(--c), .1); }
      .cp.on { color: #fff; background: rgba(var(--c), .55); box-shadow: 0 2px 8px -3px rgb(var(--c)); }
      .ctab { display: flex; flex-direction: column; border-radius: 12px; overflow: hidden; box-shadow: inset 0 0 0 1px rgba(var(--ink),.07); }
      .cth, .cr { display: grid; grid-template-columns: 30px 1fr auto 40px; align-items: center; gap: 8px; padding: 6px 8px; }
      .cth { font-size: 11px; font-weight: 800; color: var(--tx2); background: rgba(var(--ink),.05); }
      .cth span:nth-child(3), .cth span:nth-child(4), .cth .cs:nth-child(3), .cth .cs:nth-child(4) { text-align: right; }
      .cs { all: unset; cursor: pointer; font: inherit; color: inherit; } .cs:hover, .cs.on { color: rgb(var(--c)); }
      .cr { border-top: 1px solid rgba(var(--ink),.06); transition: background .2s; }
      .cr:hover { background: rgba(var(--c), .08); }
      .cr.clk { cursor: pointer; } .cr.ro, .row.ro { cursor: default; } .cr.ro:hover { background: none; } .row.ro:hover { background: rgba(var(--ink),.04); }
      .cr.open { background: rgba(var(--c), .10); }
      .cdet { display: flex; flex-direction: column; gap: 8px; padding: 4px 10px 10px 46px; animation: din .3s ease; }
      .mob { --mdc-icon-size: 13px; vertical-align: -2px; margin-right: 3px; color: rgb(var(--c)); }
      .clogo { width: 26px; height: 26px; border-radius: 8px; background: #fff; display: grid; place-items: center; overflow: hidden; }
      .clogo img { width: 84%; height: 84%; object-fit: contain; }
      .clogo .ini { font-size: 10px; }
      .cn { min-width: 0; display: flex; flex-direction: column; }
      .cn b { display: flex; align-items: center; gap: 3px; font-size: 12.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .cn small { font-size: 10.5px; color: var(--tx2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .cpz { display: flex; align-items: center; gap: 5px; justify-content: flex-end; font-size: 13px; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .cdot { width: 9px; height: 9px; border-radius: 50%; background: transparent; }
      .cdot.g { background: #4ade80; box-shadow: 0 0 6px #4ade80; } .cdot.r { background: #f87171; box-shadow: 0 0 6px #f87171; }
      .cj { text-align: right; font-size: 11px; font-weight: 800; color: var(--tx2); }
      .cj.ok { color: #4ade80; } .cj.mid { color: #fbbf24; } .cj.old { color: #94a3b8; }
      @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
      /* ---------- thèmes : clair / couleurs du thème Home Assistant ---------- */
      :host([data-tone="light"]) ha-card { --ink: 15,23,42; --tx: #0f172a; --tx2: rgba(15,23,42,.62); --hi: #0f172a;
        background: linear-gradient(160deg, rgba(255,255,255,.96), rgba(241,245,249,.97)); box-shadow: 0 8px 26px rgba(15,23,42,.12), inset 0 1px 0 rgba(255,255,255,.8); }
      :host([data-tone="theme"]) ha-card { --tx: var(--primary-text-color); --tx2: var(--secondary-text-color); --hi: var(--primary-text-color);
        background: var(--ha-card-background, var(--card-background-color)); }
      :host([data-tone="theme"][data-dark="0"]) ha-card { --ink: 15,23,42; }
      :host([data-tone="light"]) .price, :host([data-tone="theme"][data-dark="0"]) .price { text-shadow: none; }
      :host([data-tone="light"]) .go, :host([data-tone="light"]) .cp.on, :host([data-tone="theme"][data-dark="0"]) .go, :host([data-tone="theme"][data-dark="0"]) .cp.on { background: rgb(var(--c)); }
      :host([data-tone="light"]) .logo, :host([data-tone="light"]) .clogo, :host([data-tone="theme"][data-dark="0"]) .logo, :host([data-tone="theme"][data-dark="0"]) .clogo { box-shadow: 0 0 0 1px rgba(15,23,42,.1); }
      :host([data-tone="light"]) .amb { opacity: .6; }
`;
    }
  }

  class HolmFuelCardEditor extends HTMLElement {
    setConfig(config) {
      this._config = { ...config };
      if (this._form) this._form.data = this._config;
    }
    set hass(hass) {
      this._hass = hass;
      if (!this._form) this._build();
      else this._form.hass = hass;
    }
    async _build() {
      let zones = [];
      try { zones = (await this._hass.callWS({ type: "carburant_holm/data", history_days: 1 })).zones || []; } catch (e) { /* */ }
      const fuels = [];
      zones.forEach((z) => z.fuels.forEach((f) => { if (!fuels.some((x) => x.value === f.key)) fuels.push({ value: f.key, label: f.label }); }));
      const f = document.createElement("ha-form");
      f.hass = this._hass;
      f.schema = [
        { name: "entry_ids", selector: { select: { multiple: true, mode: "list", options: zones.map((z) => ({ value: z.entry_id, label: z.title + (z.mobile ? " (mobile)" : "") })) } } },
        { name: "layout", selector: { select: { mode: "list", options: [{ value: "full", label: "Complète (meilleur prix, tendance, classement)" }, { value: "compact", label: "Compacte (tableau des stations)" }] } } },
        { name: "title", selector: { text: {} } },
        { name: "theme", selector: { select: { mode: "dropdown", options: [{ value: "auto", label: "Automatique (suit le mode clair / sombre)" }, { value: "dark", label: "Sombre" }, { value: "light", label: "Clair" }, { value: "theme", label: "Couleurs de mon thème Home Assistant" }] } } },
        { type: "grid", name: "", schema: [
          { name: "fuel", selector: { select: { mode: "dropdown", options: fuels } } },
          { name: "rows", selector: { number: { min: 3, max: 20, mode: "box" } } },
        ] },
        { name: "fuels", selector: { select: { multiple: true, mode: "list", options: fuels } } },
        { name: "sort", selector: { select: { mode: "dropdown", options: [{ value: "default", label: "Classement, puis mes favorites (par défaut)" }, { value: "price", label: "Prix le plus bas d'abord (tout mélangé)" }, { value: "distance", label: "Plus proche d'abord" }, { value: "updated", label: "Mise à jour la plus récente d'abord" }, { value: "name", label: "Nom (A → Z)" }] } } },
        { name: "station_click", selector: { select: { mode: "dropdown", options: [{ value: "details", label: "Afficher le détail de la station" }, { value: "maps", label: "Ouvrir l'itinéraire (Google Maps)" }, { value: "none", label: "Rien (lecture seule, aucun lien)" }] } } },
        { type: "grid", name: "", schema: [{ name: "show_chart", selector: { boolean: {} } }, { name: "chart_values", selector: { boolean: {} } }, { name: "show_favorites", selector: { boolean: {} } }, { name: "favorites_only", selector: { boolean: {} } }] },
      ];
      const L = { sort: "Tri des stations", entry_ids: "Zones (une ou plusieurs, réunies dans la carte)", station_click: "Clic sur une station", entry_id: "Zone", title: "Titre (optionnel)", fuel: "Carburant affiché par défaut", rows: "Stations dans le classement", fuels: "Onglets carburants (vide = tous)", show_chart: "Courbe de tendance", chart_values: "Valeurs sur la courbe", show_favorites: "Afficher mes favorites", layout: "Présentation", theme: "Apparence", favorites_only: "Compacte : uniquement mes favorites" };
      f.computeLabel = (s) => L[s.name] || s.name;
      const cfg0 = { ...this._config };
      if (!cfg0.entry_ids && cfg0.entry_id) cfg0.entry_ids = [cfg0.entry_id];
      f.data = { layout: "full", theme: "auto", rows: 6, show_chart: true, chart_values: true, show_favorites: true, station_click: cfg0.layout === "compact" ? "maps" : "details", ...cfg0 };
      f.addEventListener("value-changed", (e) => {
        this._config = { ...e.detail.value };
        delete this._config.entry_id;
        if (!this._config.entry_ids || !this._config.entry_ids.length) delete this._config.entry_ids;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: JSON.parse(JSON.stringify(this._config)) }, bubbles: true, composed: true }));
      });
      this._form = f;
      this.appendChild(f);
    }
  }

  if (!customElements.get("holm-fuel-card")) customElements.define("holm-fuel-card", HolmFuelCard);
  if (!customElements.get("holm-fuel-card-editor")) customElements.define("holm-fuel-card-editor", HolmFuelCardEditor);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === "holm-fuel-card")) {
    window.customCards.push({ type: "holm-fuel-card", name: "HOLM Carburant", description: "Prix des carburants autour de chez vous : meilleur prix, tendance, classement et favorites.", preview: false });
  }
  console.info(`%c HOLM-FUEL %c ${VERSION} `, "background:#f59e0b;color:#fff;border-radius:3px 0 0 3px", "background:#123;color:#fff;border-radius:0 3px 3px 0");
})();
