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
    .map((t, i) => `<li>${escapeHtml(t)} <button onclick="deleteTask('${listId === 'mustList' ? 'must' : 'want'}', ${i})">x</button></li>`)
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
  tasks[type].push(text);
  saveTasks();
  render();
  input.value = "";
}

function deleteTask(type, index) {
  tasks[type].splice(index, 1);
  saveTasks();
  render();
}

render();
