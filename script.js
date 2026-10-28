/* Nearby Bites
   This file finds nearby food places, checks hours, shows the map,
   and handles search, filters, favourites and buttons.
   Leaflet and opening_hours are loaded by index.html. */

(function () {
  "use strict";

  /* ---------- Config ---------- */
  // Map data servers we ask for nearby food spots. If the first is busy, we try the next one.
  const OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
  ];
  // The service that turns a typed address into a spot on the map.
  const NOMINATIM = "https://nominatim.openstreetmap.org/search";
  // A place counts as "closing soon" if it closes within this many minutes.
  const SOON_MIN = 30;
  // The types shown in the filter menu.
  const TYPES = [
    { id: "all", label: "Everything" },
    { id: "restaurant", label: "Restaurants" },
    { id: "fast_food", label: "Fast food" },
    { id: "cafe", label: "Cafés" },
    { id: "bakery", label: "Bakeries" },
    { id: "dessert", label: "Desserts" }
  ];
  // Friendly names for each type, shown on the cards.
  const TYPE_LABEL = { restaurant: "Restaurant", fast_food: "Fast food", cafe: "Café", bakery: "Bakery", dessert: "Desserts" };

  /* ---------- State ---------- */
  // Everything the page needs to remember while you use it (where you are, filters, favourites, and so on).
  const S = {
    lat: null, lon: null, label: "", region: { country_code: "ca", state: "Ontario" },
    places: [], cache: {}, radius: 2000, openOnly: true, type: "all",
    cuisines: new Set(), favOnly: false, view: "list", showAllCuisines: false,
    favs: new Set(), consent: null, map: null, markers: null, lastFocus: null
  };

  // Shortcut: $("something") grabs the element with id="something".
  const $ = (id) => document.getElementById(id);
  // Makes text safe to put on the page, so a place name can never break the layout.
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- Storage (only with consent) ---------- */
  // Saves something on this device, but only if the visitor accepted cookies.
  function store(key, val) {
    if (S.consent !== "yes") return;
    try { localStorage.setItem("nb-" + key, JSON.stringify(val)); } catch (e) {}
  }
  // Reads something saved on this device (returns nothing if it isn't there).
  function load(key) {
    try { const v = localStorage.getItem("nb-" + key); return v == null ? null : JSON.parse(v); } catch (e) { return null; }
  }
  // Runs when the visitor picks Accept or Decline on the cookie banner.
  // Accept: start saving favourites, distance and theme. Decline: delete anything saved.
  function setConsent(choice) {
    S.consent = choice;
    try { localStorage.setItem("nb-consent", JSON.stringify(choice)); } catch (e) {}
    if (choice === "yes") {
      store("favs", [...S.favs]);
      store("radius", S.radius);
      const t = document.documentElement.dataset.theme;
      if (t) store("theme", t);
    } else {
      try { ["favs", "radius", "theme"].forEach((k) => localStorage.removeItem("nb-" + k)); } catch (e) {}
    }
    $("cookie").hidden = true;
  }

  /* ---------- Toast ---------- */
  let toastTimer;
  // Shows a small message at the bottom of the screen for a few seconds.
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3200);
  }

  /* ---------- Geo helpers ---------- */
  // Works out how far apart two map points are, in metres.
  function distance(lat1, lon1, lat2, lon2) {
    const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  // Turns metres into friendly text like "650 m" or "2.4 km".
  function fmtDist(m) {
    if (m < 1000) return Math.round(m / 10) * 10 + " m";
    return (m / 1000).toFixed(m < 10000 ? 1 : 0) + " km";
  }
  // Turns a time into friendly text like "11:00 PM" (follows the visitor's own clock style).
  function fmtTime(d) { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }

  /* ---------- Opening hours ---------- */
  // Days in the order the map data uses: Monday first.
  const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  // Reads opening hours written like "Mo-Fr 08:00-22:00; Sa 10:00-18:00"
  // and turns them into a list of open times for each day of the week.
  // Returns null if the hours are written in a way it doesn't understand.
  function parseSimpleHours(str) {
    const s = str.trim();
    if (s === "24/7") return { always: true };
    const week = [[], [], [], [], [], [], []];
    const rules = s.split(";").map((r) => r.trim()).filter(Boolean);
    for (const rule of rules) {
      const m = rule.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)(?:\s*,\s*(?:(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?))*)?\s*(.*)$/);
      if (!m) return null;
      const dayPart = m[1] || "Mo-Su";
      const timePart = m[2].trim();
      const days = new Set();
      let onlyPH = true;
      for (const piece of dayPart.split(",").map((p) => p.trim())) {
        if (piece === "PH") continue;
        onlyPH = false;
        const [a, b] = piece.split("-");
        const ia = DAYS.indexOf(a), ib = b ? DAYS.indexOf(b) : ia;
        if (ia < 0 || ib < 0) return null;
        for (let i = ia; ; i = (i + 1) % 7) { days.add(i); if (i === ib) break; }
      }
      if (onlyPH) continue; // holiday-only rules are ignored by the simple parser
      let intervals = [];
      if (/^(off|closed)$/i.test(timePart)) {
        intervals = [];
      } else {
        for (const span of timePart.split(",").map((p) => p.trim())) {
          const t = span.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\+?$/);
          if (!t) return null;
          const start = +t[1] * 60 + +t[2];
          let end = +t[3] * 60 + +t[4];
          if (end <= start) end += 1440; // runs past midnight
          intervals.push([start, end]);
        }
      }
      days.forEach((d) => (week[d] = intervals)); // later rules override earlier ones
    }
    if (week.every((d) => d.length === 1 && d[0][0] === 0 && d[0][1] >= 1440)) return { always: true };
    return { week };
  }
  // Uses those daily open times to decide: is it open right now, and if so, when does it close?
  // It also checks yesterday, for places open past midnight (like 6pm to 2am).
  function simpleStatus(parsed, now) {
    if (parsed.always) return { state: "open", always: true, closesAt: null };
    const day = (now.getDay() + 6) % 7;
    const mins = now.getHours() * 60 + now.getMinutes();
    const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
    const at = (base, addMin) => new Date(base.getTime() + addMin * 60000);
    for (const [s, e] of parsed.week[day]) {
      if (mins >= s && mins < e) return { state: "open", closesAt: at(midnight, e) };
    }
    const yday = (day + 6) % 7;
    for (const [s, e] of parsed.week[yday]) {
      if (e > 1440 && mins < e - 1440) return { state: "open", closesAt: at(midnight, e - 1440) };
    }
    return { state: "closed", closesAt: null };
  }
  // The main "is it open?" check. First tries the opening-hours library (handles holidays and
  // unusual formats), then falls back to our simple reader above. Gives back open, closed or unknown.
  function hoursStatus(raw, lat, lon, now) {
    if (!raw) return { state: "unknown" };
    if (window.opening_hours) {
      try {
        const oh = new window.opening_hours(raw, { lat, lon, address: S.region });
        if (oh.getUnknown(now)) return { state: "unknown" };
        const open = oh.getState(now);
        const next = oh.getNextChange(now);
        if (open && !next) return { state: "open", always: true, closesAt: null };
        return { state: open ? "open" : "closed", closesAt: open ? next : null };
      } catch (e) { /* fall through to simple parser */ }
    }
    const parsed = parseSimpleHours(raw);
    if (!parsed) return { state: "unknown" };
    return simpleStatus(parsed, now);
  }
  // Builds the little coloured tag on each card: "Open till 11pm", "Closing in 20 min", "Closed"...
  function statusPill(st, now) {
    if (st.state === "open") {
      if (st.always) return '<span class="pill s-open">Open 24 hours</span>';
      if (st.closesAt) {
        const left = Math.round((st.closesAt - now) / 60000);
        if (left <= SOON_MIN) return `<span class="pill s-soon">Closing in ${Math.max(left, 1)} min</span>`;
        return `<span class="pill s-open">Open till ${esc(fmtTime(st.closesAt))}</span>`;
      }
      return '<span class="pill s-open">Open now</span>';
    }
    if (st.state === "closed") return '<span class="pill s-closed">Closed</span>';
    return '<span class="pill s-unknown">Hours unknown</span>';
  }

  /* ---------- Data ---------- */
  // Sorts each place into one of our types (restaurant, fast food, café, bakery, dessert).
  function placeType(tags) {
    const a = tags.amenity, sh = tags.shop;
    if (sh === "bakery" || sh === "pastry") return "bakery";
    if (a === "ice_cream") return "dessert";
    if (a === "fast_food" || a === "food_court") return "fast_food";
    if (a === "cafe") return "cafe";
    return "restaurant";
  }
  // Tidies cuisine names from the map data, e.g. "middle_eastern" becomes "Middle eastern".
  function niceCuisine(c) {
    const s = c.trim().toLowerCase().replace(/_/g, " ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  // Turns one raw result from the map data into a tidy place object the page can use.
  // Skips anything without a name or a location.
  function normalize(el) {
    const tags = el.tags || {};
    const lat = el.lat != null ? el.lat : el.center && el.center.lat;
    const lon = el.lon != null ? el.lon : el.center && el.center.lon;
    if (lat == null || !tags.name) return null;
    const cuisines = (tags.cuisine || "").split(/[;,]/).map((c) => c.trim()).filter(Boolean).map(niceCuisine);
    return {
      id: el.type + "/" + el.id, name: tags.name, lat, lon, tags,
      type: placeType(tags), cuisines,
      dist: distance(S.lat, S.lon, lat, lon)
    };
  }
  // Remember searches already in progress so we do not ask twice.
  const pendingSearches = new Map();

  // Asks the map data servers for every food spot within `radius` metres of you.
  // Results are remembered, so switching back to a distance you already loaded is instant.
  async function fetchPlaces(radius, timeoutMs) {
    const key = `${S.lat.toFixed(4)},${S.lon.toFixed(4)},${radius}`;
    if (S.cache[key]) return S.cache[key];
    if (pendingSearches.has(key)) return pendingSearches.get(key);
    const search = searchPlaces(radius, timeoutMs, key);
    pendingSearches.set(key, search);
    try { return await search; }
    finally { pendingSearches.delete(key); }
  }

  async function searchPlaces(radius, timeoutMs, key) {
    const around = `(around:${radius},${S.lat},${S.lon})`;
    // Food places as points or buildings, with just the details we use (tags + centre point).
    const q = `[out:json][timeout:25];(nw["amenity"~"^(restaurant|fast_food|cafe|food_court|ice_cream)$"]["name"]${around};nw["shop"~"^(bakery|pastry)$"]["name"]${around};);out center tags;`;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const reasons = [];
    // Ask one server. If it says "too many requests" (429), wait a few seconds and ask once more.
    const askServer = async (url) => {
      const host = new URL(url).host;
      for (let attempt = 0; attempt < 2; attempt++) {
        let res;
        try {
          res = await fetchWithTimeout(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } }, timeoutMs || 30000);
        } catch (e) {
          reasons.push(`${host}: ${e.message === "Request timed out" ? "too slow" : "couldn't connect"}`);
          throw e;
        }
        if (res.status === 429 && attempt === 0) { await wait(4000); continue; }
        if (!res.ok) {
          reasons.push(`${host}: ${res.status === 429 ? "too many requests" : res.status === 504 ? "server busy" : "error " + res.status}`);
          throw new Error("HTTP " + res.status);
        }
        const json = await res.json();
        if (!json.elements) { reasons.push(`${host}: empty answer`); throw new Error("empty"); }
        return json;
      }
    };
    // Gentle race: start with the main server, then bring in one more server every 5 seconds
    // (or right away if one fails). The first good answer wins. This avoids flooding the free servers.
    const json = await new Promise((resolve, reject) => {
      let next = 0, failed = 0, done = false, timer;
      const launch = () => {
        clearTimeout(timer);
        if (done || next >= OVERPASS.length) return;
        const url = OVERPASS[next++];
        askServer(url).then((j) => { if (!done) { done = true; clearTimeout(timer); resolve(j); } })
          .catch((e) => {
            console.warn("Map data server failed:", url, e);
            failed++;
            if (failed >= OVERPASS.length && !done) { done = true; reject(new Error(reasons.join(" · ") || "No map server answered")); }
            else launch();
          });
        // Try a backup sooner if the first free server is slow.
        timer = setTimeout(launch, 2200);
      };
      launch();
    });
    // Tidy the results and drop duplicates (same name at the same spot).
    const seen = new Set();
    const list = json.elements.map(normalize).filter((p) => {
      if (!p) return false;
      const k = p.name.toLowerCase() + "|" + p.lat.toFixed(4) + "|" + p.lon.toFixed(4);
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    S.cache[key] = list;
    return list;
  }
  // Timeout without AbortController: some previews (like VS Code's) relay fetch and can't pass abort signals.
  // Like a normal web request, but gives up after `ms` milliseconds so nothing hangs forever.
  function fetchWithTimeout(url, opts, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Request timed out")), ms || 12000);
    });
    return Promise.race([fetch(url, opts || {}), timeout]).finally(() => clearTimeout(timer));
  }
  // Looks up a typed address with the main address service.
  async function geocodeNominatim(q) {
    const url = `${NOMINATIM}?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(q)}`;
    const res = await fetchWithTimeout(url, {}, 8000);
    if (!res.ok) throw new Error("Nominatim HTTP " + res.status);
    const data = await res.json();
    if (!data.length) return null;
    const r = data[0];
    const parts = r.display_name.split(",").map((s) => s.trim());
    return {
      lat: +r.lat, lon: +r.lon,
      label: parts.slice(0, 2).join(", "),
      region: r.address ? { country_code: r.address.country_code || "ca", state: r.address.state || "" } : null
    };
  }
  // Backup address service (Photon, also built on OpenStreetMap data).
  // Same idea, using the backup address service.
  async function geocodePhoton(q) {
    const url = `https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(q)}`;
    const res = await fetchWithTimeout(url, {}, 8000);
    if (!res.ok) throw new Error("Photon HTTP " + res.status);
    const data = await res.json();
    const f = data.features && data.features[0];
    if (!f) return null;
    const pr = f.properties || {};
    const street = [pr.housenumber, pr.street].filter(Boolean).join(" ");
    return {
      lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
      label: [pr.name || street, pr.city || pr.district].filter(Boolean).join(", ") || q,
      region: { country_code: (pr.countrycode || "ca").toLowerCase(), state: pr.state || "" }
    };
  }
  // Tries the main address service first, and the backup if that fails.
  async function geocode(q) {
    let firstErr = null;
    try { const r = await geocodeNominatim(q); if (r) return r; }
    catch (e) { firstErr = e; console.warn("Address lookup (Nominatim) failed:", e); }
    try { return await geocodePhoton(q); }
    catch (e) { console.warn("Address lookup (Photon) failed:", e); throw firstErr || e; }
  }

  /* ---------- Flow ---------- */
  // Goes back to the start screen (used by the logo and the Change button).
  function showHome() {
    $("results").hidden = true; $("home").hidden = false; $("where").hidden = true;
    closeSheet(); window.scrollTo(0, 0);
    setTimeout(() => $("addr").focus(), 50);
  }
  // Shows (or clears) the red error message on the start screen.
  function homeError(msg) { const e = $("homeErr"); e.textContent = msg; e.hidden = !msg; }

  // Called once we know where you are: resets filters, switches to the results screen and loads food spots.
  async function startAt(lat, lon, label) {
    S.lat = lat; S.lon = lon; S.label = label;
    S.cuisines.clear(); S.type = "all"; S.favOnly = false;
    resetFurther();
    $("whereLabel").textContent = label;
    $("where").hidden = false; $("home").hidden = true; $("results").hidden = false;
    window.scrollTo(0, 0);
    await loadRadius(S.radius, true);
  }

  // We always load everything within 5 km in ONE request. The 1 / 2 / 5 km buttons then just filter
  // what's already loaded, so switching distance is instant.
  const BASE_R = 5000;

  // Changes the distance. Instant if the spots are already loaded.
  function setRadius(radius) {
    S.radius = radius; store("radius", radius); syncSeg();
    if (S.places.length || S.loaded) render();
  }

  // Loads every food spot within 5 km and shows a spinner meanwhile.
  // If autoWiden is on and fewer than 3 places are open at the chosen distance, it widens by itself (no extra waiting).
  async function loadRadius(radius, autoWiden) {
    S.radius = radius; syncSeg(); S.loaded = false; S.places = [];
    $("list").innerHTML = ""; $("unknownBox").hidden = true; $("furtherBox").hidden = true; $("summary").textContent = "";
    $("state").innerHTML = '<div class="loading"><div class="spinner"></div><h3 id="loadTitle">Sniffing out food nearby…</h3><p id="loadSub">Checking who\'s open right now.</p></div>';
    // If it's taking a while, tell the visitor why so it doesn't feel stuck.
    const slow1 = setTimeout(() => { const t = $("loadSub"); if (t) t.textContent = "The free map servers are a bit busy right now, hang tight…"; }, 6000);
    const slow2 = setTimeout(() => { const t = $("loadSub"); if (t) t.textContent = "Still working on it. Busy times can take up to half a minute."; }, 15000);
    try {
      // Reuse an earlier search for this location when available.
      const list = await fetchPlaces(BASE_R);
      S.places = list; S.loaded = true;
      if (autoWiden) {
        const now = new Date();
        const openWithin = (r) => list.filter((p) => p.dist <= r && hoursStatus(p.tags.opening_hours, p.lat, p.lon, now).state === "open").length;
        let r = radius;
        while (r < BASE_R && openWithin(r) < 3) r = r < 2000 ? 2000 : BASE_R;
        if (r !== radius) {
          toast(`Not much open within ${radius / 1000} km, showing ${r / 1000} km`);
          S.radius = r; syncSeg();
        }
      }
      store("radius", S.radius);
      $("state").innerHTML = "";
      render();
    } catch (e) {
      console.error("Loading food spots failed:", e);
      $("state").innerHTML = `<div class="empty"><h3>Couldn't reach the map data</h3>
        <p>The free map servers are busy or asked us to slow down. Wait about 30 seconds, then try again.</p>
        <p class="loc-note">Details: ${esc(e.message)}</p>
        <button class="btn primary" type="button" id="retryBtn">Try again</button></div>`;
      $("retryBtn").onclick = () => loadRadius(radius, false);
    } finally {
      clearTimeout(slow1); clearTimeout(slow2);
    }
  }

  /* ---------- Rendering ---------- */
  // Applies every filter (distance, type, cuisine, favourites) and sorts by closest first.
  // Also works out each place's open/closed status at the current time.
  function filtered(list, minDist, maxDist) {
    const now = new Date();
    list = list || S.places;
    minDist = minDist == null ? -1 : minDist;
    maxDist = maxDist == null ? S.radius : maxDist;
    return list
      .map((p) => Object.assign(p, { st: hoursStatus(p.tags.opening_hours, p.lat, p.lon, now) }))
      .filter((p) => p.dist > minDist && p.dist <= maxDist)
      .filter((p) => S.type === "all" || p.type === S.type)
      .filter((p) => !S.cuisines.size || p.cuisines.some((c) => S.cuisines.has(c)))
      .filter((p) => !S.favOnly || S.favs.has(p.id))
      .sort((a, b) => a.dist - b.dist);
  }

  // Small drawings used as the picture on each card, one per type.
  const ICONS = {
    restaurant: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5a2 2 0 0 0 2 2M9 3v5a2 2 0 0 1-2 2M17 21V3c-2 1-3 4-3 7h3"/></svg>',
    fast_food: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a8 6 0 0 1 16 0Z"/><path d="M3 14h18"/><path d="M4 17h16a0 0 0 0 1 0 0 3 3 0 0 1-3 3H7a3 3 0 0 1-3-3Z"/></svg>',
    cafe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3M12 3v3"/></svg>',
    bakery: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15c0-5 3.5-9 8-9s8 4 8 9v3H4Z"/><path d="M9 7.5 10 18M15 7.5 14 18"/></svg>',
    dessert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10a5 5 0 0 1 10 0Z"/><path d="M7 10l5 11 5-11"/></svg>'
  };
  // The heart drawing for the favourite button.
  const HEART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/></svg>';

  // Builds the HTML for one place card in the list.
  function cardHTML(p, now) {
    const meta = [p.cuisines.slice(0, 2).join(", "), TYPE_LABEL[p.type]].filter(Boolean).join(" · ");
    const fav = S.favs.has(p.id);
    return `<li class="card" data-id="${esc(p.id)}">
      <div class="badge t-${p.type}" aria-hidden="true">${ICONS[p.type]}</div>
      <div class="card-main">
        <h3 class="card-title"><button type="button" data-open="${esc(p.id)}">${esc(p.name)}</button></h3>
        <p class="card-meta">${esc(meta)}</p>
        ${statusPill(p.st, now)}
      </div>
      <div class="card-side">
        <span class="dist">${fmtDist(p.dist)}</span>
        <button class="fav-btn" type="button" data-fav="${esc(p.id)}" aria-pressed="${fav}" aria-label="${fav ? "Remove from" : "Save to"} favourites">${HEART}</button>
      </div>
    </li>`;
  }

  // Redraws the results: the summary line, the list of cards, the "hours unknown" section,
  // the map (if map view is on) and the "further away" section. Runs after every change.
  function render() {
    const now = new Date();
    const all = filtered();
    let shown, unknown = [];
    if (S.openOnly) {
      shown = all.filter((p) => p.st.state === "open");
      unknown = all.filter((p) => p.st.state === "unknown");
    } else {
      shown = all;
    }
    S.shown = shown; S.unknown = unknown;

    renderFilters();

    const filtersOn = S.type !== "all" || S.cuisines.size || S.favOnly;
    $("summary").innerHTML = shown.length
      ? `<strong>${shown.length}</strong> ${S.openOnly ? "open now" : "spots"} within ${S.radius / 1000} km${filtersOn ? " matching your filters" : ""}`
      : "";

    if (!shown.length) {
      $("list").innerHTML = "";
      $("state").innerHTML = `<div class="empty"><h3>${S.favOnly && !S.favs.size ? "No favourites yet" : "Nothing open that matches"}</h3>
        <p>${S.favOnly && !S.favs.size ? "Tap the heart on any spot to save it here." : "Try clearing filters, turning off “Open now”, or searching a wider area."}</p>
        ${filtersOn ? '<button class="btn primary" type="button" id="emptyClear">Clear filters</button>' : (S.radius < 5000 ? '<button class="btn primary" type="button" id="emptyWiden">Search 5 km</button>' : '<button class="btn primary" type="button" id="emptyFurther">Look further away</button>')}</div>`;
      const c = $("emptyClear"); if (c) c.onclick = clearFilters;
      const w = $("emptyWiden"); if (w) w.onclick = () => setRadius(5000);
      const f = $("emptyFurther"); if (f) f.onclick = () => { openFurther(); $("furtherBox").scrollIntoView({ behavior: "smooth", block: "start" }); };
    } else {
      $("state").innerHTML = "";
      $("list").innerHTML = shown.map((p) => cardHTML(p, now)).join("");
    }

    if (unknown.length) {
      $("unknownBox").hidden = false;
      $("unknownSummary").textContent = `${unknown.length} more nearby with hours unknown`;
      $("unknownList").innerHTML = unknown.map((p) => cardHTML(p, now)).join("");
    } else {
      $("unknownBox").hidden = true;
      $("unknownList").innerHTML = "";
    }

    $("list").hidden = S.view === "map";
    $("map").hidden = S.view !== "map";
    if (S.view === "map") renderMap();
    renderFurther();
  }

  /* ---------- Further away (beyond the chosen distance, up to 10 km) ---------- */
  // How far the "Further away" section looks, in metres (10 km).
  const FURTHER_R = 10000;
  // Forgets the further-away results (used when you search a new location).
  function resetFurther() {
    S.further = null; S.furtherLoading = false; S.furtherOpen = false; S.furtherN = 20; S.furtherErr = false;
  }
  resetFurther();

  // Loads spots up to 10 km away. Only happens when you open the "Further away" section.
  async function loadFurther() {
    if (S.further || S.furtherLoading) return;
    S.furtherLoading = true; S.furtherErr = false; renderFurther();
    const at = `${S.lat},${S.lon}`;
    try {
      const list = await fetchPlaces(FURTHER_R, 40000);
      if (`${S.lat},${S.lon}` !== at) return; // location changed meanwhile
      S.further = list;
    } catch (e) {
      console.warn("Further-away search failed:", e);
      S.furtherErr = true;
    } finally {
      S.furtherLoading = false;
      renderFurther();
    }
  }

  // Draws the "Further away" section: spinner while loading, then the places beyond your chosen distance,
  // 20 at a time with a "Show more" button.
  function renderFurther() {
    const box = $("furtherBox");
    if (S.radius >= FURTHER_R || !S.loaded) { box.hidden = true; return; }
    box.hidden = false;
    $("furtherSub").textContent = `Spots beyond ${S.radius / 1000} km, up to ${FURTHER_R / 1000} km`;
    $("furtherBtn").setAttribute("aria-expanded", S.furtherOpen);
    $("furtherChip").setAttribute("aria-pressed", S.furtherOpen);
    $("furtherBody").hidden = !S.furtherOpen;
    if (!S.furtherOpen) return;

    const st = $("furtherState"), ul = $("furtherList"), more = $("furtherMore");
    if (S.furtherLoading) {
      st.innerHTML = '<div class="loading"><div class="spinner"></div><h3>Looking a little further…</h3><p>Bigger area, so this can take a few seconds.</p></div>';
      ul.innerHTML = ""; more.hidden = true; return;
    }
    if (S.furtherErr) {
      st.innerHTML = '<div class="empty"><h3>Couldn\'t load spots further away</h3><p>The map servers might be busy.</p><button class="btn primary" type="button" id="furtherRetry">Try again</button></div>';
      $("furtherRetry").onclick = loadFurther;
      ul.innerHTML = ""; more.hidden = true; return;
    }
    if (!S.further) { ul.innerHTML = ""; more.hidden = true; return; }

    const now = new Date();
    const all = filtered(S.further, S.radius, FURTHER_R);
    const list = S.openOnly ? all.filter((p) => p.st.state === "open") : all;
    if (!list.length) {
      st.innerHTML = `<div class="empty"><h3>Nothing further out either</h3><p>No ${S.openOnly ? "open " : ""}spots between ${S.radius / 1000} and ${FURTHER_R / 1000} km match your filters.</p></div>`;
      ul.innerHTML = ""; more.hidden = true; return;
    }
    st.innerHTML = `<p class="summary"><strong>${list.length}</strong> more ${S.openOnly ? "open now" : "spots"} between ${S.radius / 1000} and ${FURTHER_R / 1000} km</p>`;
    ul.innerHTML = list.slice(0, S.furtherN).map((p) => cardHTML(p, now)).join("");
    more.hidden = list.length <= S.furtherN;
    more.textContent = `Show more (${list.length - S.furtherN} left)`;
  }

  // Opens the "Further away" section and starts loading it.
  function openFurther() {
    S.furtherOpen = true; renderFurther(); loadFurther();
  }

  // Redraws the filter menu: the type options and the cuisine list, each with how many places match.
  // Cuisines are built from what's actually nearby, most common first.
  function renderFilters() {
    const now = new Date();
    const base = S.places.filter((p) => p.dist <= S.radius && (!S.openOnly || hoursStatus(p.tags.opening_hours, p.lat, p.lon, now).state !== "closed"));
    const typeCounts = { all: base.length };
    base.forEach((p) => (typeCounts[p.type] = (typeCounts[p.type] || 0) + 1));
    $("typeList").innerHTML = TYPES.filter((t) => t.id === "all" || typeCounts[t.id])
      .map((t) => `<button class="opt" type="button" data-type="${t.id}" aria-pressed="${S.type === t.id}"><span>${t.label}</span><span class="count">${typeCounts[t.id] || 0}</span></button>`).join("");

    const cc = {};
    base.filter((p) => S.type === "all" || p.type === S.type).forEach((p) => p.cuisines.forEach((c) => (cc[c] = (cc[c] || 0) + 1)));
    const sorted = Object.entries(cc).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    S.cuisines.forEach((c) => { if (!cc[c]) sorted.push([c, 0]); });
    const LIMIT = 12;
    const list = S.showAllCuisines ? sorted : sorted.slice(0, LIMIT);
    $("cuisineList").innerHTML = list.length
      ? list.map(([c, n]) => `<button class="opt" type="button" data-cuisine="${esc(c)}" aria-pressed="${S.cuisines.has(c)}"><span>${esc(c)}</span><span class="count">${n}</span></button>`).join("")
      : '<p class="loc-note">No cuisine info nearby.</p>';
    $("moreCuisine").hidden = sorted.length <= LIMIT;
    $("moreCuisine").textContent = S.showAllCuisines ? "Show fewer" : `Show all ${sorted.length} cuisines`;

    $("favOnly").setAttribute("aria-pressed", S.favOnly);
    $("favCount").textContent = S.favs.size;
  }

  // Highlights the currently chosen distance and view (list or map) buttons.
  function syncSeg() {
    document.querySelectorAll("[data-r]").forEach((b) => b.setAttribute("aria-pressed", +b.dataset.r === S.radius));
    document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.view === S.view));
  }

  /* ---------- Map ---------- */
  // Draws the map: a dot for you, and a coloured dot for each place (green open, pink closing soon).
  // The map library only loads its tiles the first time map view is opened.
  function renderMap() {
    if (!window.L) { toast("The map is still loading, try again in a moment"); return; }
    const css = getComputedStyle(document.documentElement);
    const cOpen = css.getPropertyValue("--open").trim();
    const cSoon = css.getPropertyValue("--soon").trim();
    const cMuted = css.getPropertyValue("--closed").trim();
    if (!S.map) {
      S.map = L.map("map", { zoomControl: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(S.map);
      S.markers = L.layerGroup().addTo(S.map);
    }
    S.markers.clearLayers();
    L.marker([S.lat, S.lon], { icon: L.divIcon({ className: "", html: '<div class="you-dot"></div>', iconSize: [18, 18] }), title: "You are here" }).addTo(S.markers);
    const now = new Date();
    const pts = [[S.lat, S.lon]];
    [...S.shown, ...S.unknown].forEach((p) => {
      let color = cMuted;
      if (p.st.state === "open") color = p.st.closesAt && (p.st.closesAt - now) / 60000 <= SOON_MIN ? cSoon : cOpen;
      L.circleMarker([p.lat, p.lon], { radius: 8, color: "#fff", weight: 2, fillColor: color, fillOpacity: 0.95 })
        .bindTooltip(p.name)
        .on("click", () => openSheet(p.id))
        .addTo(S.markers);
      pts.push([p.lat, p.lon]);
    });
    setTimeout(() => {
      S.map.invalidateSize();
      if (pts.length > 1) S.map.fitBounds(pts, { padding: [30, 30], maxZoom: 17 });
      else S.map.setView([S.lat, S.lon], 15);
    }, 30);
  }

  /* ---------- Details sheet ---------- */
  // Finds a place by its id, in the nearby list or the further-away list.
  function findPlace(id) {
    return S.places.find((p) => p.id === id) || (S.further || []).find((p) => p.id === id);
  }
  // Makes opening hours easier to read for the details card, e.g. "Mo" becomes "Mon".
  function prettyHours(raw) {
    const full = { Mo: "Mon", Tu: "Tue", We: "Wed", Th: "Thu", Fr: "Fri", Sa: "Sat", Su: "Sun", PH: "Holidays" };
    return raw.split(";").map((r) => r.trim()).filter(Boolean)
      .map((r) => r.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (m) => full[m]).replace(/\boff\b/gi, "closed"));
  }
  // Builds a readable street address from the map data, if it has one.
  function addressOf(t) {
    const line1 = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
    return [line1, t["addr:unit"] ? "Unit " + t["addr:unit"] : "", t["addr:city"], t["addr:postcode"]].filter(Boolean).join(", ");
  }
  // Cleans up a website link from the map data and makes sure it's a real web address.
  function safeUrl(u) {
    if (!u) return "";
    let s = u.trim().split(";")[0].trim();
    if (!/^https?:\/\//i.test(s)) s = "https://" + s;
    try { const url = new URL(s); return /^https?:$/.test(url.protocol) ? url.href : ""; } catch (e) { return ""; }
  }

  // Opens the details card for a place: directions, menu, call, website, Google info, hours and extras.
  // `picked` is true when "Pick for me" chose it, which adds the "Pick again" button.
  function openSheet(id, picked) {
    const p = findPlace(id);
    if (!p) return;
    if (!picked) S.lastFocus = document.activeElement;
    const now = new Date();
    const st = hoursStatus(p.tags.opening_hours, p.lat, p.lon, now);
    const t = p.tags;
    const phone = (t.phone || t["contact:phone"] || "").split(";")[0].trim();
    const website = safeUrl(t.website || t["contact:website"]);
    const menu = safeUrl(t["website:menu"] || t["contact:menu"] || t.menu_url || (t.menu && /^(https?:\/\/|www\.)/i.test(t.menu) ? t.menu : ""));
    const addr = addressOf(t);
    const gQuery = encodeURIComponent(p.name + " " + (addr || `${p.lat},${p.lon}`));
    const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`;
    const gmUrl = `https://www.google.com/maps/search/?api=1&query=${gQuery}`;
    const fav = S.favs.has(p.id);

    const chips = [];
    const yes = (v) => v === "yes" || v === "only";
    if (yes(t.takeaway)) chips.push("Takeout");
    if (yes(t.delivery)) chips.push("Delivery");
    if (yes(t.drive_through)) chips.push("Drive-through");
    if (yes(t.outdoor_seating)) chips.push("Outdoor seating");
    if (yes(t["diet:vegetarian"])) chips.push("Vegetarian options");
    if (yes(t["diet:vegan"])) chips.push("Vegan options");
    if (yes(t["diet:halal"])) chips.push("Halal");
    if (yes(t["diet:gluten_free"])) chips.push("Gluten-free options");
    if (t.wheelchair === "yes") chips.push("Wheelchair accessible");
    if (t.internet_access && t.internet_access !== "no") chips.push("Wi-Fi");

    const meta = [p.cuisines.join(", "), TYPE_LABEL[p.type], fmtDist(p.dist) + " away"].filter(Boolean).join(" · ");

    $("sheetBody").innerHTML = `
      ${picked ? '<span class="picked">Picked for you</span>' : ""}
      <h2 id="sheetTitle">${esc(p.name)}</h2>
      <p class="meta">${esc(meta)}</p>
      <div class="status-row">${statusPill(st, now)}</div>

      <div class="actions">
        <a class="btn primary" href="${dirUrl}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11 21 3l-8 18-2-8Z"/></svg>Directions</a>
        ${menu ? `<a class="btn warm" href="${esc(menu)}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h11a3 3 0 0 1 3 3v15H8a3 3 0 0 1-3-3Z"/><path d="M9 8h6M9 12h6"/></svg>Menu</a>` : ""}
        ${phone ? `<a class="btn" href="tel:${esc(phone.replace(/[^\d+]/g, ""))}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/></svg>Call</a>` : ""}
        ${website ? `<a class="btn" href="${esc(website)}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>Website</a>` : ""}
        <a class="btn" href="${gmUrl}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>Google info</a>
      </div>

      <dl class="info">
        ${addr ? `<div class="info-row"><dt>Address</dt><dd>${esc(addr)}</dd></div>` : ""}
        ${phone ? `<div class="info-row"><dt>Phone</dt><dd class="copy-row"><span>${esc(phone)}</span><button class="link-btn" type="button" id="copyPhone">Copy</button></dd></div>` : ""}
        ${t.opening_hours ? `<div class="info-row"><dt>Hours</dt><dd><ul class="hours-list">${prettyHours(t.opening_hours).map((h) => `<li>${esc(h)}</li>`).join("")}</ul></dd></div>` : `<div class="info-row"><dt>Hours</dt><dd>Not listed. Check “Google info” before heading over.</dd></div>`}
        ${chips.length ? `<div class="info-row"><dt>Good to know</dt><dd class="chips">${chips.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</dd></div>` : ""}
        ${!menu ? `<div class="info-row"><dt>Menu</dt><dd>No menu link listed${website ? ", try their website" : ", try “Google info”"}.</dd></div>` : ""}
      </dl>

      <div class="sheet-foot">
        <button class="btn small fav-toggle" type="button" id="sheetFav" aria-pressed="${fav}">${fav ? "Saved to favourites" : "Save to favourites"}</button>
        ${picked ? '<button class="btn small warm" type="button" id="pickAgain">Pick again</button>' : ""}
      </div>`;

    const cp = $("copyPhone");
    if (cp) cp.onclick = async () => {
      try { await navigator.clipboard.writeText(phone); toast("Phone number copied"); }
      catch (e) { toast("Couldn't copy, press and hold the number instead"); }
    };
    $("sheetFav").onclick = () => { toggleFav(p.id); openSheet(p.id, picked); };
    const again = $("pickAgain"); if (again) again.onclick = () => pickForMe(p.id);

    $("sheetWrap").hidden = false;
    document.documentElement.classList.add("locked");
    $("sheet").scrollTop = 0;
    $("sheetClose").focus();
  }

  // Closes the details card. The list underneath was never moved, so you're right where you left off.
  function closeSheet() {
    if ($("sheetWrap").hidden) return;
    $("sheetWrap").hidden = true;
    document.documentElement.classList.remove("locked");
    if (S.lastFocus && document.contains(S.lastFocus)) S.lastFocus.focus({ preventScroll: true });
  }

  /* ---------- Favourites ---------- */
  // Adds or removes a place from favourites, and updates its heart without redrawing the list.
  function toggleFav(id) {
    if (S.favs.has(id)) { S.favs.delete(id); toast("Removed from favourites"); }
    else { S.favs.add(id); toast(S.consent === "yes" ? "Saved to favourites" : "Saved for this visit (accept cookies to keep it)"); }
    store("favs", [...S.favs]);
    // Update hearts in place so the list doesn't jump.
    document.querySelectorAll(`[data-fav="${CSS.escape(id)}"]`).forEach((b) => {
      const on = S.favs.has(id);
      b.setAttribute("aria-pressed", on);
      b.setAttribute("aria-label", (on ? "Remove from" : "Save to") + " favourites");
    });
    $("favCount").textContent = S.favs.size;
    if (S.favOnly) render();
  }

  /* ---------- Pick for me ---------- */
  // "Pick for me": chooses a random open place from the 15 closest that match your filters.
  function pickForMe(excludeId) {
    let pool = (S.shown || []).filter((p) => p.st.state === "open");
    if (!pool.length) pool = (S.shown || []).concat(S.unknown || []);
    if (pool.length > 1 && excludeId) pool = pool.filter((p) => p.id !== excludeId);
    if (!pool.length) { toast("Nothing to pick from yet, try clearing filters"); return; }
    const near = pool.slice(0, 15); // already sorted by distance
    const choice = near[Math.floor(Math.random() * near.length)];
    if ($("sheetWrap").hidden) S.lastFocus = document.activeElement;
    openSheet(choice.id, true);
  }

  /* ---------- Filters ---------- */
  // Resets all filters back to "everything".
  function clearFilters() {
    S.type = "all"; S.cuisines.clear(); S.favOnly = false;
    render();
  }
  // Slides the filter menu in (phones and narrow screens).
  function openSide() { $("sidebar").classList.add("open"); $("backdrop").hidden = false; $("closeSide").focus(); }
  // Slides the filter menu back out.
  function closeSide() { $("sidebar").classList.remove("open"); $("backdrop").hidden = true; }

  /* ---------- Theme ---------- */
  // Switches between light and dark mode. No value means "follow the device setting".
  function applyTheme(t) {
    if (t) document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }
  // Tells us whether the page is currently showing dark mode.
  function currentDark() {
    const t = document.documentElement.dataset.theme;
    return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  }

  /* ---------- Events ---------- */
  // ----- Buttons and inputs -----
  // "Find food" button (or Enter in the address box): look up the address, then show results.
  $("addrForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    closeSuggest();
    const q = $("addr").value.trim();
    if (!q) { homeError("Type a street, neighbourhood or postal code first."); $("addr").focus(); return; }
    homeError("");
    const btn = $("addrGo"); btn.disabled = true; btn.textContent = "Searching…";
    try {
      const r = await geocode(q);
      if (!r) { homeError("We couldn't find that place. Try adding the city, like “Queen St W, Toronto”."); return; }
      if (r.region) S.region = r.region;
      await startAt(r.lat, r.lon, r.label);
    } catch (err) {
      console.error("Address search failed:", err);
      homeError(location.protocol === "file:"
        ? "The address search was blocked because the page is open as a file. Open it with Live Server (or from GitHub Pages) and try again."
        : "The address lookup didn't respond. Check your connection and try again.");
    } finally {
      btn.disabled = false; btn.textContent = "Find food";
    }
  });
  /* ---------- Address suggestions (Photon is built for search-as-you-type) ---------- */
  // Location pin drawing used in the address suggestions.
  const PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>';
  // What the suggestion dropdown remembers: current suggestions, which one is highlighted,
  // and a counter so older, slower answers don't replace newer ones.
  const SG = { items: [], active: -1, timer: null, req: 0 };

  // Turns one result from the suggestion service into a main line and a smaller second line.
  function suggestionFrom(f) {
    const pr = f.properties || {};
    const street = [pr.housenumber, pr.street].filter(Boolean).join(" ");
    const main = pr.name && pr.name !== street ? (street ? `${pr.name}, ${street}` : pr.name) : (street || pr.city || pr.county || "");
    const sub = [pr.district && pr.district !== main ? pr.district : "", pr.city && pr.city !== main ? pr.city : "", pr.state, pr.postcode, pr.country]
      .filter(Boolean).join(", ");
    return {
      main, sub,
      lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
      label: [main, pr.city && pr.city !== main ? pr.city : ""].filter(Boolean).join(", "),
      region: { country_code: (pr.countrycode || "ca").toLowerCase(), state: pr.state || "" }
    };
  }
  // Hides the suggestion dropdown.
  function closeSuggest() {
    $("suggest").hidden = true; $("addr").setAttribute("aria-expanded", "false");
    $("addr").removeAttribute("aria-activedescendant"); SG.active = -1;
  }
  // Shows the suggestion dropdown (or a short note if there are no matches).
  function drawSuggest(note) {
    const ul = $("suggest");
    if (note) {
      ul.innerHTML = `<li class="s-note" role="presentation">${esc(note)}</li>`;
    } else {
      ul.innerHTML = SG.items.map((s, i) => `<li role="option" id="sg-${i}" data-i="${i}" aria-selected="${i === SG.active}">
        ${PIN}<div><div class="s-main">${esc(s.main)}</div>${s.sub ? `<div class="s-sub">${esc(s.sub)}</div>` : ""}</div></li>`).join("");
    }
    ul.hidden = false; $("addr").setAttribute("aria-expanded", "true");
    if (SG.active >= 0) {
      $("addr").setAttribute("aria-activedescendant", "sg-" + SG.active);
      const el = $("sg-" + SG.active); if (el) el.scrollIntoView({ block: "nearest" });
    } else $("addr").removeAttribute("aria-activedescendant");
  }
  // Asks the suggestion service for places matching what you've typed so far.
  async function fetchSuggest(q) {
    const reqId = ++SG.req; // newer keystrokes make older answers stale
    let url = `https://photon.komoot.io/api/?limit=6&q=${encodeURIComponent(q)}`;
    if (S.lat != null) url += `&lat=${S.lat.toFixed(3)}&lon=${S.lon.toFixed(3)}`; // favour the last area searched
    try {
      const res = await fetchWithTimeout(url, {}, 8000);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (reqId !== SG.req || $("addr").value.trim() !== q) return; // user kept typing
      const seen = new Set();
      SG.items = (data.features || []).map(suggestionFrom).filter((s) => {
        const k = s.main + "|" + s.sub;
        if (!s.main || seen.has(k)) return false;
        seen.add(k); return true;
      });
      SG.active = -1;
      if (SG.items.length) drawSuggest(); else drawSuggest("No matches yet, keep typing or press Find food");
    } catch (e) {
      if (reqId === SG.req) { console.warn("Suggestions failed:", e); closeSuggest(); }
    }
  }
  // Runs when you pick a suggestion: fills in the box and jumps straight to the results.
  function chooseSuggestion(i) {
    const s = SG.items[i]; if (!s) return;
    $("addr").value = [s.main, s.sub].filter(Boolean).join(", ");
    closeSuggest(); homeError("");
    S.region = s.region;
    startAt(s.lat, s.lon, s.label);
  }

  // While typing: wait a moment after the last key, then fetch suggestions (3+ letters only).
  $("addr").addEventListener("input", () => {
    homeError("");
    const q = $("addr").value.trim();
    clearTimeout(SG.timer);
    if (q.length < 3) { SG.items = []; closeSuggest(); return; }
    SG.timer = setTimeout(() => fetchSuggest(q), 280);
  });
  // Arrow keys move through suggestions, Enter picks one, Escape closes the list.
  $("addr").addEventListener("keydown", (e) => {
    const open = !$("suggest").hidden && SG.items.length;
    if (e.key === "ArrowDown" && open) { e.preventDefault(); SG.active = (SG.active + 1) % SG.items.length; drawSuggest(); }
    else if (e.key === "ArrowUp" && open) { e.preventDefault(); SG.active = SG.active <= 0 ? SG.items.length - 1 : SG.active - 1; drawSuggest(); }
    else if (e.key === "Enter" && open && SG.active >= 0) { e.preventDefault(); chooseSuggestion(SG.active); }
    else if (e.key === "Escape" && !$("suggest").hidden) { e.preventDefault(); e.stopPropagation(); closeSuggest(); }
  });
  // mousedown (not click) so the choice lands before the input loses focus
  $("suggest").addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-i]"); if (!li) return;
    e.preventDefault(); chooseSuggestion(+li.dataset.i);
  });
  $("addr").addEventListener("blur", () => setTimeout(closeSuggest, 120));
  $("addr").addEventListener("focus", () => { if (SG.items.length && $("addr").value.trim().length >= 3) drawSuggest(); });

  // "Use my current location": the browser shows its own permission pop-up first.
  $("useLoc").addEventListener("click", () => {
    homeError("");
    if (!("geolocation" in navigator)) { homeError("Your browser doesn't support location. Type your address instead."); return; }
    if (location.protocol === "file:" || !window.isSecureContext) {
      homeError("Location only works when the site is opened from a web address (like GitHub Pages or VS Code's Live Server), not as a file. Type your address for now.");
      return;
    }
    const btn = $("useLoc"); btn.disabled = true;
    const original = btn.innerHTML;
    btn.lastChild.textContent = " Waiting for permission…";
    navigator.geolocation.getCurrentPosition(
      (pos) => { btn.disabled = false; btn.innerHTML = original; startAt(pos.coords.latitude, pos.coords.longitude, "Near you"); },
      (err) => {
        btn.disabled = false; btn.innerHTML = original;
        if (err.code === 1) homeError("Your browser blocked location. Click the icon left of the address bar and set Location to Allow, and check that location is on for your browser in your computer's privacy settings. Or just type where you are above.");
        else if (err.code === 3) homeError("Finding your location took too long. Try again or type your address.");
        else homeError("We couldn't get your location. Type your address above instead.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  });

  $("changeLoc").addEventListener("click", showHome);
  $("logoBtn").addEventListener("click", showHome);

  // "Open now" switch, distance buttons, list/map buttons and "Pick for me".
  $("openOnly").addEventListener("change", (e) => { S.openOnly = e.target.checked; render(); });
  document.querySelectorAll("[data-r]").forEach((b) => b.addEventListener("click", () => setRadius(+b.dataset.r)));
  document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { S.view = b.dataset.view; syncSeg(); render(); }));
  $("pickBtn").addEventListener("click", () => pickForMe());

  // Filter menu clicks: type, cuisine, show all cuisines, favourites only, clear, open/close the menu.
  $("typeList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-type]"); if (!b) return;
    S.type = b.dataset.type; S.cuisines.clear(); render();
  });
  $("cuisineList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cuisine]"); if (!b) return;
    const c = b.dataset.cuisine;
    S.cuisines.has(c) ? S.cuisines.delete(c) : S.cuisines.add(c);
    render();
  });
  $("moreCuisine").addEventListener("click", () => { S.showAllCuisines = !S.showAllCuisines; renderFilters(); });
  $("favOnly").addEventListener("click", () => { S.favOnly = !S.favOnly; render(); });
  $("clearFilters").addEventListener("click", clearFilters);
  $("openSide").addEventListener("click", openSide);
  $("closeSide").addEventListener("click", closeSide);
  $("backdrop").addEventListener("click", closeSide);

  // One click handler for all the lists: a heart click saves a favourite, any other click opens the details.
  function onListClick(e) {
    const fav = e.target.closest("[data-fav]");
    if (fav) { e.stopPropagation(); toggleFav(fav.dataset.fav); return; }
    const card = e.target.closest(".card");
    if (card) {
      const btn = card.querySelector("[data-open]");
      S.lastFocus = btn;
      openSheet(card.dataset.id);
    }
  }
  $("list").addEventListener("click", onListClick);
  $("unknownList").addEventListener("click", onListClick);
  $("furtherList").addEventListener("click", onListClick);
  $("furtherBtn").addEventListener("click", () => {
    if (S.furtherOpen) { S.furtherOpen = false; renderFurther(); } else openFurther();
  });
  $("furtherMore").addEventListener("click", () => { S.furtherN += 20; renderFurther(); });
  // "Further" button next to the distances: open the further-away section and scroll down to it.
  $("furtherChip").addEventListener("click", () => {
    if (!S.loaded) { toast("Nearby spots need to load first, then Further can look beyond them"); return; }
    if (S.view === "map") { S.view = "list"; syncSeg(); render(); }
    openFurther();
    $("furtherBox").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // Ways to close the details card: the X, clicking the dark area outside it, or pressing Escape.
  $("sheetClose").addEventListener("click", closeSheet);
  $("sheetWrap").addEventListener("click", (e) => { if (e.target === $("sheetWrap")) closeSheet(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("sheetWrap").hidden) closeSheet();
    else if ($("sidebar").classList.contains("open")) closeSide();
  });

  // Moon button: flip between light and dark mode (remembered if cookies were accepted).
  $("themeBtn").addEventListener("click", () => {
    const next = currentDark() ? "light" : "dark";
    applyTheme(next); store("theme", next);
    if (S.view === "map" && S.map) renderMap();
  });

  // Cookie banner buttons, plus the "Cookie settings" link in the footer to change your mind later.
  $("cookieYes").addEventListener("click", () => { setConsent("yes"); toast("Thanks! Your favourites will be remembered"); });
  $("cookieNo").addEventListener("click", () => { setConsent("no"); toast("Got it, nothing will be saved"); });
  $("cookieSettings").addEventListener("click", () => { $("cookie").hidden = false; $("cookieYes").focus(); });

  // Refresh "open now" status every minute while the page is open.
  setInterval(() => { if (!$("results").hidden && S.places.length && $("sheetWrap").hidden) render(); }, 60000);

  /* ---------- Boot ---------- */
  // ----- Start-up -----
  // Load anything saved from last time (only if cookies were accepted), and show the cookie banner on a first visit.
  S.consent = load("consent");
  if (S.consent === "yes") {
    const favs = load("favs"); if (Array.isArray(favs)) favs.forEach((f) => S.favs.add(f));
    const r = load("radius"); if ([1000, 2000, 5000].includes(r)) S.radius = r;
    const t = load("theme"); if (t === "light" || t === "dark") applyTheme(t);
  }
  if (!S.consent) $("cookie").hidden = false;
  syncSeg();

  // Expose the hours helpers for testing in the console.
  window.NearbyBites = { parseSimpleHours, simpleStatus, hoursStatus };
})();
