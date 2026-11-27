import { validateStrategyPack } from "../../src/modules/play/strategy.ts";
// Deliberately synthetic protocol sample, never a real poker strategy source.
export function strategyFixture() {
  return validateStrategyPack({
    schema: "riverline-strategy/1",
    id: "protocol-test",
    version: "1",
    name: "合成协议测试，非策略答案",
    source: {
      kind: "synthetic-test",
      url: "https://example.com/protocol-test",
      originalSha256: "a".repeat(64),
      producer: "test",
      settings: "two-combo unit test",
      quality: "synthetic, not a solve",
      credit: "test",
      localUseBasis: "self-authored synthetic protocol fixture",
    },
    rules: {
      players: 2,
      stackCentibb: 10000,
      smallBlind: 50,
      bigBlind: 100,
      ante: 0,
      rake: "none",
      objective: "chipEV",
    },
    metric: { unit: "bb", origin: "current-node", invested: "sunk" },
    rootRanges: [
      { AcAd: 1, KhKd: 1 },
      { AsAh: 1, KcKs: 1 },
    ],
    nodes: [
      {
        path: [],
        actor: "BTN/SB",
        actions: [
          { position: "BTN/SB", kind: "call" },
          { position: "BTN/SB", kind: "fold" },
        ],
        rows: {
          AsAh: { frequencies: [0.25, 0.75], actionEvBb: [0, 0] },
          KcKs: { frequencies: [0.8, 0.2], actionEvBb: [0.3, 0] },
        },
        continuation: "synthetic values for protocol only",
      },
    ],
  });
}
