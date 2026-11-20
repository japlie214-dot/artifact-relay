/* Named actions: your own functions that Claude can run with {"action":"call","name":"<name>","args":{...}}.
   Use them for things that are awkward to do by clicking: setting app state directly, reading app data that is
   not on screen, or running a multi-step routine that must behave the same every time.

   Rules that keep them safe:
   1. Return small, plain JSON (under about 20,000 characters). Anything else becomes an error.
   2. Make them SAFE TO RUN TWICE. Claude may repeat a command after an error. The bridge itself never retries,
      but people and Claude do. Carry an id and ignore a repeat, or set state to a value rather than adding to it.
   3. Validate args yourself and throw a clear Error. The message goes straight into the result.
   4. Never put secrets in args. Commands are stored in the database.
   5. Do the minimum. Anything powerful you add here is something a command can trigger.                          */

const processed = new Set();                       // ids of requests already handled (per page load)

window.REMOTE_ACTIONS = {
  // Read data that is not visible on screen.
  getState: async () => ({ count: items.length, last: items[items.length - 1] || null }),

  // Idempotent write: the same requestId twice does nothing the second time.
  addItem: async ({ requestId, text }) => {
    if (typeof text !== "string" || !text.trim()) throw new Error('"text" is required');
    if (requestId && processed.has(requestId)) return { added: false, duplicate: true, total: items.length };
    if (requestId) processed.add(requestId);
    items.push(text.trim());
    render();
    return { added: true, total: items.length };
  },

  // Set state to a value (safe to repeat) instead of toggling it.
  setDarkMode: async ({ on }) => { document.documentElement.dataset.theme = on ? "dark" : "light"; return { dark: !!on }; },
};
