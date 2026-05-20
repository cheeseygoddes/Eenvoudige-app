if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("./service-worker.js")
    .then(() => console.log("SW Registered"))
    .catch(console.log);
}

const STORAGE_KEY = "tasklist_data";
const LANG_KEY = "tasklist_lang";

let lang = localStorage.getItem(LANG_KEY) || "en";
let translations = {};
let tasks = loadTasks();
let pendingActivity = null;
let dragState = null;

const mustCategories = ["work", "health", "personal", "urgent", "other"];
const wantCategories = ["fun", "relax", "social", "learn", "other"];

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { must: [], want: [] };
    const data = JSON.parse(raw);
    data.must = (data.must || []).map(migrateTask);
    data.want = (data.want || []).map(migrateTask);
    return data;
  } catch {
    return { must: [], want: [] };
  }
}

function migrateTask(t) {
  if (typeof t === "string") {
    return { id: genId(), datum: todayStr(), categorie: "other", omschrijving: t, waarde: 0, createdAt: Date.now() };
  }
  if (!t.id) t.id = genId();
  if (!t.datum) t.datum = todayStr();
  if (!t.categorie) t.categorie = "other";
  if (t.waarde === undefined) t.waarde = 0;
  if (!t.createdAt) t.createdAt = Date.now();
  return t;
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function catLabel(cat) {
  const labels = translations.categories || {};
  return labels[cat] || cat;
}

function catClass(cat) {
  return "cat-" + (cat || "other");
}

function render() {
  const mustFilter = document.querySelector("#mustFilters .active")?.dataset?.filter || "all";
  const wantFilter = document.querySelector("#wantFilters .active")?.dataset?.filter || "all";
  renderList("mustList", tasks.must, mustFilter, "must");
  renderList("wantList", tasks.want, wantFilter, "want");
  renderStats("mustStats", tasks.must, mustFilter);
  renderStats("wantStats", tasks.want, wantFilter);
}

function applyFilter(items, filter) {
  if (filter === "all") return items;
  const now = new Date();
  const today = todayStr();
  return items.filter(t => {
    if (!t.datum) return filter === "all";
    if (filter === "today") return t.datum === today;
    if (filter === "week") {
      const d = new Date(t.datum);
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
      start.setHours(0,0,0,0);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return d >= start && d <= end;
    }
    if (filter === "month") {
      const d = new Date(t.datum);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }
    return true;
  });
}

function renderList(listId, items, filter, type) {
  const ul = document.getElementById(listId);
  const filtered = applyFilter(items, filter);
  if (!filtered.length) {
    ul.innerHTML = `<li class="empty-msg" data-i18n="noTasks">${_( "noTasks")}</li>`;
    return;
  }
  ul.innerHTML = filtered.map((t, i) => `
    <li data-id="${t.id}" data-type="${type}" data-index="${i}">
      <span class="drag-handle" data-drag="true">&#9776;</span>
      <div class="task-content">
        <span class="task-text">${escapeHtml(t.omschrijving)}</span>
        <div class="task-meta">
          <span class="${catClass(t.categorie)}">${_( "categories." + t.categorie) || t.categorie}</span>
          ${t.datum ? `<span>${t.datum}</span>` : ""}
          ${t.waarde ? `<span>&#9733; ${t.waarde}</span>` : ""}
        </div>
      </div>
      <button class="delete-btn" data-delete="true">&times;</button>
    </li>`).join("");
}

function renderStats(barId, items, filter) {
  const bar = document.getElementById(barId);
  const filtered = applyFilter(items, filter);
  if (!filtered.length) { bar.innerHTML = ""; return; }
  const total = filtered.length;
  const cats = {};
  filtered.forEach(t => { cats[t.categorie] = (cats[t.categorie] || 0) + 1; });
  const chips = Object.entries(cats).map(([c, n]) =>
    `<span class="stat-chip"><strong>${n}</strong> ${catLabel(c)}</span>`
  ).join("");
  bar.innerHTML = `<span class="stat-chip"><strong>${total}</strong> ${_("totalTasks")}</span>` + chips;
}

function addTask(type) {
  const prefix = type === "must" ? "must" : "want";
  const datum = document.getElementById(prefix + "Date").value || todayStr();
  const categorie = document.getElementById(prefix + "Cat").value || "other";
  const omschrijving = document.getElementById(prefix + "Desc").value.trim();
  const waarde = parseInt(document.getElementById(prefix + "Val").value) || 0;
  if (!omschrijving) return;
  const task = { id: genId(), datum, categorie, omschrijving, waarde, createdAt: Date.now() };
  tasks[type].unshift(task);
  saveTasks();
  render();
  document.getElementById(prefix + "Desc").value = "";
  document.getElementById(prefix + "Val").value = "";
  document.getElementById(prefix + "Desc").focus();
}

function deleteTask(type, id) {
  tasks[type] = tasks[type].filter(t => t.id !== id);
  saveTasks();
  render();
}

async function fetchBoredActivity() {
  const btn = document.getElementById("boredBtn");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> ${_("loading")}`;
  try {
    const res = await fetch("https://bored.api.lewagon.com/api/activity");
    if (!res.ok) throw new Error("fail");
    const data = await res.json();
    pendingActivity = data.activity;
    document.getElementById("suggestionText").textContent = data.activity;
    document.getElementById("suggestion").hidden = false;
  } catch {
    alert("Could not fetch an activity. Try again!");
  } finally {
    btn.disabled = false;
    btn.innerHTML = _("bored");
  }
}

// --- Drag to reorder (touch + mouse) ---

function initDrag() {
  let dragEl, dragIndex, dragType, clone, startY, origY;

  function onStart(e, el) {
    const li = el.closest("li");
    if (!li) return;
    const section = li.closest(".section");
    const activeFilter = section?.querySelector(".filter-bar .active")?.dataset?.filter;
    if (activeFilter && activeFilter !== "all") return;
    const type = li.dataset.type;
    const id = li.dataset.id;
    const items = tasks[type];
    const idx = items.findIndex(t => t.id === id);
    if (idx === -1) return;
    const touch = e.touches ? e.touches[0] : e;
    dragEl = li;
    dragType = type;
    dragIndex = idx;
    startY = touch.clientY;
    origY = li.getBoundingClientRect().top;
    li.classList.add("dragging");
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onEnd);
    if (e.cancelable) e.preventDefault();
  }

  function onMove(e) {
    if (!dragEl) return;
    const touch = e.touches ? e.touches[0] : e;
    const dy = touch.clientY - startY;
    const list = dragEl.parentElement;
    const items = list.querySelectorAll("li:not(.empty-msg)");
    let newIdx = dragIndex;
    items.forEach((li, i) => {
      const rect = li.getBoundingClientRect();
      if (touch.clientY > rect.top + rect.height / 2) {
        newIdx = i + 1;
      }
      li.classList.remove("drag-over");
    });
    if (newIdx > dragIndex && newIdx < items.length) {
      items[newIdx].classList.add("drag-over");
    }
    if (e.cancelable) e.preventDefault();
  }

  function onEnd() {
    if (!dragEl) return;
    const list = dragEl.parentElement;
    const items = list.querySelectorAll("li:not(.empty-msg)");
    const targetEl = list.querySelector(".drag-over");
    let newIdx = items.length - 1;
    if (targetEl) {
      newIdx = Array.from(items).indexOf(targetEl);
      targetEl.classList.remove("drag-over");
    }
    dragEl.classList.remove("dragging");
    const arr = tasks[dragType];
    const [moved] = arr.splice(dragIndex, 1);
    arr.splice(newIdx, 0, moved);
    saveTasks();
    render();
    dragEl = null;
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onEnd);
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onEnd);
  }

  document.addEventListener("touchstart", e => {
    const handle = e.target.closest("[data-drag]");
    if (handle) onStart(e, handle);
  }, { passive: true });

  document.addEventListener("mousedown", e => {
    const handle = e.target.closest("[data-drag]");
    if (handle) onStart(e, handle);
  });
}

// --- i18n ---

async function loadLang(l) {
  try {
    const res = await fetch(`./${l}.json`);
    translations = await res.json();
  } catch {
    translations = {};
  }
  document.getElementById("langBtn").textContent = l === "nl" ? "EN" : "NL";
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n;
    el.textContent = _(key);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    el.placeholder = _(key);
  });
  render();
}

function _(key) {
  const keys = key.split(".");
  let val = translations;
  for (const k of keys) {
    if (val && val[k] !== undefined) val = val[k];
    else return key.split(".").pop();
  }
  return val || key.split(".").pop();
}

function toggleLang() {
  lang = lang === "nl" ? "en" : "nl";
  localStorage.setItem(LANG_KEY, lang);
  loadLang(lang);
}

// --- Init ---

async function init() {
  await loadLang(lang);

  document.getElementById("mustDate").value = todayStr();
  document.getElementById("wantDate").value = todayStr();

  document.getElementById("mustAddBtn").addEventListener("click", () => addTask("must"));
  document.getElementById("wantAddBtn").addEventListener("click", () => addTask("want"));
  document.getElementById("boredBtn").addEventListener("click", fetchBoredActivity);
  document.getElementById("langBtn").addEventListener("click", toggleLang);

  document.getElementById("suggestionYes").addEventListener("click", () => {
    if (pendingActivity) {
      tasks.want.unshift({
        id: genId(),
        datum: todayStr(),
        categorie: "fun",
        omschrijving: pendingActivity,
        waarde: 0,
        createdAt: Date.now()
      });
      saveTasks();
      render();
    }
    document.getElementById("suggestion").hidden = true;
    pendingActivity = null;
  });

  document.getElementById("suggestionNo").addEventListener("click", () => {
    document.getElementById("suggestion").hidden = true;
    pendingActivity = null;
  });

  document.querySelectorAll(".filter-bar").forEach(bar => {
    bar.addEventListener("click", e => {
      const btn = e.target.closest(".filter-btn");
      if (!btn) return;
      bar.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      render();
    });
  });

  document.getElementById("mustDesc").addEventListener("keydown", e => {
    if (e.key === "Enter") addTask("must");
  });
  document.getElementById("wantDesc").addEventListener("keydown", e => {
    if (e.key === "Enter") addTask("want");
  });

  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-delete]");
    if (btn) {
      const li = btn.closest("li");
      if (li) deleteTask(li.dataset.type, li.dataset.id);
    }
  });

  initDrag();
  render();
}

init();
