/* The demo app: a small task list. It is deliberately full of the things real apps have:
   typed-but-unsubmitted fields, a multi-line note, a dropdown, a checkbox, a button that starts disabled,
   a hidden panel, repeated buttons (one Remove per task) and slow work (Sync). */
function mountDemoApp(root, o) {
  o = Object.assign({ syncMs: 1800 }, o);
  const q = (s) => root.querySelector(s);
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const tasks = [];
  function render() {
    q("#list").innerHTML = tasks.map((t, i) =>
      "<li><span>" + esc(t.text) + "</span> <small>[" + esc(t.category) + (t.urgent ? ", urgent" : "") + "]</small>" +
      (t.note ? "<br><small>" + esc(t.note) + "</small>" : "") +
      ' <button class="remove" type="button" data-i="' + i + '">Remove</button></li>').join("");
    q("#count").textContent = tasks.length + " task" + (tasks.length === 1 ? "" : "s");
    q("#clear").disabled = !tasks.length;
  }
  function add(t) {
    const text = String(t.text || "").trim();
    if (!text) return false;
    tasks.push({ text, note: String(t.note || "").trim(), category: t.category || "Home", urgent: !!t.urgent });
    render(); return true;
  }
  q("#add").addEventListener("click", () => {
    if (add({ text: q("#item").value, note: q("#note").value, category: q("#category").value, urgent: q("#urgent").checked })) {
      q("#item").value = ""; q("#note").value = ""; q("#urgent").checked = false;
    }
  });
  q("#item").addEventListener("keydown", (e) => { if (e.key === "Enter") q("#add").click(); });
  q("#list").addEventListener("click", (e) => { const b = e.target.closest(".remove"); if (b) { tasks.splice(+b.dataset.i, 1); render(); } });
  q("#clear").addEventListener("click", () => { tasks.length = 0; render(); });
  q("#toggle").addEventListener("click", () => { q("#details").hidden = !q("#details").hidden; });
  q("#sync").addEventListener("click", () => {
    const b = q("#sync"); b.disabled = true; q("#synced").hidden = true; q("#syncing").hidden = false;
    setTimeout(() => { q("#syncing").hidden = true; q("#synced").hidden = false; b.disabled = false; }, o.syncMs);
  });
  render();
  return {
    tasks,
    actions: {
      addTask: async (a) => ({ added: add(a || {}), total: tasks.length }),
      getState: async () => ({ tasks: JSON.parse(JSON.stringify(tasks)) }),
    },
  };
}
