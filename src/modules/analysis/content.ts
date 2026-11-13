import { allCombos, handByCombo, handClasses } from "../study/domain.ts";
import type {
  Action,
  AnalysisNode,
  Player,
  Policy,
  SolutionPage,
  Weights,
} from "./domain.ts";
export { allCombos, handByCombo, handClasses };
export const contentVersion = "s1-authored-2";
const premium = new Set("AA KK QQ JJ AKs AKo".split(" "));
const middle = new Set(
  "TT 99 88 77 AQs AJs ATs A5s A4s AQo KQs KJs QJs JTs T9s 98s 87s 76s 65s 54s".split(
    " ",
  ),
);
const weak = new Set(
  "66 55 44 33 22 A9s A8s A7s A6s A3s A2s AJo ATo KTs QTs J9s KQo KJo QJo".split(
    " ",
  ),
);
export const presets = [
  {
    id: "H-SRP",
    label: "HU · 单加注底池",
    format: "HU",
    line: [
      ["BTN", "raise", 250],
      ["BB", "call", 250],
    ],
    board: ["As", "7d", "2c"],
    post: true,
  },
  {
    id: "H-3BP",
    label: "HU · 3-bet 底池",
    format: "HU",
    line: [
      ["BTN", "raise", 250],
      ["BB", "raise", 1000],
      ["BTN", "call", 1000],
    ],
    board: ["Td", "9d", "6h"],
    post: false,
  },
  {
    id: "X-BB",
    label: "6-max · BTN 对 BB",
    format: "6-max",
    line: [
      ["UTG", "fold", 0],
      ["HJ", "fold", 0],
      ["CO", "fold", 0],
      ["BTN", "raise", 250],
      ["SB", "fold", 0],
      ["BB", "call", 250],
    ],
    board: ["As", "7d", "2c"],
    post: true,
  },
  {
    id: "X-3BP",
    label: "6-max · CO 对 BTN 3-bet",
    format: "6-max",
    line: [
      ["UTG", "fold", 0],
      ["HJ", "fold", 0],
      ["CO", "raise", 250],
      ["BTN", "raise", 850],
      ["SB", "fold", 0],
      ["BB", "fold", 0],
      ["CO", "call", 850],
    ],
    board: ["Kc", "8d", "3s"],
    post: true,
  },
  {
    id: "X-4BP",
    label: "6-max · 4-bet",
    format: "6-max",
    line: [
      ["UTG", "fold", 0],
      ["HJ", "fold", 0],
      ["CO", "fold", 0],
      ["BTN", "raise", 250],
      ["SB", "fold", 0],
      ["BB", "raise", 1100],
      ["BTN", "raise", 2400],
      ["BB", "call", 2400],
    ],
    board: ["As", "7d", "2c"],
    post: false,
  },
  {
    id: "X-SQ",
    label: "6-max · 冷跟与 squeeze",
    format: "6-max",
    line: [
      ["UTG", "raise", 250],
      ["HJ", "fold", 0],
      ["CO", "call", 250],
      ["BTN", "raise", 1100],
      ["SB", "fold", 0],
      ["BB", "fold", 0],
      ["UTG", "fold", 0],
      ["CO", "call", 1100],
    ],
    board: ["Kc", "8d", "3s"],
    post: false,
  },
  {
    id: "X-MULTI",
    label: "6-max · 三人配置（计算不支持）",
    format: "6-max",
    line: [
      ["UTG", "fold", 0],
      ["HJ", "fold", 0],
      ["CO", "fold", 0],
      ["BTN", "raise", 250],
      ["SB", "call", 250],
      ["BB", "call", 250],
    ],
    board: ["As", "7d", "2c"],
    post: false,
  },
  {
    id: "X-UTG",
    label: "6-max · UTG 未开池",
    format: "6-max",
    line: [
      ["UTG", "raise", 250],
      ["HJ", "fold", 0],
      ["CO", "fold", 0],
      ["BTN", "fold", 0],
      ["SB", "fold", 0],
      ["BB", "call", 250],
    ],
    board: ["As", "7d", "2c"],
    post: false,
  },
  {
    id: "X-HJ",
    label: "6-max · HJ 未开池",
    format: "6-max",
    line: [
      ["UTG", "fold", 0],
      ["HJ", "raise", 250],
      ["CO", "fold", 0],
      ["BTN", "fold", 0],
      ["SB", "fold", 0],
      ["BB", "call", 250],
    ],
    board: ["As", "7d", "2c"],
    post: false,
  },
  {
    id: "X-CO",
    label: "6-max · CO 未开池",
    format: "6-max",
    line: [
      ["UTG", "fold", 0],
      ["HJ", "fold", 0],
      ["CO", "raise", 250],
      ["BTN", "fold", 0],
      ["SB", "fold", 0],
      ["BB", "call", 250],
    ],
    board: ["As", "7d", "2c"],
    post: false,
  },
  {
    id: "X-BTN",
    label: "6-max · BTN 未开池",
    format: "6-max",
    line: [
      ["UTG", "fold", 0],
      ["HJ", "fold", 0],
      ["CO", "fold", 0],
      ["BTN", "raise", 250],
      ["SB", "fold", 0],
      ["BB", "call", 250],
    ],
    board: ["As", "7d", "2c"],
    post: false,
  },
  {
    id: "X-SB",
    label: "6-max · SB 未开池",
    format: "6-max",
    line: [
      ["UTG", "fold", 0],
      ["HJ", "fold", 0],
      ["CO", "fold", 0],
      ["BTN", "fold", 0],
      ["SB", "raise", 250],
      ["BB", "call", 250],
    ],
    board: ["As", "7d", "2c"],
    post: false,
  },
  {
    id: "X-WALK",
    label: "6-max · BB 收盲终局",
    format: "6-max",
    line: [
      ["UTG", "fold", 0],
      ["HJ", "fold", 0],
      ["CO", "fold", 0],
      ["BTN", "fold", 0],
      ["SB", "fold", 0],
    ],
    board: ["As", "7d", "2c"],
    post: false,
  },
] as const;
export function initialPlayers(format: string): Player[] {
  return (
    format === "HU" ? ["BTN", "BB"] : ["UTG", "HJ", "CO", "BTN", "SB", "BB"]
  ).map((id) => ({
    id,
    position: format === "HU" && id === "BTN" ? "SB/BTN" : id,
    initial: 10000,
    remaining:
      10000 -
      (id === "BB"
        ? 100
        : id === "SB" || (format === "HU" && id === "BTN")
          ? 50
          : 0),
    contribution:
      id === "BB"
        ? 100
        : id === "SB" || (format === "HU" && id === "BTN")
          ? 50
          : 0,
    status: "active",
  }));
}
export const legalCombo = (c: string, board: string[]) =>
  !board.includes(c.slice(0, 2)) && !board.includes(c.slice(2));
export function authoredPolicy(
  actions: Action[],
  board: string[],
  format: string,
  position: string,
): Policy {
  const ids = actions.map((a) => a.id);
  return Object.fromEntries(
    allCombos.map((c) => {
      const label = handByCombo[c],
        tier = premium.has(label)
          ? 0
          : middle.has(label)
            ? 1
            : weak.has(label)
              ? 2
              : 3;
      let distribution: number[];
      if (ids.includes("bet"))
        distribution =
          tier === 0
            ? [2500, 7500]
            : tier === 1
              ? [5000, 5000]
              : tier === 2
                ? [7500, 2500]
                : [10000, 0];
      else if (ids.includes("check"))
        distribution = tier < 2 ? [0, 10000] : [7500, 2500];
      else if (ids.includes("raise") && ids.includes("call"))
        distribution =
          tier === 0
            ? [0, 2500, 7500]
            : tier === 1
              ? [1500, 6500, 2000]
              : tier === 2
                ? [6500, 3500, 0]
                : [10000, 0, 0];
      else if (ids.includes("raise")) {
        const loose = format === "HU" || ["BTN", "SB"].includes(position);
        distribution =
          tier === 0
            ? [0, 10000]
            : tier === 1
              ? [loose ? 2000 : 4000, loose ? 8000 : 6000]
              : tier === 2
                ? [loose ? 6000 : 9000, loose ? 4000 : 1000]
                : [10000, 0];
      } else
        distribution =
          tier === 0
            ? [0, 10000]
            : tier === 1
              ? [3000, 7000]
              : tier === 2
                ? [7000, 3000]
                : [10000, 0];
      return [
        c,
        Object.fromEntries(
          ids.map((a, i) => [
            a,
            legalCombo(c, board) ? (distribution[i] ?? 0) : 0,
          ]),
        ),
      ];
    }),
  );
}
export function applyAction(players: Player[], actor: string, action: Action) {
  const next = structuredClone(players),
    p = next.find((p) => p.id === actor)!;
  if (action.type === "fold") p.status = "folded";
  else if (action.to !== undefined) {
    const add = action.to - p.contribution;
    if (add < 0 || add > p.remaining) throw Error("预置账本投入无效");
    p.remaining -= add;
    p.contribution = action.to;
  }
  return next;
}
export function derive(
  weights: Weights,
  policy: Policy,
  action: string,
  board: string[],
): Weights {
  return Object.fromEntries(
    allCombos.map((c) => [
      c,
      legalCombo(c, board)
        ? ((weights[c] ?? 0) * (policy[c]?.[action] ?? 0)) / 10000
        : 0,
    ]),
  );
}
const authoredTrees = new Map<string, AnalysisNode[]>();
export function nodesFor(presetId: string): AnalysisNode[] {
  let tree = authoredTrees.get(presetId);
  if (!tree) {
    tree = buildNodes(presetId);
    authoredTrees.set(presetId, tree);
  }
  return structuredClone(tree);
}
function buildNodes(presetId: string): AnalysisNode[] {
  const preset = presets.find((p) => p.id === presetId);
  if (!preset) throw Error("未找到预置树");
  let players = initialPlayers(preset.format),
    weights = Object.fromEntries(
      players.map((p) => [
        p.id,
        Object.fromEntries(allCombos.map((c) => [c, 10000])),
      ]),
    ),
    history: string[] = [];
  const nodes: AnalysisNode[] = [];
  const add = (
    id: string,
    parent: string | undefined,
    via: string | undefined,
    actor: string,
    board: string[],
    actions: Action[],
    kind: AnalysisNode["kind"] = "decision",
  ) => {
    const policies =
      actor && kind === "decision"
        ? { [actor]: authoredPolicy(actions, board, preset.format, actor) }
        : {};
    const node: AnalysisNode = {
      id,
      parent,
      via,
      label:
        kind === "decision"
          ? `${actor} · ${board.length === 0 ? "翻前" : board.length === 3 ? "翻牌" : board.length === 4 ? "转牌" : "河牌"}`
          : kind === "chance"
            ? "选择后续公共牌"
            : kind === "terminal"
              ? "弃牌终局"
              : "片段结束",
      kind,
      actor,
      board: [...board],
      pot: players.reduce((s, p) => s + p.contribution, 0),
      players: structuredClone(players),
      history: [...history],
      actions,
      weights: structuredClone(weights),
      policies,
      model: "own-action-reach",
    };
    nodes.push(node);
    return node;
  };
  let parent: string | undefined, via: string | undefined;
  for (const [i, [actor, type, to]] of preset.line.entries()) {
    const max = Math.max(...players.map((p) => p.contribution)),
      p = players.find((p) => p.id === actor)!;
    const actions: Action[] =
      max > p.contribution
        ? [
            { id: "fold", label: "弃牌", type: "fold" },
            {
              id: "call",
              label: `跟注至 ${max / 100}bb`,
              type: "call",
              to: max,
            },
            {
              id: "raise",
              label: `加注至 ${type === "raise" ? to / 100 : (max * 3) / 100}bb`,
              type: "raise",
              to: type === "raise" ? to : max * 3,
            },
          ]
        : [
            { id: "fold", label: "弃牌", type: "fold" },
            {
              id: "raise",
              label: `加注至 ${to || 250} 最小单位`,
              type: "raise",
              to: to || 250,
            },
          ];
    const n = add(`p${i}`, parent, via, actor, [], actions);
    const chosen = actions.find((a) => a.id === type)!;
    // Fold is an explicit terminal side branch only when the remaining opponents can end this segment.
    if (type !== "fold") {
      const folded = applyAction(players, actor, {
        id: "fold",
        label: "弃牌",
        type: "fold",
      });
      const paid = folded
        .filter((p) => p.status === "active")
        .map((p) => p.contribution)
        .sort((a, b) => b - a);
      const returned =
        paid.length === 1
          ? Math.max(
              0,
              paid[0] -
                Math.max(
                  0,
                  ...folded
                    .filter((p) => p.status === "folded")
                    .map((p) => p.contribution),
                ),
            )
          : 0;
      nodes.push({
        ...structuredClone(n),
        id: `p${i}-fold`,
        parent: n.id,
        via: "fold",
        kind:
          folded.filter((p) => p.status === "active").length === 1
            ? "terminal"
            : "segment-end",
        actor: "",
        players: folded,
        actions: [],
        policies: {},
        returned,
        pot: n.pot - returned,
        history: [...history, `${actor} fold`],
      });
    }
    weights[actor] = derive(weights[actor], n.policies[actor], type, []);
    players = applyAction(players, actor, chosen);
    history.push(`${actor} ${type}${to ? " to " + to / 100 + "bb" : ""}`);
    parent = n.id;
    via = type;
  }
  add("flop-deal", parent, via, "", [], [], "chance");
  parent = "flop-deal";
  via = "deal";
  const live = players.filter((p) => p.status === "active");
  const order = players.map((p) => p.id);
  live.sort((a, b) => {
    const rank = (p: Player) =>
      p.id === "SB" ? 0 : p.id === "BB" ? 1 : order.indexOf(p.id) + 2;
    return rank(a) - rank(b);
  });
  if (live.length !== 2) {
    const end = add(
      live.length === 1 ? "walk" : "multi",
      parent,
      via,
      live[0].id,
      live.length === 1 ? [] : [...preset.board],
      [],
      live.length === 1 ? "terminal" : "segment-end",
    );
    if (live.length === 1) {
      end.returned = Math.max(
        0,
        live[0].contribution -
          Math.max(
            0,
            ...players
              .filter((p) => p.status === "folded")
              .map((p) => p.contribution),
          ),
      );
      end.pot -= end.returned;
    }
    return nodes;
  }
  const [oop, ip] = live.map((p) => p.id);
  if (!preset.post) {
    add("f-oop", parent, via, oop, [...preset.board], [], "segment-end");
    return nodes;
  }
  for (const [street, board] of [
    ["f", [...preset.board]],
    ["t", [...preset.board, "Th"]],
    ["r", [...preset.board, "Th", "4c"]],
  ] as [string, string[]][]) {
    for (const p of live)
      weights[p.id] = Object.fromEntries(
        allCombos.map((c) => [c, legalCombo(c, board) ? weights[p.id][c] : 0]),
      );
    const n = add(`${street}-oop`, parent, via, oop, board, [
      { id: "check", label: "过牌", type: "check" },
      {
        id: "bet",
        label: "下注 33%",
        type: "bet",
        to:
          players.find((p) => p.id === oop)!.contribution +
          Math.round(players.reduce((s, p) => s + p.contribution, 0) * 0.33),
      },
    ]);
    weights[oop] = derive(weights[oop], n.policies[oop], "check", board);
    history.push(`${oop} check`);
    parent = n.id;
    via = "check";
    const amount = Math.round(
        players.reduce((s, p) => s + p.contribution, 0) * 0.33,
      ),
      to = players.find((p) => p.id === ip)!.contribution + amount;
    const b = add(`${street}-ip`, parent, via, ip, board, [
      { id: "check", label: "过牌", type: "check" },
      { id: "bet", label: `下注 ${amount / 100}bb`, type: "bet", to },
    ]);
    nodes.push({
      ...structuredClone(b),
      id: `${street}-checked`,
      parent: b.id,
      via: "check",
      actor: "",
      kind: "segment-end",
      actions: [],
      policies: {},
      history: [...history, `${ip} check`],
      weights: {
        ...structuredClone(weights),
        [ip]: derive(weights[ip], b.policies[ip], "check", board),
      },
    });
    weights[ip] = derive(weights[ip], b.policies[ip], "bet", board);
    players = applyAction(players, ip, {
      id: "bet",
      label: "下注",
      type: "bet",
      to,
    });
    history.push(`${ip} bet ${amount / 100}bb`);
    parent = b.id;
    via = "bet";
    const response = add(`${street}-response`, parent, via, oop, board, [
      { id: "fold", label: "弃牌", type: "fold" },
      { id: "call", label: `跟注 ${amount / 100}bb`, type: "call", to },
    ]);
    const folds = applyAction(players, oop, {
      id: "fold",
      type: "fold",
      label: "弃牌",
    });
    nodes.push({
      ...structuredClone(response),
      id: `${street}-fold`,
      parent: response.id,
      via: "fold",
      kind: "terminal",
      actor: "",
      players: folds,
      pot: response.pot - amount,
      returned: amount,
      actions: [],
      policies: {},
      history: [...history, `${oop} fold`],
    });
    weights[oop] = derive(weights[oop], response.policies[oop], "call", board);
    players = applyAction(players, oop, {
      id: "call",
      label: "跟注",
      type: "call",
      to,
    });
    history.push(`${oop} call ${amount / 100}bb`);
    parent = response.id;
    via = "call";
    const end = add(
      `${street}-end`,
      parent,
      via,
      "",
      board,
      [],
      street === "r" ? "segment-end" : "chance",
    );
    parent = end.id;
    via = "deal";
  }
  return nodes;
}
// Each tuple is an explicitly authored (equity, first-action EV, second-action EV) example.
// The key includes the scenario and street; no fallback metrics are attached to other input.
const metricBook: Record<string, Record<string, number[][]>> = {
  "H-SRP": {
    f: [
      [0.81, 1.2, 1.4],
      [0.58, 0.6, 0.59],
      [0.24, 0.12, 0.1],
    ],
    t: [
      [0.79, 1.1, 1.3],
      [0.54, 0.5, 0.49],
      [0.32, 0.2, 0.18],
    ],
    r: [
      [0.86, 1.6, 1.7],
      [0.63, 0.7, 0.69],
      [0.1, 0.04, 0.03],
    ],
  },
  "X-BB": {
    f: [
      [0.78, 1.1, 1.2],
      [0.55, 0.51, 0.5],
      [0.22, 0.1, 0.09],
    ],
    t: [
      [0.76, 1.0, 1.15],
      [0.52, 0.45, 0.44],
      [0.3, 0.18, 0.16],
    ],
    r: [
      [0.84, 1.45, 1.5],
      [0.61, 0.65, 0.63],
      [0.09, 0.03, 0.02],
    ],
  },
  "X-3BP": {
    f: [
      [0.72, 2.1, 2.3],
      [0.65, 1.6, 1.5],
      [0.3, 0.42, 0.4],
    ],
    t: [
      [0.7, 1.9, 2.1],
      [0.62, 1.3, 1.2],
      [0.38, 0.5, 0.45],
    ],
    r: [
      [0.8, 2.5, 2.6],
      [0.67, 1.8, 1.7],
      [0.13, 0.1, 0.08],
    ],
  },
};
export function pageFor(
  node: AnalysisNode,
  presetId = "H-SRP",
  locked = false,
): SolutionPage {
  const metrics: SolutionPage["metrics"] = {};
  const sample = metricBook[presetId]?.[node.id[0]];
  if (!locked && sample && node.kind === "decision") {
    const player = node.actor;
    metrics[player] = Object.fromEntries(
      ["AhAd", "KhKd", "QhJh"]
        .filter(
          (c) =>
            legalCombo(c, node.board) && (node.weights[player]?.[c] ?? 0) > 0,
        )
        .map((c) => {
          const values = sample[["AhAd", "KhKd", "QhJh"].indexOf(c)];
          return [
            c,
            {
              equity: values[0],
              ev: Object.fromEntries(
                node.actions.map((a, i) => [
                  a.id,
                  a.id === "fold" ? 0 : values[i + 1],
                ]),
              ),
              unit: "bb",
              origin: "current-node",
              invested: "excluded",
              rake: "none",
              dataKind: "synthetic",
            },
          ];
        }),
    );
  }
  return { node, metrics };
}
export function validateContent(nodes: AnalysisNode[]): string[] {
  const errors: string[] = [];
  if (new Set(nodes.map((n) => n.id)).size !== nodes.length)
    errors.push("duplicate node id");
  for (const n of nodes) {
    if (n.parent && !nodes.some((p) => p.id === n.parent))
      errors.push(`${n.id}: parent`);
    if (
      new Set(n.board).size !== n.board.length ||
      ![0, 3, 4, 5].includes(n.board.length) ||
      n.board.some((c) => !/^[AKQJT2-9][shdc]$/.test(c))
    )
      errors.push(`${n.id}: cards`);
    if (
      n.kind === "decision" &&
      (!n.actions.length ||
        new Set(n.actions.map((a) => a.id)).size !== n.actions.length ||
        !n.players.some((p) => p.id === n.actor && p.status === "active"))
    )
      errors.push(`${n.id}: actions/actor`);
    if (
      n.players.some(
        (p) =>
          !Number.isInteger(p.remaining) ||
          !Number.isInteger(p.contribution) ||
          p.remaining < 0 ||
          p.contribution < 0 ||
          p.remaining + p.contribution !== p.initial,
      )
    )
      errors.push(`${n.id}: player ledger`);
    let parent = n.parent;
    let depth = 0;
    while (parent && depth++ <= nodes.length)
      parent = nodes.find((p) => p.id === parent)?.parent;
    if (depth > nodes.length) errors.push(`${n.id}: cycle`);
    if (
      n.pot !==
      n.players.reduce((s, p) => s + p.contribution, 0) - (n.returned ?? 0)
    )
      errors.push(`${n.id}: ledger`);
    for (const [p, policy] of Object.entries(n.policies))
      for (const c of allCombos)
        if (
          n.weights[p][c] > 0 &&
          legalCombo(c, n.board) &&
          (!policy[c] ||
            Object.values(policy[c]).some(
              (v) => !Number.isInteger(v) || v < 0 || v > 10000,
            ) ||
            Object.values(policy[c]).reduce((s, v) => s + v, 0) !== 10000)
        )
          errors.push(`${n.id}: probability ${c}`);
  }
  return errors;
}
