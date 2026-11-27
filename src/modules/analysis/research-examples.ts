import { handClasses } from "../study/domain";
function range(labels: string[], board: string[], mixed = false) {
  const dead = new Set(board);
  return labels
    .flatMap((label, index) =>
      handClasses
        .find((h) => h.label === label)!
        .combos.filter((c) => !dead.has(c.slice(0, 2)) && !dead.has(c.slice(2)))
        .map(
          (c, i) => `${c}:${mixed ? ((index + i) % 3 === 0 ? 35 : 70) : 100}`,
        ),
    )
    .join("\n");
}
const board1 = ["2c", "3d", "7h", "9s", "Jc"],
  board2 = ["As", "9h", "7d", "4c", "2h"];
export const researchExamples = [
  {
    id: "flop-three-street/v5",
    name: "翻牌三街研究",
    model: "flop",
    board: "9h 8h 2c",
    pot: "2",
    stack: "20",
    betPercent: "50",
    treeText: "",
    flopOop: "1",
    flopIp: "1",
    turnOop: "1",
    turnIp: "1",
    riverOop: "1",
    riverIp: "1",
    oop: "JhTh:100",
    ip: "AcAd:100",
  },
  {
    id: "turn-river/v3",
    name: "转牌到河牌",
    model: "turn",
    board: "2c 3d 7h 9s",
    pot: "10",
    stack: "20",
    betPercent: "100",
    treeText: "",
    turnOop: "5",
    turnIp: "0",
    riverOop: "0",
    riverIp: "7",
    oop: "AcAd:100\n5c4c:100",
    ip: "KhKd:100\n8c8d:100",
  },
  {
    id: "river-multi-size/v1",
    name: "多尺寸与加注",
    board: board1.join(" "),
    pot: "10",
    stack: "20",
    betPercent: "100",
    model: "explicit",
    treeText: "下注至 5\n下注至 10\n下注至 5 > 加注至 12\n过牌 > 下注至 5",
    oop: range(
      [
        "AA",
        "KK",
        "QQ",
        "JJ",
        "TT",
        "99",
        "AKs",
        "AQs",
        "KQs",
        "QJs",
        "JTs",
        "T9s",
      ],
      board1,
    ),
    ip: range(
      [
        "AA",
        "KK",
        "QQ",
        "TT",
        "99",
        "88",
        "AKs",
        "AJs",
        "KJs",
        "QJs",
        "JTs",
        "98s",
      ],
      board1,
    ),
  },
  {
    id: "river-blocker-weights/v1",
    name: "阻断与非对称范围",
    board: board2.join(" "),
    pot: "14",
    stack: "21",
    betPercent: "50",
    model: "explicit",
    treeText: "下注至 7\n过牌 > 下注至 14",
    oop: range(
      ["AA", "99", "77", "44", "22", "AKs", "AQs", "AJs", "KQs", "65s"],
      board2,
      true,
    ),
    ip: range(
      ["AA", "KK", "QQ", "99", "77", "AKs", "AQs", "ATs", "KQs", "QJs"],
      board2,
      true,
    ),
  },
] as const;
