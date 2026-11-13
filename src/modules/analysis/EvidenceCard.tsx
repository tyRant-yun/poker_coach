import type { Ref } from "./domain";
import s from "./AnalysisPage.module.css";
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const reference = (value: unknown): value is Ref => {
  const v = object(value);
  return (
    typeof v.id === "string" &&
    typeof v.version === "number" &&
    typeof v.kind === "string" &&
    typeof v.contentHash === "string"
  );
};
const labels: Record<string, string> = {
  solution: "固定解",
  spec: "分析规格",
  range: "范围版本",
  policy: "策略版本",
  situation: "局面版本",
  evaluation: "评价",
  comparison: "比较",
  experiment: "实验",
  conclusion: "结论",
  attempt: "首次作答",
  feedback: "反馈",
  theory: "理论依据",
  content: "示例内容",
  mission: "Agent 轨迹",
  "question-definition": "题目规则",
};
export function EvidenceCard({
  value,
  onReference,
}: {
  value: unknown;
  onReference: (r: Ref) => void;
}) {
  const data = object(value),
    refs: Ref[] = [];
  const collect = (v: unknown, depth = 0) => {
    if (reference(v)) {
      if (!refs.some((r) => r.id === v.id && r.version === v.version))
        refs.push(v);
      return;
    }
    if (depth > 2) return;
    if (Array.isArray(v)) {
      v.slice(0, 20).forEach((x) => collect(x, depth + 1));
      return;
    }
    Object.values(object(v)).forEach((x) => collect(x, depth + 1));
  };
  collect(value);
  const items = Array.isArray(data.items) ? data.items.map(object) : [],
    trace = Array.isArray(data.trace) ? data.trace.map(object) : [],
    sample = object(data.samplePolicyEv);
  return (
    <div className={s.evidence}>
      {typeof data.text === "string" && <p>{data.text}</p>}
      {typeof data.reason === "string" && <p>{data.reason}</p>}
      {typeof data.prompt === "string" && <p>{data.prompt}</p>}
      {typeof data.changedCondition === "string" && (
        <p>改变条件：{data.changedCondition}</p>
      )}
      {typeof data.conceptAccepted === "boolean" && (
        <p>
          {data.conceptAccepted
            ? "本题的来源概念符合要求。"
            : "请重新核对桌型、行动历史与范围来源。"}
          理由已保存，未自动判断自由文本理解。
        </p>
      )}
      {"distance" in data && (
        <p>
          对作者参考的频率差：
          <b>
            {typeof data.distance === "number"
              ? (data.distance * 100).toFixed(2) + "%"
              : "当前条件不可比较"}
          </b>
          。真实 EV 损失：未提供。
        </p>
      )}
      {typeof sample.value === "number" && (
        <p>
          配对合成收益示例：<b>{sample.value.toFixed(2)} bb</b>
          。仅适用于这份固定策略，不是由频率差换算。
        </p>
      )}
      {"eligible" in data && (
        <p>
          比较资格：
          <b>
            {data.eligible
              ? "条件匹配，可观察合成对照"
              : "证据不足，暂不作定量排序"}
          </b>
        </p>
      )}
      {typeof data.execution === "string" && (
        <p>
          Agent 已按应用命令完成脚本，并保存以下工具轨迹；没有调用真实 LLM。
        </p>
      )}
      {trace.length > 0 && (
        <ol>
          {trace.map((step, i) => (
            <li key={i}>{String(step.observation ?? step.tool)}</li>
          ))}
        </ol>
      )}
      {items.map((item, i) => {
        const metric = object(item.metric);
        return (
          <article key={i}>
            <b>{String(item.combo ?? "组合")}</b>
            {item.availability === "available" ? (
              <p>
                合成权益 {(Number(metric.equity) * 100).toFixed(1)}%；动作 EV：
                {Object.entries(object(metric.ev))
                  .map(([a, v]) => `${a} ${Number(v).toFixed(2)}bb`)
                  .join(" / ")}
              </p>
            ) : (
              <p>此组合指标未覆盖，未填零。</p>
            )}
          </article>
        );
      })}
      {refs.length > 0 && (
        <div className={s.referenceLinks}>
          {refs.slice(0, 20).map((r) => (
            <button key={`${r.id}@${r.version}`} onClick={() => onReference(r)}>
              {labels[r.kind] ?? r.kind} · V{r.version}
            </button>
          ))}
        </div>
      )}
      <details>
        <summary>固定引用与原始数据</summary>
        <pre className={s.result}>{JSON.stringify(value, null, 2)}</pre>
      </details>
    </div>
  );
}
