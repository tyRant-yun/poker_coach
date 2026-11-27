import { useState } from "react";
import { gameCall } from "./client";
import type { StrategySummary } from "./strategy";

export function StrategyLibrary() {
  const [packs, setPacks] = useState<StrategySummary[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState("");
  async function load() {
    try {
      setPacks(await gameCall<StrategySummary[]>("game_strategy_list"));
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <details
      onToggle={(e) => {
        if (e.currentTarget.open) void load();
      }}
    >
      <summary>翻前数据来源与导入</summary>
      <p>
        当前100BB
        HU、无抽水、无ante。仅频率图表不能计算EV损失；导入后需按原始设置与独立证据核验。结构校验不代表求解正确性。
      </p>
      <label>
        导入固定策略包（JSON）
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            e.target.value = "";
            setBusy(true);
            setMessage("");
            void (async () => {
              if (file.size > 900000)
                throw Error(
                  "此入口限900KB；请使用包含完整所需路径的小策略包，不截断范围。",
                );
              await gameCall("game_strategy_import", {
                pack: JSON.parse(await file.text()),
              });
              setMessage("已导入待核验候选，尚未作为评分依据。");
              await load();
            })()
              .catch((err) => setMessage(err.message))
              .finally(() => setBusy(false));
          }}
        />
      </label>
      {message && <p role="status">{message}</p>}
      {!packs.length && (
        <p>尚无匹配的已接纳数据包；翻前保留事实，不显示零损失。</p>
      )}
      {packs.map((p) => (
        <section key={p.hash}>
          <strong>
            {p.name} · {p.version} ·{" "}
            {p.status === "accepted" ? "人工核验接纳" : "待核验"}
          </strong>
          <p>
            {p.nodes}个节点 · {p.source.producer} · {p.source.quality}
          </p>
          <p>
            来源摘要 {p.hash.slice(0, 16)} · {p.source.credit}
          </p>
          {p.acceptance ? (
            <p>核验记录：{p.acceptance}</p>
          ) : (
            <>
              <label>
                核验依据与适用限制
                <textarea
                  aria-label={`核验依据 ${p.name}`}
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  maxLength={4000}
                />
              </label>
              <button
                disabled={
                  busy ||
                  evidence.trim().length < 20 ||
                  p.source.kind === "synthetic-test"
                }
                onClick={() => {
                  setBusy(true);
                  void gameCall("game_strategy_accept", {
                    hash: p.hash,
                    evidence,
                  })
                    .then(async () => {
                      setMessage("已记录人工接纳。重新分析原手后使用新来源。");
                      await load();
                    })
                    .catch((e) => setMessage(e.message))
                    .finally(() => setBusy(false));
                }}
              >
                按已完成核验接纳
              </button>
            </>
          )}
        </section>
      ))}
    </details>
  );
}
