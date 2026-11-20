// The calculator's own behaviour. A classic script that runs after the MCP shim, so it can use window.RELAY_MCP.
// Pressing Calculate asks the server's relay_calculate tool through the host. The Relay bridge drives this same
// page by filling the fields and pressing the same button, so Claude exercises the real UI path.
(() => {
  const $ = (id) => document.getElementById(id);
  const form = $("calculator"), left = $("left"), operation = $("operation"), right = $("right"), submit = $("calculate"), result = $("result");
  let revision = 0;

  window.RELAY_MCP.connected.then(
    () => { submit.disabled = false; },
    () => { result.textContent = "Could not connect to the MCP host."; },
  );

  form.addEventListener("reset", () => {
    revision++;
    result.textContent = "";
    submit.disabled = false;
    left.focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const request = ++revision;
    const args = { left: left.valueAsNumber, operation: operation.value, right: right.valueAsNumber };
    if (!Number.isFinite(args.left) || !Number.isFinite(args.right)) { result.textContent = "Enter two finite numbers."; return; }
    submit.disabled = true;
    result.textContent = "Calculating…";
    try {
      const response = await window.RELAY_MCP.callTool("relay_calculate", args);
      if (request !== revision) return;
      const data = response.structuredContent;
      result.textContent = typeof data?.error === "string" ? data.error
        : !response.isError && Number.isFinite(data?.value) ? String(data.value)
        : response.content?.find(({ type }) => type === "text")?.text ?? "Calculation failed.";
    } catch {
      if (request === revision) result.textContent = "Unable to reach the calculator tool.";
    } finally {
      if (request === revision) submit.disabled = false;
    }
  });
})();
