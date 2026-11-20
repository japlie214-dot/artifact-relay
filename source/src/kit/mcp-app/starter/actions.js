// Named actions Claude can run with {"action":"call","name":"getState"}. Defined before the wiring script runs.
// Rules (same as ../../actions.example.js): return small plain JSON, be safe to run twice, validate args and throw
// a clear Error, never put secrets in args, and do the minimum. Everything else Claude does goes through your controls.
window.REMOTE_ACTIONS = {
  getState: async () => ({
    name: document.getElementById("name").value,
    greeting: document.getElementById("greeting").textContent,
  }),
};
