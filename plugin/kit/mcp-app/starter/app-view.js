// Your app's own behaviour. A classic script that runs after the MCP shim, so window.RELAY_MCP is ready.
// Calling your server's tools: window.RELAY_MCP.callTool("tool_name", { ...args }) returns the tool's result.
// The Relay bridge operates this same page through its controls (fill, click), so build the app the way a person uses it.
(() => {
  const $ = (id) => document.getElementById(id);
  const form = $("greeter"), name = $("name"), button = $("greet"), greeting = $("greeting");

  window.RELAY_MCP.connected.then(
    () => { button.disabled = false; },
    () => { greeting.textContent = "Could not connect to the MCP host."; },
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    greeting.textContent = "…";
    try {
      const response = await window.RELAY_MCP.callTool("app_greet", { name: name.value });
      greeting.textContent = response.structuredContent?.greeting
        ?? response.content?.find(({ type }) => type === "text")?.text ?? "Something went wrong.";
    } catch {
      greeting.textContent = "Unable to reach the server.";
    } finally {
      button.disabled = false;
    }
  });
})();
