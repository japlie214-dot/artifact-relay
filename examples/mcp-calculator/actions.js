// Named actions Claude can run with {"action":"call","name":"getState"}. Kept deliberately small:
// everything else the agent does here goes through the page's own controls (fill, select, click).
window.REMOTE_ACTIONS = {
  // The visible result text and the three inputs, in one small read.
  getState: async () => ({
    left: document.getElementById("left").value,
    operation: document.getElementById("operation").value,
    right: document.getElementById("right").value,
    result: document.getElementById("result").textContent,
  }),
};
