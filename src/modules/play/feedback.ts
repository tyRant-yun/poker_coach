import type { ReviewNode, ReviewReport } from "./review";

export type EvaluationCoverage = {
  source: "declared-reference" | "assumed-range";
  actions: "complete" | "partial";
  continuation: "reference-tree" | "checkdown" | "bounded-tree";
  missingActions: string[];
  evidence: string[];
};

export function reportSummary(report: ReviewReport) {
  const evaluated = report.nodes.filter((n) => Number.isFinite(n.gapBb));
  return {
    total: report.nodes.length,
    evaluated: evaluated.length,
    pending: report.nodes.filter((n) =>
      ["queued", "running"].includes(n.status),
    ).length,
    unknown: report.nodes.filter(
      (n) =>
        !Number.isFinite(n.gapBb) && !["queued", "running"].includes(n.status),
    ).length,
    // Deliberately no total EV loss: independent local models are not one game.
    priority: [...report.nodes].sort(
      (a, b) =>
        Number(b.marked) - Number(a.marked) ||
        (b.gapBb ?? -1) - (a.gapBb ?? -1) ||
        a.sequence - b.sequence,
    )[0]?.sequence,
  };
}

export function decisionAdvice(node: ReviewNode) {
  if (!node.actions?.length || node.gapBb === undefined)
    return {
      title: "暂不评价行动对错",
      detail: node.reason,
      evidence: [] as string[],
    };
  const best = node.actions.reduce((a, b) => (a.evBb > b.evBb ? a : b));
  const limited =
    node.coverage?.source !== "declared-reference" ||
    node.coverage?.actions !== "complete";
  return {
    title:
      node.gapBb < 0.01 ? "当前参考下行动价值接近" : `优先比较 ${best.action}`,
    detail:
      node.gapBb < 0.01
        ? "不因参考频率低而判错；微小差值需要更高精度或假设对照。"
        : limited
          ? "先检查范围与缺失行动，再使用这个局部比较；它没有证明对当前Bot的最佳打法。"
          : "比较原行动与最高价值行动，并检查该参考是否适合你的目标游戏。",
    evidence: [
      node.solutionId ?? node.reference?.hash ?? "",
      `decision:${node.sequence}`,
    ].filter(Boolean),
  };
}
