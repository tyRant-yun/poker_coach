import { activeCombos, canonicalPolicy, spotSignature } from '../modules/study/domain';
import { btnRange, fixtureVersion, referenceChoices, s01Spot } from '../fixtures/s01';
import type { SolverPort } from '../ports';
import { solveResultSchema } from '../persistence/schema';

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('已取消', 'AbortError')); return; }
    const stop = () => { clearTimeout(timer); reject(new DOMException('已取消', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, ms);
    signal.addEventListener('abort', stop, { once: true });
  });
}
export function createMockSolver(waitMs = 650): SolverPort {
  return { async solve(version, onStage, signal) {
    await delay(waitMs / 2, signal);
    onStage('正在读取预置参考');
    await delay(waitMs, signal);
    const input = spotSignature(version.spot) + canonicalPolicy(version.choices, activeCombos(version.spot, btnRange));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    const inputFingerprint = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    const matched = spotSignature(version.spot) === spotSignature(s01Spot);
    return solveResultSchema.parse({
      dataKind: 'synthetic', fixtureVersion, inputFingerprint,
      availability: matched ? 'available' : 'uncovered',
      reference: matched ? referenceChoices() : null,
      reason: matched ? 'S01 作者编写的合成参考，用于体验范围比较；未经真实 Solver 验证。'
        : '当前局面条件没有匹配的演示数据。你的策略已保留，未套用其他局面结果。',
    });
  } };
}
