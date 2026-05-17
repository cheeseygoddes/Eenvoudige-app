if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("./service-worker.js")
    .then(() => console.log("Service Worker Registered"))
    .catch(console.log);
}

const STORAGE_KEY = "tasklist_data";

let tasks = loadTasks();

function loadTasks() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return { must: [], want: [] };
    return JSON.parse(data);
  } catch {
    return { must: [], want: [] };
  }
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function renderList(listId, items) {
  const ul = document.getElementById(listId);
  if (!items.length) {
    ul.innerHTML = "<li>No tasks yet</li>";
    return;
  }
  ul.innerHTML = items
    .map((t, i) => `<li><span class="task-text">${escapeHtml(t)}</span><button class="delete-btn" data-index="${i}">&times;</button></li>`)
    .join("");
}

function render() {
  renderList("mustList", tasks.must);
  renderList("wantList", tasks.want);
}

function addTask(type) {
  const inputId = type === "must" ? "mustInput" : "wantInput";
  const input = document.getElementById(inputId);
  const text = input.value.trim();
  if (!text) return;
  tasks[type].unshift(text);
  saveTasks();
  render();
  input.value = "";
}

function deleteTask(type, index) {
  tasks[type].splice(index, 1);
  saveTasks();
  render();
}

let pendingActivity = null;

function showSuggestion(text) {
  const el = document.getElementById("suggestion");
  document.getElementById("suggestionText").textContent = text;
  el.hidden = false;
}

function hideSuggestion() {
  document.getElementById("suggestion").hidden = true;
  pendingActivity = null;
}

async function fetchBoredActivity() {
  const btn = document.getElementById("boredBtn");
  btn.disabled = true;
  btn.innerHTML = "Loading...";
  try {
    const res = await fetch("https://bored.api.lewagon.com/api/activity");
    if (!res.ok) throw new Error("API request failed");
    const data = await res.json();
    pendingActivity = data.activity;
    showSuggestion(data.activity);
  } catch {
    alert("Could not fetch an activity. Try again!");
  } finally {
    btn.disabled = false;
    btn.innerHTML = "\uD83C\uDFB2 I'm bored \u2014 suggest something!";
  }
}

document.getElementById("suggestionYes").addEventListener("click", () => {
  if (pendingActivity) {
    tasks.want.unshift(pendingActivity);
    saveTasks();
    render();
  }
  hideSuggestion();
});

document.getElementById("suggestionNo").addEventListener("click", hideSuggestion);

document.getElementById("mustAddBtn").addEventListener("click", () => addTask("must"));
document.getElementById("wantAddBtn").addEventListener("click", () => addTask("want"));
document.getElementById("boredBtn").addEventListener("click", fetchBoredActivity);

document.getElementById("mustInput").addEventListener("keydown", e => {
  if (e.key === "Enter") addTask("must");
});
document.getElementById("wantInput").addEventListener("keydown", e => {
  if (e.key === "Enter") addTask("want");
});

document.querySelectorAll(".task-list").forEach(list => {
  list.addEventListener("click", e => {
    const btn = e.target.closest(".delete-btn");
    if (btn) {
      const type = list.id === "mustList" ? "must" : "want";
      deleteTask(type, parseInt(btn.dataset.index));
    }
  });
});

render();
