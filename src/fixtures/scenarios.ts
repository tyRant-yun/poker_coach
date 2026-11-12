import { builtInTeachingBundle } from './teaching/content';
import { actions, actionsFor, canonicalAssumption, activeCombos, allCombos, handByCombo, spotSignature } from '../modules/study/domain';
import type { ActionDefinition, Choices, RangeInputs, Spot } from '../modules/study/domain';
import type { HandDecision, KnowledgeItem, NodeLock, Scenario, ScenarioNode } from '../modules/product/domain';
import { bbRange, btnRange, referenceChoices, s01Spot } from './s01';

// Every number, branch range and category below is authored synthetic demo content.
const clone = <T,>(x: T): T => structuredClone(x);
const act = (id: string, name: string, short: string, color: string): ActionDefinition => ({ id, name, short, color });
const defense = [act('fold', '弃牌', 'F', '#85919e'), act('call', '跟注', 'C', '#79aee8'), act('raise', '加注 3 倍', 'R3', '#e6ad6b')];
const river = defense.slice(0, 2);
const threeBet = [actions[0], act('bet25', '下注 25%', 'B25', '#e6ad6b'), act('bet100', '下注 100%', 'B100', '#b697e4')];
const baseRanges: RangeInputs = { BTN: btnRange, BB: bbRange };
function authoredReference(spot: Spot, ranges: RangeInputs, seed: number): Choices {
  const available = actionsFor(spot);
  return Object.fromEntries(activeCombos(spot, ranges[spot.actor] ?? ranges.BTN).map((combo, i) => {
    const first = 1800 + ((i * 7 + seed * 13) % 7) * 700;
    const second = available.length === 2 ? 10000 - first : 1500 + ((i + seed) % 4) * 650;
    return [combo, Object.fromEntries(available.map((a, n) => [a.id, n === 0 ? first : n === 1 ? second : 10000 - first - second]))];
  }));
}
function root(id: string, board: string[], potMinor: number, stackMinor: number, actionSet = actions): ScenarioNode {
  const spot: Spot = id === 'S01' ? clone(s01Spot) : { board, potMinor, stackMinor, unitsPerBb: 100, actor: 'BTN', rangeVersion: `${id}-ranges-v1`, treeVersion: `${id}-tree-v1`, nodeId: `${id}-root`, actionSet };
  const ranges = clone(baseRanges);
  if (id !== 'S01') for (const combo of allCombos) {
    const seed = Number(id.slice(1));
    if (ranges.BTN[combo] > 0 && handByCombo[combo].length > 2) ranges.BTN[combo] = Math.max(2500, ranges.BTN[combo] - seed * 125);
    if (ranges.BB[combo] > 0) ranges.BB[combo] = Math.max(3000, ranges.BB[combo] - seed * 75);
  }
  if (id === 'S09') ranges.CO = Object.fromEntries(allCombos.map((combo, i) => [combo, i % 3 === 0 ? 6500 : 0]));
  if (id === 'S10') spot.unit = '奖池效用点';
  return { id: `${id}-root`, label: board.length === 0 ? '翻前 · BTN 决策' : board.length === 5 ? '河牌 · 面对下注' : '翻牌 · BTN 决策', via: '起始节点', kind: 'decision', spot, ranges, coverage: 'covered', reference: id === 'S01' ? referenceChoices() : authoredReference(spot, ranges, Number(id.slice(1))) };
}
const descriptions = [
  ['S01','BTN vs BB','单加注底池 · 参考与范围构建',['As','7d','2c'],550,9750],
  ['S02','沿行动线探索','翻牌到转牌、河牌 · 三条预置延续',['As','7d','2c'],550,9750],
  ['S03','迁移到另一牌面','K♣8♦3♠ · 独立迁移复测',['Kc','8d','3s'],550,9750],
  ['S04','3-bet 底池','不同下注树 · 多尺度研究',['Qh','Js','4d'],1800,9000],
  ['S05','河牌防守','面对下注 · 跟注与弃牌',['Kh','Td','6c','2s','9d'],2400,6400],
  ['S06','对手假设实验','基准与两种 Node Lock 假设',['Ac','9d','4s'],700,9600],
  ['S07','从复盘进入研究','保留来源 · 行动前节点',['Qs','9h','5d'],650,9500],
  ['S08','翻前范围预览','位置与筹码配置 · 合成报告',[],150,10000],
  ['S09','三人底池预览','BTN / BB / CO · 方法边界',['Jh','8h','3c'],750,9000],
  ['S10','MTT / ICM 预览','筹码结构与价值目标 · 独立效用单位',['Ad','6c','2h'],1200,8000],
] as const;
export const scenarios: Scenario[] = descriptions.map(([id,title,subtitle,board,pot,stack]) => ({ id, title, subtitle, board: [...board], tags: id === 'S10' ? ['MTT','ICM','预览'] : id === 'S09' ? ['多人','三方','预览'] : id === 'S08' ? ['翻前','预览'] : ['现金局', board.length === 5 ? '河牌' : '翻牌', id === 'S04' ? '3-bet' : 'SRP'], description: '使用自写合成数据体验策略研究；编辑、保存和跨模块操作真实执行。', nodes: [root(id,[...board],pot,stack,id === 'S05' ? river : id === 'S04' ? threeBet : id === 'S08' ? [act('fold','弃牌','F','#85919e'),act('call','平跟','C','#79aee8'),act('raise25','加注至 2.5 bb','R2.5','#e6ad6b')] : actions)], preview: ['S08','S09','S10'].includes(id), unit: id === 'S10' ? '奖池效用点' : 'bb' }));
const s02 = scenarios[1];
function branch(id: string, parent: string, label: string, via: string, board: string[], actor = 'BTN', actionSet = actions, kind: ScenarioNode['kind'] = 'decision', coverage: ScenarioNode['coverage'] = 'covered') {
  const spot: Spot = { ...clone(s02.nodes[0].spot), board, actor, actionSet, nodeId: id, potMinor: board.length === 5 ? 1850 : 910, stackMinor: board.length === 5 ? 9100 : 9570 };
  const ranges = clone(s02.nodes[0].ranges);
  for (const combo of allCombos) if (ranges.BTN[combo] > 0) ranges.BTN[combo] = Math.round(ranges.BTN[combo] * (id.includes('check') ? .8 : .65));
  s02.nodes.push({ id, parent, label, via, kind, coverage, spot, ranges, reference: kind === 'decision' && coverage === 'covered' ? authoredReference(spot,ranges,s02.nodes.length + 12) : undefined });
}
branch('S02-bb','S02-root','BB 回应小注','BTN B33',['As','7d','2c'],'BB',defense);
branch('S02-deal','S02-bb','选择转牌','BB 跟注',['As','7d','2c'],'BTN',actions,'chance');
branch('S02-turn','S02-deal','转牌 · BTN 决策','T♥ · BB 过牌',['As','7d','2c','Th']);
branch('S02-river','S02-turn','河牌 · 面对下注','双方过牌 → 9♠ · BB B75',['As','7d','2c','Th','9s'],'BTN',river);
branch('S02-check-deal','S02-root','双方过牌 · 选择转牌','BTN 过牌',['As','7d','2c'],'BTN',actions,'chance');
branch('S02-check-turn','S02-check-deal','转牌 · 面对下注','K♦ · BB B75',['As','7d','2c','Kd'],'BTN',defense);
branch('S02-large-deal','S02-root','大注被跟注 · 选择转牌','BTN B75 / BB 跟注',['As','7d','2c'],'BTN',actions,'chance');
branch('S02-large-turn','S02-large-deal','转牌 · 大注路径','Q♣ · BB 过牌',['As','7d','2c','Qc']);
s02.nodes.find(n=>n.id==='S02-large-turn')!.spot.potMinor=1375;
branch('S02-fold','S02-bb','BB 弃牌 · 本手结束','BB 弃牌',['As','7d','2c'],'BTN',[],'terminal');
branch('S02-unknown','S02-deal','其他转牌 · 未覆盖','5♣',['As','7d','2c','5c'],'BTN',actions,'decision','uncovered');
branch('S02-unreachable','S02-fold','终局之后没有行动','无后续决策',['As','7d','2c'],'BTN',[],'terminal','unreachable');
const transferTurnSpot: Spot = {...clone(scenarios[2].nodes[0].spot),nodeId:'S03-turn',board:['Kc','8d','3s','Th'],potMinor:910,stackMinor:9570};
scenarios[2].nodes.push({id:'S03-turn',parent:'S03-root',label:'迁移转牌节点',via:'双方过牌 → T♥',kind:'decision',coverage:'covered',spot:transferTurnSpot,ranges:clone(scenarios[2].nodes[0].ranges),reference:authoredReference(transferTurnSpot,scenarios[2].nodes[0].ranges,39)});
export function scenarioFor(id: string) { return scenarios.find(s => s.id === id); }
export function nodeFor(spot: Spot): ScenarioNode | undefined {
  if (!spot.nodeId) return scenarioFor('S01')!.nodes[0];
  return scenarios.flatMap(s => s.nodes).find(n => n.id === spot.nodeId);
}
export function descendants(scenarioId: string, nodeId: string): string[] {
  const nodes = scenarioFor(scenarioId)?.nodes ?? [];
  const result = new Set<string>();
  let changed = true;
  while (changed) { changed = false; for (const n of nodes) if (n.parent === nodeId || (n.parent && result.has(n.parent))) { if (!result.has(n.id)) { result.add(n.id); changed = true; } } }
  return [...result];
}
export function experimentPreset(variant: 'overfold' | 'sticky'): { spot: Spot; ranges: RangeInputs; lock: NodeLock; reference: Choices } {
  const base = clone(scenarioFor('S06')!.nodes[0]);
  const combos = activeCombos(base.spot,base.ranges.BB).slice(0,12);
  const lock: NodeLock = { player:'BB',nodeId:'S06-root',combos,allocation:variant === 'overfold' ? {fold:8000,call:2000,raise:0} : {fold:1000,call:9000,raise:0},completion:'reference' };
  base.spot.assumption = JSON.stringify(lock);
  const reference = authoredReference(base.spot,base.ranges,variant === 'overfold' ? 51 : 72);
  return { spot:base.spot,ranges:base.ranges,lock,reference };
}
export function matchingReference(spot: Spot, ranges: RangeInputs): Choices | null {
  const node = nodeFor(spot);
  if (!node || node.coverage !== 'covered' || node.kind !== 'decision' || spot.upstream) return null;
  let expected = node.spot, reference = node.reference;
  if (spot.assumption) {
    const p = (['overfold','sticky'] as const).map(experimentPreset).find(p => canonicalAssumption(p.spot.assumption) === canonicalAssumption(spot.assumption));
    if (!p || !spot.nodeId?.startsWith('S06')) return null;
    expected = p.spot; reference = p.reference;
  }
  if (spotSignature(spot) !== spotSignature(expected)) return null;
  if ([...new Set([...Object.keys(ranges),...Object.keys(node.ranges)])].some(player => allCombos.some(combo => (ranges[player]?.[combo] ?? 0) !== (node.ranges[player]?.[combo] ?? 0)))) return null;
  return reference ? clone(reference) : null;
}
export function authoredMetrics(spot: Spot, reference: Choices) {
  if(spot.nodeId?.startsWith('TP'))return undefined;
  return Object.fromEntries(Object.keys(reference).map((combo,i) => [combo,{ equity: .23 + ((i * 11 + spot.board.length * 17) % 64) / 100, ev: Object.fromEntries(actionsFor(spot).map((a,n) => [a.id, Number((.12 + ((i * 3 + n * 7) % 43) / 20).toFixed(2))])), category: handByCombo[combo].length === 2 ? '口袋对子示例组' : i % 3 === 0 ? '成牌示例组' : i % 3 === 1 ? '听牌示例组' : '其他示例组' }]));
}
export const knowledge: KnowledgeItem[] = [
  ['K01','范围优势','比较双方整个范围的分布，而非仅看 Hero 一手牌。','具体结论取决于双方输入范围、牌面和行动历史。','https://help.gtowizard.com/study-mode/',['范围','权益'],['S01','S04']],
  ['K02','坚果分布','关注范围顶部强牌的分布，结合下注树观察策略构成。','顶部强牌不等于整个范围拥有同样优势。','https://site.piosolver.com/docs/feature_overview/',['坚果','范围'],['S02','S04']],
  ['K03','极化与下注范围','比较大注与小注中的组合构成，记录价值与诈唬的研究假设。','此处的组合类别为合成标签，不用于证明实际最优比例。','https://help.gtowizard.com/study-mode/',['极化','下注'],['S05','S06']],
  ['K04','混合策略','同一组合可在多个动作之间分配概率，分配差异与收益损失需分别评价。','参考频率相近不保证低可利用性；总概率必须归一。','https://site.piosolver.com/docs/feature_overview/',['频率','混合'],['S01','S03']],
  ['K05','阻断与具体花色','具体手牌的花色改变可用组合；应结合对手范围理解移除效应。','同牌类不同花色不能仅凭标签强行采用相同策略。','https://help.gtowizard.com/study-mode/',['阻断','花色'],['S01','S02']],
  ['K06','过牌范围保护','查看过牌范围中保留了哪些强牌，作为后续分支研究的问题。','此演示不计算最佳回应，不将强牌比例直接判为保护充分。','https://www.gtoplus.com/videos2/',['过牌','保护'],['S01','S03']],
  ['K07','尺度与后续行动','改变树中的尺寸会改变研究问题，应固定版本后比较后续节点。','预置树之外没有对应示例时，显示未覆盖。','https://site.piosolver.com/docs/feature_overview/',['尺度','后续'],['S02','S04']],
  ['K08','评价条件与假设实验','分别记录结构完整、参考差异、固定对手收益和对抗性评价的条件。','Node Lock 修改对手假设，合成趋势不能当作已验证扑克规律。','https://site.piosolver.com/docs/feature_overview/',['评价','实验'],['S05','S06']],
].map(([id,title,claim,conditions,source,tags,scenarioIds]) => ({ id,title,claim,conditions,source,tags,scenarioIds,experiment:id === 'K08' })) as KnowledgeItem[];
export const completeHandText = 'RIVERLINE DEMO HAND 001\nBTN AhQh / BB hidden\nPreflop BTN raises 2.5bb, BB calls\nFlop Qs 9h 5d: BB checks, BTN bets 2bb, BB calls\nTurn 2c: BB checks, BTN checks\nRiver 7s: BB bets 5bb, BTN calls\nShowdown BB QdJd';
export const incompleteHandText = 'RIVERLINE DEMO HAND INCOMPLETE\nBTN AhQh\nFlop Qs 9h 5d\nPot and actions unknown';
export const handDecisions: HandDecision[] = [
  { id:'flop',label:'翻牌 · BTN 行动前',board:['Qs','9h','5d'],actor:'BTN',potMinor:650,stackMinor:9500,actionHistory:['BTN 加注至 2.5 bb','BB 跟注','翻牌 BB 过牌'],hero:'AhQh',future:'转牌 2c，河牌 7s',opponent:'QdJd' },
  { id:'turn',label:'转牌 · BTN 行动前',board:['Qs','9h','5d','2c'],actor:'BTN',potMinor:1050,stackMinor:9300,actionHistory:['BTN 加注至 2.5 bb','BB 跟注','翻牌 BB 过牌','BTN 下注 2 bb','BB 跟注','转牌 BB 过牌'],hero:'AhQh',future:'河牌 7s',opponent:'QdJd' },
  { id:'river',label:'河牌 · BTN 行动前',board:['Qs','9h','5d','2c','7s'],actor:'BTN',potMinor:1550,stackMinor:9300,actionHistory:['翻牌 BTN B2 / BB 跟注','转牌双方过牌','河牌 BB 下注 5 bb'],hero:'AhQh',future:'BTN 跟注后摊牌',opponent:'QdJd' },
];

for(const decision of handDecisions.slice(1)){
  const base=scenarioFor('S07')!.nodes[0],spot:Spot={...clone(base.spot),nodeId:`S07-${decision.id}`,board:[...decision.board],potMinor:decision.potMinor,stackMinor:decision.stackMinor,actionSet:decision.id==='river'?river:actions};
  scenarioFor('S07')!.nodes.push({id:spot.nodeId!,parent:decision.id==='river'?'S07-turn':'S07-root',via:'手牌预置延续',label:decision.label,kind:'decision',coverage:'covered',spot,ranges:clone(base.ranges),reference:authoredReference(spot,base.ranges,decision.id==='river'?81:65)});
}

// Authored report templates, only used after complete input and policy matching.
export function evaluationTemplate(spot:Spot,template:'check'|'reference'){
  const id=spot.nodeId??'S01-root', variant=spot.assumption?(['overfold','sticky']as const).find(v=>canonicalAssumption(experimentPreset(v).spot.assumption)===canonicalAssumption(spot.assumption)):undefined;
  const ledger:Record<string,[number,number,number,number]>={'S01-root':[2.04,1.86,1.88,1.10],'S02-root':[2.10,1.72,1.81,1.01],'S02-bb':[.65,0,.42,0],'S02-turn':[1.70,1.30,1.42,.90],'S02-check-turn':[.85,0,.60,0],'S02-river':[.80,0,.64,0],'S02-large-turn':[1.90,1.50,1.62,1.03],'S03-root':[1.93,1.58,1.66,.92],'S03-turn':[1.44,1.12,1.20,.73],'S04-root':[4.60,3.80,3.90,2.60],'S05-root':[1.10,0,.78,0],'S06-root':variant==='overfold'?[3.40,2.60,2.71,1.80]:variant==='sticky'?[2.00,1.50,1.51,.92]:[2.30,2.00,1.90,1.20],'S07-root':[2.11,1.72,1.82,1.06],'S07-turn':[2.00,1.60,1.69,1.02],'S07-river':[.95,0,.65,0],'S08-root':[1.20,0,0,0],'S09-root':[1.30,1.00,0,0],'S10-root':[.12,.09,0,0]};
  const row=ledger[id];if(!row)return null;const index=template==='reference'?0:1;
  return {value:row[index],loss:template==='reference'?0:Number((row[0]-row[1]).toFixed(4)),adversarial:['S08','S09','S10'].some(prefix=>id.startsWith(prefix))?null:{value:row[index+2],unit:spot.unit??'bb',model:'单挑固定假设下的作者编写对抗评价示例，未经最佳回应计算'}};
}

// Teaching examples have independent input identities and no strategic EV metrics.
for(const pkg of Object.values(builtInTeachingBundle.packages)) {
  const selected=Object.values(builtInTeachingBundle.nodes).filter(n=>n.id.startsWith(pkg.scenarioId));
  scenarios.push({id:pkg.scenarioId,title:pkg.title,subtitle:'概念教学 · 作者示意范围 · 无真实 GTO 数值',board:builtInTeachingBundle.nodes[pkg.rootNode].spot.board,tags:['教学',pkg.id==='LP-A'?'翻前':'翻牌','concept-demo'],description:pkg.description+' 策略分布是作者设定，未接真实求解。',unit:'bb',nodes:selected.map(n=>({id:n.id,label:n.label,parent:n.parent,via:n.via,kind:n.kind==='segment-end'?'terminal':n.kind,spot:n.spot,ranges:n.ranges,reference:n.reference,coverage:'covered'}))});
}
