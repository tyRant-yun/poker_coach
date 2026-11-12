import type { RangeInputs } from '../modules/study/domain';
import { actionsFor, activeCombos, allCombos, canonicalPolicy, spotSignature } from '../modules/study/domain';
import { btnRange, bbRange, fixtureVersion } from '../fixtures/s01';
import { authoredMetrics, matchingReference } from '../fixtures/scenarios';
import { defaultSettings } from '../modules/product/domain';
import type { SolverPort } from '../ports';
import { solveResultSchema } from '../persistence/schema';

function delay(ms: number, signal: AbortSignal, skip?: AbortSignal) {
  return new Promise<void>((resolve,reject) => {
    if (signal.aborted) { reject(new DOMException('已取消','AbortError')); return; }
    if (skip?.aborted) { resolve(); return; }
    const clean = () => { clearTimeout(timer); signal.removeEventListener('abort',cancel); skip?.removeEventListener('abort',finish); };
    const finish = () => { clean(); resolve(); };
    const cancel = () => { clean(); reject(new DOMException('已取消','AbortError')); };
    const timer = setTimeout(finish,ms);
    signal.addEventListener('abort',cancel,{once:true}); skip?.addEventListener('abort',finish,{once:true});
  });
}
export function createMockSolver(waitMs = 650): SolverPort {
  return { async solve(input,onStage,signal,skip) {
    const settings = input.settings ?? defaultSettings;
    const ranges: RangeInputs = input.ranges ?? { BTN:btnRange,BB:bbRange };
    onStage('预检范围、树与演示资源','preflight');
    await delay(settings.speed === 'fast' ? 1 : Math.min(waitMs,200),signal,skip);
    if (!activeCombos(input.spot,ranges[input.spot.actor] ?? ranges.BTN).length) throw new Error('当前行动范围为空，预检未通过。');
    if (settings.outcome === 'resource-limit') throw new Error('示例资源限制：本次规格超过模拟预算。规格已保留，未删减尺寸或精度。');
    onStage('正在读取预置节点与范围参考','running');
    await delay(settings.speed === 'fast' ? 1 : settings.outcome === 'slow' ? 6000 : waitMs,signal,skip);
    if (settings.outcome === 'fail-once' && (input.executionAttempt ?? 1) === 1) throw new Error('脚本化首次失败；请显式重试，本次没有生成结果。');
    onStage('校验输入绑定并整理示例结果','postprocessing');
    await delay(settings.speed === 'fast' ? 1 : Math.min(waitMs,150),signal,skip);
    const rangeKey = JSON.stringify(Object.keys(ranges).sort().map(player => [player,allCombos.map(c => [c,ranges[player][c] ?? 0])]));
    const key = spotSignature(input.spot) + rangeKey + canonicalPolicy(input.choices ?? {},activeCombos(input.spot,ranges[input.spot.actor] ?? ranges.BTN),actionsFor(input.spot));
    const hash = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
    const inputFingerprint = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2,'0')).join('');
    const reference = settings.outcome === 'unsupported' ? null : matchingReference(input.spot,ranges);
    return solveResultSchema.parse({dataKind:'synthetic',fixtureVersion,inputFingerprint,nodeId:input.spot.nodeId ?? 'S01-root',unit:input.spot.unit ?? 'bb',
      availability:settings.outcome === 'unsupported' ? 'unsupported' : reference ? 'available' : 'uncovered',reference,
      quality:reference ? settings.outcome === 'incomplete-quality' ? 'demo-incomplete' : 'demo-target-met' : 'not-evaluated',
      metrics:reference ? authoredMetrics(input.spot,reference) : undefined,
      reason:settings.outcome === 'unsupported' ? '演示能力配置不支持本次请求。输入已保留。' : reference ? '作者编写的合成节点、范围、权益与 EV 示例；没有真实求解。质量标签仅演示生命周期。' : '当前条件、范围、上游或锁定假设没有匹配的演示数据。输入已保留，未套用其他局面结果。'});
  } };
}
