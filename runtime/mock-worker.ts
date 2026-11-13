// An actual child process owns the simulated wait. No browser or MCP connection is required.
process.on("disconnect", () => process.exit(0));
process.on("message", (message: { outcome: string; attempt: number }) => {
  const delay = message.outcome === "slow" ? 8000 : 120;
  process.send?.({ stage: "running" });
  setTimeout(() => {
    if (message.outcome === "resource-limit")
      process.send?.({ error: "RESOURCE_LIMIT" });
    else if (message.outcome === "fail-once" && message.attempt === 1)
      process.send?.({ error: "脚本化首次失败，未生成结果" });
    else process.send?.({ stage: "postprocessing" });
    setTimeout(() => {
      process.send?.({ done: true }, () => process.disconnect());
    }, 50);
  }, delay);
});
