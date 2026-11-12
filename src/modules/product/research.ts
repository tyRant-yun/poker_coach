import { actionsFor, activeCombos, validAllocation } from '../study/domain';
import type { ScenarioId, StudyCase } from '../study/domain';
import type { ProductContext, Result } from './context';
import { capture, copy, uid } from './context';
import { defaultSettings, emptyProduct } from './domain';
import type { NodeLock } from './domain';
import { descendants, experimentPreset, knowledge, scenarioFor } from '../../fixtures/scenarios';
import { settingsSchema } from '../../persistence/schema';

export function createResearchCommands(ctx: ProductContext) {
  return {
    createScenario(id: ScenarioId): Result<string> {
      const scenario = scenarioFor(id);
      return scenario ? ctx.base.createCase(scenario.title,id) : ctx.fail('场景未找到。');
    },
    visitNode(caseId: string,nodeId: string,expectedRevision: number): Result {
      const c = ctx.getCase(caseId), node = c && scenarioFor(c.scenarioId)?.nodes.find(n => n.id === nodeId);
      if (!c || c.draft.editRevision !== expectedRevision || !node) return ctx.fail('输入已变化或节点不存在。');
      if (node.kind !== 'decision' || node.coverage === 'unreachable') return ctx.fail('这是发牌/终局节点，请选择其下方可研究的决策节点。');
      const currentId = c.spot.nodeId ?? `${c.scenarioId}-root`;
      if (currentId === nodeId) return {ok:true,value:undefined};
      const parked = {...c.nodeDrafts,[currentId]:capture(c)};
      const previous = parked[nodeId];
      const stale = c.staleNodes?.includes(nodeId);
      const spot = previous ? copy(previous.spot) : copy(node.spot);
      if (stale) spot.upstream = `needs-review:${c.spotRevisionId}`;
      else if(spot.upstream?.startsWith('needs-review:')) delete spot.upstream;
      ctx.replaceCase({...c,nodeDrafts:parked,spot,spotRevisionId:stale ? uid('spot') : previous?.spotRevisionId ?? uid('spot'),ranges:copy(previous?.ranges ?? node.ranges),draft:{editRevision:c.draft.editRevision+1,choices:copy(previous?.choices ?? {}),lockedCombos:previous?.lockedCombos ?? [],assistance:previous?.assistance},editHistory:{past:[],future:[]}});
      ctx.notice(stale ? '上游已修改；此节点保留输入并标记需复核，不套用原参考。' : '已切换节点；原节点草稿和固定版本保留。','info');
      return {ok:true,value:undefined};
    },
    toggleFavorite(id: string) { const c=ctx.getCase(id); if(c) ctx.replaceCase({...c,favorite:!c.favorite}); },
    updateSettings(value: unknown): Result {
      const parsed = settingsSchema.safeParse(value);
      if(!parsed.success) return ctx.fail('演示设置无效，预算须为 1–50。');
      const data = ctx.getData(), product = data.product ?? emptyProduct();
      ctx.replaceData({...data,product:{...product,settings:parsed.data}});
      ctx.notice('演示设置已保存；已运行的任务保留原配置。');
      return {ok:true,value:undefined};
    },
    createExperiment(caseId: string,versionId: string,variant: 'overfold'|'sticky',customLock?: NodeLock): Result<string> {
      const c=ctx.getCase(caseId),v=c?.versions.find(v=>v.id===versionId);
      if(!c || !v || c.scenarioId !== 'S06') return ctx.fail('请在 S06 提交基准版本后建立实验。');
      const preset=experimentPreset(variant), lock=customLock ?? preset.lock;
      if(lock.player !== 'BB' || lock.nodeId !== 'S06-root' || !lock.combos.length || lock.completion !== 'reference' || !validAllocation(lock.allocation,[{id:'fold',name:'弃牌',short:'F',color:''},{id:'call',name:'跟注',short:'C',color:''},{id:'raise',name:'加注',short:'R',color:''}]) || lock.combos.some(combo=>!activeCombos(v.spot,v.ranges!.BB).includes(combo))) return ctx.fail('锁定需指定当前 BB 可用组合，F/C/R 合计 100%，其余由参考补全。');
      const made=ctx.base.forkVersion(caseId,versionId,`${c.name} · ${variant==='overfold'?'过度弃牌':'偏多跟注'}假设`);
      if(!made.ok) return made;
      const branch=ctx.getCase(made.value)!;
      const spot={...copy(v.spot),assumption:JSON.stringify({...lock,combos:[...lock.combos]})};
      ctx.editCase(branch,{...branch,spot,spotRevisionId:uid('spot'),experiment:{baselineCaseId:caseId,baselineVersionId:versionId,variant,lock:copy(lock)},draft:{...branch.draft,choices:{},assistance:'example'}},'建立 Node Lock 假设');
      ctx.notice('实验分支已建立；完整锁定规格固定到输入，自定义组合无匹配报告时会显示未覆盖。','info');
      return made;
    },
  };
}
export const researchQueries = {
  settings:(data?:{product?:{settings:typeof defaultSettings}}) => data?.product?.settings ?? defaultSettings,
  nodes:(c: StudyCase) => (scenarioFor(c.scenarioId)?.nodes ?? []).map(({reference,...n})=>({...n,stale:c.staleNodes?.includes(n.id) ?? false,descendants:descendants(c.scenarioId,n.id)})),
  knowledge:(search='',scenarioId?:string) => knowledge.filter(k=>(!search || `${k.title}${k.tags.join(' ')}${k.claim}`.includes(search)) && (!scenarioId || k.scenarioIds.some(id=>id===scenarioId))).map(copy),
  scenario:(id: string) => { const scenario=scenarioFor(id); if(!scenario) return null; const {nodes,...meta}=scenario; return {...meta,root:copy(nodes[0].spot)}; },
  actionNames:(c: StudyCase) => actionsFor(c.spot),
};
