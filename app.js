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
let modalType = "must";
let editingTaskId = null;
let activeTab = "must";

const categories = ["work", "health", "personal", "urgent", "fun", "relax", "social", "learn", "other"];

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

function _(key) {
  const keys = key.split(".");
  let val = translations;
  for (const k of keys) {
    if (val && val[k] !== undefined) val = val[k];
    else return key.split(".").pop();
  }
  return val || key.split(".").pop();
}

function updateGreeting() {
  const h = new Date().getHours();
  let timeMsg;
  if (h < 6) { timeMsg = "night"; }
  else if (h < 12) { timeMsg = "morning"; }
  else if (h < 18) { timeMsg = "afternoon"; }
  else { timeMsg = "evening"; }
  const greet = translations.greetings ? _( "greetings." + timeMsg) : "Good " + timeMsg + "!";
  document.getElementById("greetingTitle").textContent = greet;
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

function render() {
  const mustFilter = document.querySelector("#mustFilters .active")?.dataset?.filter || "all";
  const wantFilter = document.querySelector("#wantFilters .active")?.dataset?.filter || "all";
  renderList("mustList", tasks.must, mustFilter, "must");
  renderList("wantList", tasks.want, wantFilter, "want");
  renderStats("mustStats", tasks.must, mustFilter);
  renderStats("wantStats", tasks.want, wantFilter);
  updateGreeting();
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
      <div class="task-actions">
        <button class="edit-btn" data-edit="true">&#9998;</button>
        <button class="delete-btn" data-delete="true">&times;</button>
      </div>
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

function openModal(type, task = null) {
  modalType = type;
  editingTaskId = task ? task.id : null;
  const overlay = document.getElementById("taskModal");
  const title = document.getElementById("modalTitle");
  const catSelect = document.getElementById("modalCat");
  const addBtn = document.getElementById("modalAddBtn");

  title.textContent = task ? _("edit") : (type === "must" ? _("mustDo") : _("wantToDo"));
  document.getElementById("modalDate").value = task ? task.datum : todayStr();

  catSelect.innerHTML = `<option value="">${_("selectCategory")}</option>`;
  categories.forEach(c => {
    catSelect.innerHTML += `<option value="${c}"${task && task.categorie === c ? " selected" : ""}>${catLabel(c)}</option>`;
  });

  addBtn.className = "modal-add-btn " + (type === "must" ? "modal-add-must" : "modal-add-want");
  addBtn.textContent = task ? _("save") : _("add");

  document.getElementById("modalDesc").value = task ? task.omschrijving : "";
  document.getElementById("modalVal").value = task ? task.waarde : "";
  overlay.hidden = false;
  setTimeout(() => document.getElementById("modalDesc").focus(), 350);
}

function closeModal() {
  document.getElementById("taskModal").hidden = true;
}

function addTaskFromModal() {
  const datum = document.getElementById("modalDate").value || todayStr();
  const categorie = document.getElementById("modalCat").value || "other";
  const omschrijving = document.getElementById("modalDesc").value.trim();
  const waarde = parseInt(document.getElementById("modalVal").value) || 0;
  if (!omschrijving) return;

  if (editingTaskId) {
    const idx = tasks[modalType].findIndex(t => t.id === editingTaskId);
    if (idx !== -1) {
      tasks[modalType][idx] = { ...tasks[modalType][idx], datum, categorie, omschrijving, waarde };
    }
    editingTaskId = null;
  } else {
    tasks[modalType].unshift({ id: genId(), datum, categorie, omschrijving, waarde, createdAt: Date.now() });
  }
  saveTasks();
  render();
  closeModal();
}

function deleteTask(type, id) {
  tasks[type] = tasks[type].filter(t => t.id !== id);
  saveTasks();
  render();
}

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

function switchTab(tab) {
  if (tab === activeTab) return;
  activeTab = tab;

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });

  const mustPanel = document.querySelector('.panel[data-panel="must"]');
  const wantPanel = document.querySelector('.panel[data-panel="want"]');
  const w = document.getElementById("panelsWrapper").getBoundingClientRect().width;

  if (tab === "must") {
    mustPanel.style.transform = `translateX(0)`;
    wantPanel.style.transform = `translateX(${w}px)`;
  } else {
    mustPanel.style.transform = `translateX(${-w}px)`;
    wantPanel.style.transform = `translateX(0)`;
  }

  render();
}

function initSwipe() {
  const wrapper = document.getElementById("panelsWrapper");
  const mustPanel = document.querySelector('.panel[data-panel="must"]');
  const wantPanel = document.querySelector('.panel[data-panel="want"]');
  let startX = 0;
  let startY = 0;
  let isSwiping = false;

  function setPanelTransitions(val) {
    mustPanel.style.transition = val;
    wantPanel.style.transition = val;
  }

  function snapBack() {
    setPanelTransitions("transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)");
    const w = wrapper.getBoundingClientRect().width;
    if (activeTab === "must") {
      mustPanel.style.transform = "translateX(0)";
      wantPanel.style.transform = `translateX(${w}px)`;
    } else {
      mustPanel.style.transform = `translateX(${-w}px)`;
      wantPanel.style.transform = "translateX(0)";
    }
  }

  document.addEventListener("touchstart", e => {
    if (!e.target.closest("#panelsWrapper")) return;
    if (e.target.closest("[data-drag]")) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    isSwiping = false;
  }, { passive: true });

  document.addEventListener("touchmove", e => {
    if (!e.target.closest("#panelsWrapper")) return;
    if (e.target.closest("[data-drag]")) return;

    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    if (!isSwiping && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
      isSwiping = true;
    }
    if (!isSwiping) return;

    e.preventDefault();
    const w = wrapper.getBoundingClientRect().width;
    const progress = dx / w;

    setPanelTransitions("none");

    if (activeTab === "must") {
      const p = Math.max(-1, Math.min(0, progress));
      mustPanel.style.transform = `translateX(${p * w}px)`;
      wantPanel.style.transform = `translateX(${(1 + p) * w}px)`;
    } else {
      const p = Math.max(0, Math.min(1, progress));
      mustPanel.style.transform = `translateX(${(-1 + p) * w}px)`;
      wantPanel.style.transform = `translateX(${p * w}px)`;
    }
  }, { passive: false });

  document.addEventListener("touchend", e => {
    if (!isSwiping) return;
    if (!e.target.closest("#panelsWrapper")) return;

    const dx = e.changedTouches[0].clientX - startX;
    const threshold = 50;

    setPanelTransitions("transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)");

    if (activeTab === "must" && dx < -threshold) {
      switchTab("want");
    } else if (activeTab === "want" && dx > threshold) {
      switchTab("must");
    } else {
      snapBack();
    }
    isSwiping = false;
  }, { passive: true });
}

function initDrag() {
  let dragEl, dragType, startY, currentTarget;

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

  document.addEventListener("touchstart", e => {
    const h = e.target.closest("[data-drag]");
    if (h) onStart(e, h);
  }, { passive: true });

  document.addEventListener("mousedown", e => {
    const h = e.target.closest("[data-drag]");
    if (h) onStart(e, h);
  });
}

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

function toggleLang() {
  lang = lang === "nl" ? "en" : "nl";
  localStorage.setItem(LANG_KEY, lang);
  loadLang(lang);
}

async function init() {
  await loadLang(lang);

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

  document.querySelectorAll(".filter-bar").forEach(bar => {
    bar.addEventListener("click", e => {
      const btn = e.target.closest(".filter-btn");
      if (!btn) return;
      bar.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      render();
    });
  });

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-edit]");
    if (btn) {
      const li = btn.closest("li");
      if (li) {
        const type = li.dataset.type;
        const task = tasks[type].find(t => t.id === li.dataset.id);
        if (task) openModal(type, task);
      }
    }
  });

  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-delete]");
    if (btn) {
      const li = btn.closest("li");
      if (li) deleteTask(li.dataset.type, li.dataset.id);
    }
  });

  document.getElementById("langBtn").addEventListener("click", toggleLang);

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
  initSwipe();

  const firstBtn = document.querySelector(".tab-btn.active");
  if (firstBtn) {
    activeTab = firstBtn.dataset.tab;
  }

  render();
}

init();
