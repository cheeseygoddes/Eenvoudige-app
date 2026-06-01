/* ==================== SERVICE WORKER REGISTRATION ==================== */
/* Registers the service worker so the app works offline */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("./service-worker.js")
    .then(() => console.log("SW Registered"))
    .catch(console.log);
}

/* ==================== STATE ==================== */
/* All app state lives in these module-level variables */
const STORAGE_KEY = "tasklist_data";   // localStorage key for the task array
const LANG_KEY = "tasklist_lang";      // localStorage key for language preference

let lang = localStorage.getItem(LANG_KEY) || "en";   // current language code
let translations = {};                               // loaded JSON translations (nl.json / en.json)
let tasks = loadTasks();                             // { must: [...], want: [...] }
let pendingActivity = null;                          // holds the Bored API suggestion before accept
let modalType = "must";                              // which section the add-modal belongs to

/* Categories available per section — each has its own set */
const mustCategories = ["work", "health", "personal", "urgent", "other"];
const wantCategories = ["fun", "relax", "social", "learn", "other"];

/* ==================== HELPERS ==================== */

/* Returns today as "YYYY-MM-DD" ISO string */
function todayStr() {
  return new Date().toISOString().split("T")[0];
}

/* Generates a semi-unique ID from timestamp + random chars */
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* Loads the task list from localStorage. Returns { must: [], want: [] } on fail. */
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

/* ==================== DATA MIGRATION ==================== */
/* Ensures every task object has all required fields.
   Old plain-string tasks are converted to full objects. */
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

/* Writes the current tasks object back to localStorage */
function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

/* ==================== RENDERING HELPERS ==================== */

/* Prevents XSS by converting text to safe HTML entities */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/* Translates a category key into a human-readable label (e.g. "work" -> "Work") */
function catLabel(cat) {
  const labels = translations.categories || {};
  return labels[cat] || cat;
}

/* Maps a category to its CSS class name (e.g. "work" -> "cat-work") for color styling */
function catClass(cat) {
  return "cat-" + (cat || "other");
}

/* ==================== INTERNATIONALIZATION (i18n) ==================== */
/* Dot-notation lookup in the loaded translations object.
   Usage: _("greetings.morning") returns the translated string, or the fallback. */
function _(key) {
  const keys = key.split(".");
  let val = translations;
  for (const k of keys) {
    if (val && val[k] !== undefined) val = val[k];
    else return key.split(".").pop();
  }
  return val || key.split(".").pop();
}

/* ==================== GREETING ==================== */
/* Updates the greeting heading based on the time of day and shows a smart
   subtitle that reflects the total number of tasks (empty / one / many). */
function updateGreeting() {
  const h = new Date().getHours();
  let timeMsg;
  if (h < 6) { timeMsg = "night"; }
  else if (h < 12) { timeMsg = "morning"; }
  else if (h < 18) { timeMsg = "afternoon"; }
  else { timeMsg = "evening"; }
  const greet = translations.greetings ? _( "greetings." + timeMsg) : "Good " + timeMsg + "!";
  document.querySelector(".greeting h1").textContent = greet;
  const total = tasks.must.length + tasks.want.length;
  const sub = document.getElementById("greetingSub");
  if (total === 0) {
    sub.textContent = translations.subEmpty ? _( "subEmpty") : "Nothing yet — what are you waiting for?";
  } else if (total === 1) {
    sub.textContent = translations.subOne ? _( "subOne") : "1 task waiting for you";
  } else {
    const t = translations.subTasks ? _( "subTasks") : "{n} tasks on your plate";
    sub.textContent = t.replace("{n}", total);
  }
}

/* ==================== MAIN RENDER ==================== */
/* Reads the active filter for each section, then renders
   the task list and stats bar for both "must" and "want". */
function render() {
  const mustFilter = document.querySelector("#mustFilters .active")?.dataset?.filter || "all";
  const wantFilter = document.querySelector("#wantFilters .active")?.dataset?.filter || "all";
  renderList("mustList", tasks.must, mustFilter, "must");
  renderList("wantList", tasks.want, wantFilter, "want");
  renderStats("mustStats", tasks.must, mustFilter);
  renderStats("wantStats", tasks.want, wantFilter);
  updateGreeting();
}

/* ==================== FILTER ==================== */
/* Returns a subset of items based on the selected filter:
   all / today / week (Mon-Sun) / month */
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
      start.setHours(0, 0, 0, 0);
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

/* ==================== RENDER LIST ==================== */
/* Builds the HTML for a <ul class="task-list">, showing filtered tasks
   or an "empty" message if none match. Each li has a drag-handle, 
   task content (text + meta with category/date/value), and a delete button. */
function renderList(listId, items, filter, type) {
  const ul = document.getElementById(listId);
  const filtered = applyFilter(items, filter);
  if (!filtered.length) {
    const msg = _("noTasks");
    ul.innerHTML = `<li class="empty-msg">${msg}</li>`;
    return;
  }
  ul.innerHTML = filtered.map(t => `
    <li data-id="${t.id}" data-type="${type}">
      <span class="drag-handle" data-drag="true">&#9776;</span>
      <div class="task-content">
        <span class="task-text">${escapeHtml(t.omschrijving)}</span>
        <div class="task-meta">
          <span class="${catClass(t.categorie)}">${catLabel(t.categorie)}</span>
          ${t.datum ? `<span>${t.datum}</span>` : ""}
          ${t.waarde ? `<span>&#9733; ${t.waarde}</span>` : ""}
        </div>
      </div>
      <button class="delete-btn" data-delete="true">&times;</button>
    </li>`).join("");
}

/* ==================== STATS ==================== */
/* Shows a total count chip + per-category count chips for the visible tasks */
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

/* ==================== MODAL (add task) ==================== */

/* Opens the bottom-sheet modal, populating the category dropdown
   based on whether we're adding to "must" or "want" */
function openModal(type) {
  modalType = type;
  const overlay = document.getElementById("taskModal");
  const title = document.getElementById("modalTitle");
  const catSelect = document.getElementById("modalCat");
  const addBtn = document.getElementById("modalAddBtn");
  const cats = type === "must" ? mustCategories : wantCategories;

  title.textContent = type === "must" ? _("mustDo") : _("wantToDo");
  document.getElementById("modalDate").value = todayStr();

  catSelect.innerHTML = `<option value="">${_("selectCategory")}</option>`;
  cats.forEach(c => {
    catSelect.innerHTML += `<option value="${c}">${catLabel(c)}</option>`;
  });

  addBtn.className = "modal-add-btn " + (type === "must" ? "modal-add-must" : "modal-add-want");
  addBtn.textContent = _("add");

  document.getElementById("modalDesc").value = "";
  document.getElementById("modalVal").value = "";
  overlay.hidden = false;
  setTimeout(() => document.getElementById("modalDesc").focus(), 350);
}

/* Hides the modal overlay */
function closeModal() {
  document.getElementById("taskModal").hidden = true;
}

/* Reads the form fields, creates a new task at the top of the list (unshift),
   saves to localStorage, re-renders, and closes the modal */
function addTaskFromModal() {
  const datum = document.getElementById("modalDate").value || todayStr();
  const categorie = document.getElementById("modalCat").value || "other";
  const omschrijving = document.getElementById("modalDesc").value.trim();
  const waarde = parseInt(document.getElementById("modalVal").value) || 0;
  if (!omschrijving) return;
  tasks[modalType].unshift({ id: genId(), datum, categorie, omschrijving, waarde, createdAt: Date.now() });
  saveTasks();
  render();
  closeModal();
}

/* ==================== DELETE ==================== */
/* Filters out a task by ID from the given section ("must" or "want"), saves, re-renders */
function deleteTask(type, id) {
  tasks[type] = tasks[type].filter(t => t.id !== id);
  saveTasks();
  render();
}

/* ==================== BORED API ==================== */
/* Fetches a random activity suggestion from the Bored API.
   On success, shows the suggestion bar with accept/decline buttons.
   The endpoint used is https://bored.api.lewagon.com/api/activity
   (the original boredapi.com is no longer maintained). */
async function fetchBoredActivity() {
  const btn = document.getElementById("boredBtn");
  const label = btn.querySelector("[data-i18n]");
  btn.disabled = true;
  if (label) label.textContent = _("loading");
  try {
    const res = await fetch("https://bored.api.lewagon.com/api/activity");
    if (!res.ok) throw new Error("fail");
    const data = await res.json();
    pendingActivity = data.activity;
    document.getElementById("suggestionText").textContent = data.activity;
    document.getElementById("suggestion").hidden = false;
  } catch {
    alert("Could not fetch an activity.");
  } finally {
    btn.disabled = false;
    if (label) label.textContent = _("bored");
  }
}

/* ==================== DRAG TO REORDER ==================== */
/* Implements drag-and-drop (touch + mouse) for reordering tasks within a list.
   Uses direct DOM manipulation (insertBefore / appendChild) instead of re-rendering
   the whole list, which avoids visual flicker and feels instant.
   Drag is disabled when a filter other than "all" is active to prevent
   index mismatches between the filtered DOM and the full array. */
function initDrag() {
  let dragEl, dragType, startY, currentTarget;

  /* Called on touchstart/mousedown on a [data-drag] handle */
  function onStart(e, handle) {
    const li = handle.closest("li");
    if (!li || li.classList.contains("empty-msg")) return;
    const section = li.closest(".section");
    const activeFilter = section?.querySelector(".filter-bar .active")?.dataset?.filter;
    if (activeFilter && activeFilter !== "all") return;

    dragEl = li;
    dragType = li.dataset.type;
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    currentTarget = null;
    dragEl.classList.add("dragging");

    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onEnd);
    if (e.cancelable) e.preventDefault();
  }

  /* On move, find where the dragged element should be inserted */
  function onMove(e) {
    if (!dragEl) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const list = dragEl.parentElement;
    const items = list.querySelectorAll("li:not(.empty-msg)");

    items.forEach(li => li.classList.remove("drag-over"));

    let placed = false;
    items.forEach(li => {
      if (li === dragEl) return;
      const r = li.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) {
        const mid = r.top + r.height / 2;
        if (y < mid) {
          list.insertBefore(dragEl, li);
        } else {
          list.insertBefore(dragEl, li.nextSibling);
        }
        placed = true;
      }
    });

    /* If the cursor is outside all items, move to top or bottom */
    if (!placed && items.length > 0) {
      const first = items[0];
      const last = items[items.length - 1];
      if (first && y < first.getBoundingClientRect().top) {
        list.insertBefore(dragEl, first);
      } else if (last && y > last.getBoundingClientRect().bottom) {
        list.appendChild(dragEl);
      }
    }
    if (e.cancelable) e.preventDefault();
  }

  /* On drop, read the new DOM order, rebuild the array, and save */
  function onEnd() {
    if (!dragEl) return;
    dragEl.classList.remove("dragging");

    const list = dragEl.parentElement;
    const items = list.querySelectorAll("li:not(.empty-msg)");
    items.forEach(li => li.classList.remove("drag-over"));

    const newOrder = Array.from(items).map(li => li.dataset.id);
    const arr = tasks[dragType];
    const ordered = newOrder.map(id => arr.find(t => t.id === id)).filter(Boolean);
    const remaining = arr.filter(t => !newOrder.includes(t.id));
    tasks[dragType] = [...ordered, ...remaining];
    saveTasks();

    dragEl = null;
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onEnd);
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onEnd);
  }

  /* Global listeners for touch and mouse drag initiation */
  document.addEventListener("touchstart", e => {
    const h = e.target.closest("[data-drag]");
    if (h) onStart(e, h);
  }, { passive: true });

  document.addEventListener("mousedown", e => {
    const h = e.target.closest("[data-drag]");
    if (h) onStart(e, h);
  });
}

/* ==================== I18N (language loading) ==================== */
/* Fetches the JSON translation file for the given language code.
   Updates all [data-i18n] elements with translated text,
   toggles the language button label, then re-renders. */
async function loadLang(l) {
  try {
    const res = await fetch(`./${l}.json`);
    translations = await res.json();
  } catch {
    translations = {};
  }
  document.getElementById("langBtn").textContent = l === "nl" ? "EN" : "NL";
  document.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = _(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    el.placeholder = _(el.dataset.i18nPlaceholder);
  });
  render();
}

/* Toggles between NL and EN and saves preference */
function toggleLang() {
  lang = lang === "nl" ? "en" : "nl";
  localStorage.setItem(LANG_KEY, lang);
  loadLang(lang);
}

/* ==================== INITIALIZATION ==================== */
/* Entry point: runs once when the page loads */
async function init() {
  await loadLang(lang);

  /* Modal open buttons (the FABs) */
  document.querySelectorAll("[data-modal]").forEach(btn => {
    btn.addEventListener("click", () => openModal(btn.dataset.modal));
  });
  document.getElementById("modalClose").addEventListener("click", closeModal);
  document.getElementById("taskModal").addEventListener("click", e => {
    if (e.target.classList.contains("modal-overlay")) closeModal();
  });
  document.getElementById("modalAddBtn").addEventListener("click", addTaskFromModal);
  document.getElementById("modalDesc").addEventListener("keydown", e => {
    if (e.key === "Enter") addTaskFromModal();
  });

  /* Bored API button and suggestion accept/decline */
  document.getElementById("boredBtn").addEventListener("click", fetchBoredActivity);
  document.getElementById("suggestionYes").addEventListener("click", () => {
    if (pendingActivity) {
      tasks.want.unshift({
        id: genId(), datum: todayStr(), categorie: "fun",
        omschrijving: pendingActivity, waarde: 0, createdAt: Date.now()
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

  /* Filter buttons (All / Today / Week / Month) — toggle active class by click */
  document.querySelectorAll(".filter-bar").forEach(bar => {
    bar.addEventListener("click", e => {
      const btn = e.target.closest(".filter-btn");
      if (!btn) return;
      bar.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      render();
    });
  });

  /* Delete button — uses event delegation on document for [data-delete] */
  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-delete]");
    if (btn) {
      const li = btn.closest("li");
      if (li) deleteTask(li.dataset.type, li.dataset.id);
    }
  });

  /* Language toggle button */
  document.getElementById("langBtn").addEventListener("click", toggleLang);

  /* Theme toggle — saves to localStorage and sets body[data-theme] */
  const themeBtn = document.getElementById("themeBtn");
  if (themeBtn) {
    const savedTheme = localStorage.getItem("tasklist_theme");
    if (savedTheme === "dark") {
      document.body.dataset.theme = "dark";
      themeBtn.textContent = "Light";
    }
    themeBtn.addEventListener("click", () => {
      const isDark = document.body.dataset.theme === "dark";
      document.body.dataset.theme = isDark ? "" : "dark";
      localStorage.setItem("tasklist_theme", isDark ? "" : "dark");
      themeBtn.textContent = isDark ? "Dark" : "Light";
    });
  }

  initDrag();
  render();
}

/* Start the app */
init();
