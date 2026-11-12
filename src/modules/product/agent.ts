import { activeIndependent } from '../teaching/queries';
import { actionsFor, activeCombos, validAllocation } from '../study/domain';
import type { Choices, StudyCase } from '../study/domain';
import { capture, copy, now, uid } from './context';
import type { ProductContext, Result } from './context';
import { emptyProduct } from './domain';
import type { Mission } from './domain';
import { knowledge, matchingReference, scenarioFor } from '../../fixtures/scenarios';
import type { createResearchCommands } from './research';
import type { createLearningCommands } from './learning';

export const missionNames={improve:'诊断并建立改进分支',experiment:'建立对照实验',training:'生成训练计划'};
const steps={improve:['读取固定上下文','检索理论条件','新建分支并应用参考 patch','提交与模拟评价','登记带引用的报告'],experiment:['读取固定上下文','检索理论条件','建立基准与两个假设分支','运行三份固定模拟','登记有条件的实验报告'],training:['读取固定上下文','检索理论条件','生成训练计划草稿','登记计划与题组入口']};
export function createAgentCommands(ctx:ProductContext,research:ReturnType<typeof createResearchCommands>,learning:ReturnType<typeof createLearningCommands>) {
  const executing=new Map<string,Promise<Result>>(),loops=new Map<string,Promise<Result>>(),linkedJobs=new Map<string,{caseId:string;jobId:string}>();
  const get=(id:string)=>ctx.getData().product?.missions[id];
  function put(mission:Mission){const data=ctx.getData(),product=data.product??emptyProduct();ctx.replaceData({...data,product:{...product,missions:{...product.missions,[mission.id]:mission}}});}
  function update(id:string,patch:Partial<Mission>){const m=get(id);if(m)put({...m,...patch});}
  function ownedBranch(m:Mission):StudyCase|null {
    const existing=Object.values(ctx.getData().cases).find(c=>c.agentSource?.missionId===m.id);if(existing)return existing;
    const source=ctx.getCase(m.caseId);if(!source||!m.input)return null;
    const id=uid('case'),snapshot=m.input;
    const branch:StudyCase={id,name:`${source.name} · Agent 示例分支`,scenarioId:source.scenarioId,createdAt:now(),updatedAt:now(),spot:copy(snapshot.spot),spotRevisionId:snapshot.spotRevisionId,ranges:copy(snapshot.ranges??scenarioFor(source.scenarioId)!.nodes[0].ranges),draft:{editRevision:0,choices:copy(snapshot.choices),lockedCombos:copy(snapshot.lockedCombos),assistance:snapshot.assistance},versions:[],jobs:[],reports:[],heroPlans:[],note:'脚本化 Agent 在读取快照上创建，原草稿保留。',agentSource:{missionId:m.id,sourceCaseId:source.id,editRevision:m.expectedRevision}};
    ctx.replaceCase(branch);return branch;
  }
  async function solveOwned(missionId:string,caseId:string,versionId:string){
    const c=ctx.getCase(caseId)!;
    const existing=c.jobs.find(j=>j.policyRevisionId===versionId&&j.status==='completed');
    if(existing)return {ok:true as const,value:existing.id};
    const pending=ctx.base.requestSolve(caseId,versionId),job=ctx.getCase(caseId)!.jobs.at(-1)!;
    linkedJobs.set(missionId,{caseId,jobId:job.id});
    try{return await pending;}finally{linkedJobs.delete(missionId);}
  }
  const api={
    startMission(caseId:string,intent:keyof typeof missionNames|string,mode:'suggest'|'branch'='branch',practiceId?:string):Result<string>{
      if(activeIndependent(ctx.getData().teaching))return ctx.fail('独立题期间不运行研究 Agent；请在当前题目显式请求提示。');
      if(practiceId)return ctx.fail('训练上下文不能启动读取参考或改写研究的脚本。请使用练习内提示，辅助状态会被记录。');
      const kind=Object.keys(missionNames).includes(intent)?intent as keyof typeof missionNames:/实验|对照/.test(intent)?'experiment':/训练|计划/.test(intent)?'training':/分析|诊断|改进/.test(intent)?'improve':null;
      if(!kind)return ctx.fail('未匹配脚本。支持：诊断并改进、建立对照实验、生成训练计划。没有执行工具。');
      const c=ctx.getCase(caseId);if(!c)return ctx.fail('请选择研究案例。');if(kind==='experiment'&&c.scenarioId!=='S06')return ctx.fail('对照实验脚本使用 S06 的完整预置假设；请先打开 S06。');
      const id=uid('mission');put({id,caseId,kind,mode,status:'planned',expectedRevision:c.draft.editRevision,input:capture(c),budget:(ctx.getData().product??emptyProduct()).settings.budget,spent:0,cursor:0,trace:[],createdAt:now(),message:'脚本计划已建立，尚未执行。'});return {ok:true,value:id};
    },
    applyAgentPatch(caseId:string,patch:Choices,expectedRevision:number):Result {
      const c=ctx.getCase(caseId);if(!c||c.draft.editRevision!==expectedRevision)return ctx.fail('Agent patch 版本冲突，原草稿已保留。');
      const active=new Set(activeCombos(c.spot,c.ranges![c.spot.actor]));
      if(Object.entries(patch).some(([combo,value])=>!active.has(combo)||!validAllocation(value,actionsFor(c.spot))))return ctx.fail('patch 包含无效组合或概率。');
      const choices={...c.draft.choices};let count=0;for(const [combo,value]of Object.entries(patch))if(!c.draft.lockedCombos?.includes(combo)){choices[combo]=copy(value);count++;}
      ctx.editCase(c,{...c,draft:{...c.draft,choices,assistance:'reference'}},`Agent patch · ${count} 个组合`);return {ok:true,value:undefined};
    },
    stepMission(id:string):Promise<Result>{
      const pending=executing.get(id);if(pending)return pending;
      const perform=async():Promise<Result>=>{
        let m=get(id);if(m?.blockedSource)return ctx.fail(m.blockedSource);if(!m||['completed','cancelled','conflict'].includes(m.status))return ctx.fail('当前任务不可执行下一步。');
        if(m.spent>=m.budget){update(id,{status:'failed',message:'演示额度耗尽；已产生成果保留，可增加本任务预算后继续。'});return ctx.fail('演示额度耗尽。');}
        const tool=steps[m.kind][m.cursor];if(!tool)return {ok:true,value:undefined};
        const trace=[...m.trace,{tool,status:'running',observation:'正在调用本地应用命令。',refs:[] as Mission['trace'][number]['refs']}];
        update(id,{status:'running',spent:m.spent+1,trace,message:tool});
        let refs:Mission['trace'][number]['refs']=[],observation='';
        try{
          if(m.cursor===0){if(!ctx.getCase(m.caseId))throw Error('原案例不存在。');refs=[{type:'case',id:m.caseId}];observation=`已固定 ${m.caseId} 草稿 r${m.expectedRevision} 与局面 ${m.input?.spotRevisionId}。`;}
          else if(m.cursor===1){const c=ctx.getCase(m.caseId)!;refs=knowledge.filter(k=>k.scenarioIds.includes(c.scenarioId)).slice(0,2).map(k=>({type:'knowledge' as const,id:k.id}));if(!refs.length)refs=knowledge.slice(0,2).map(k=>({type:'knowledge' as const,id:k.id}));observation='读取自写理论摘要与来源条件；未调用模型，未生成计算结论。';}
          else if(m.mode==='suggest'){refs=[{type:'case',id:m.caseId}];observation=`仅建议：${tool}。未创建分支、求解或题组。`;}
          else if(m.cursor===2){
            if(ctx.getCase(m.caseId)?.draft.editRevision!==m.expectedRevision&&!m.branchId){update(id,{status:'conflict',message:'读取后草稿已更新；没有覆盖。可在读取快照上另建分支。'});return {ok:false,message:'版本冲突'};}
            if(m.kind==='training'){const existing=m.planId??Object.values(ctx.getData().product?.plans??{}).find(p=>p.missionId===m!.id)?.id;const plan=existing?{ok:true as const,value:existing}:learning.draftTrainingPlan(m.branchId??m.caseId,id);if(!plan.ok)throw Error(plan.message);update(id,{planId:plan.value});refs=[{type:'plan',id:plan.value}];observation='训练计划草稿已登记，执行后会建立四类真实作答会话。';}
            else{
              const branch=ownedBranch(m);if(!branch)throw Error('无法建立读取快照分支。');update(id,{branchId:branch.id});
              const reference=matchingReference(branch.spot,branch.ranges!);if(!reference)throw Error('读取快照无匹配参考，保留分支与输入；没有套用其他局面 patch。');
              const patch:Choices={};for(const [combo,value]of Object.entries(reference))if(!branch.draft.choices[combo]||!validAllocation(branch.draft.choices[combo],actionsFor(branch.spot))||Object.keys(patch).length<8)patch[combo]=value;
              if(m.branchRevision===undefined){const applied=api.applyAgentPatch(branch.id,patch,branch.draft.editRevision);if(!applied.ok)throw Error(applied.message);}
              const current=ctx.getCase(branch.id)!;update(id,{branchRevision:current.draft.editRevision});refs=[{type:'case',id:branch.id}];
              if(m.kind==='experiment'){
                const base=ctx.base.submitPolicy(branch.id);if(!base.ok)throw Error(base.message);
                for(const variant of ['overfold','sticky'] as const){const existing=Object.values(ctx.getData().cases).find(c=>c.experiment?.baselineCaseId===branch.id&&c.experiment.variant===variant);const made=existing?{ok:true as const,value:existing.id}:research.createExperiment(branch.id,base.value,variant);if(!made.ok)throw Error(made.message);refs.push({type:'case',id:made.value});}
                update(id,{artifactRevisions:Object.fromEntries(refs.map(ref=>[ref.id,ctx.getCase(ref.id)!.draft.editRevision]))});observation='固定基准及两个 Node Lock 假设已建立；原研究不变。';
              }else observation=`在读取快照的独立分支应用 ${Object.keys(patch).length} 个组合，保留已有有效分配与编辑锁定。`;
            }
          }else if(m.cursor===3&&m.kind!=='training'){
            m=get(id)!;const ids=m.kind==='experiment'?Object.keys(m.artifactRevisions??{}):[m.branchId!];
            for(const caseId of ids){const c=ctx.getCase(caseId)!;const expected=m.kind==='experiment'?m.artifactRevisions?.[caseId]:m.branchRevision;if(expected!==undefined&&c.draft.editRevision!==expected){update(id,{status:'conflict',message:'Agent 分支已被手工修改，未覆盖；可确认采用当前分支修订。'});return {ok:false,message:'分支冲突'};}
              if(m.kind==='experiment'&&c.experiment&&!c.versions.length&&!Object.keys(c.draft.choices).length){const loaded=ctx.base.loadExample(caseId);if(!loaded.ok)throw Error(loaded.message);update(id,{artifactRevisions:{...get(id)?.artifactRevisions,[caseId]:ctx.getCase(caseId)!.draft.editRevision}});m=get(id)!;}
              const submitted=ctx.base.submitPolicy(caseId);if(!submitted.ok)throw Error(submitted.message);
              refs.push({type:'version',id:submitted.value,caseId});const solved=await solveOwned(id,caseId,submitted.value);if(!solved.ok)throw Error(solved.message);
              if(get(id)?.status==='cancelled')return {ok:false,message:'任务已取消'};
              const report=ctx.getCase(caseId)!.reports.find(r=>r.policyRevisionId===submitted.value);if(report)refs.push({type:'report',id:report.id,caseId});
            }observation='固定版本与模拟评价已登记；合成频率差异不证明收益改进。';
          }else{m=get(id)!;refs=m.kind==='training'&&m.planId?[{type:'plan',id:m.planId}]:m.trace.flatMap(t=>t.refs).filter(r=>r.type==='report'||r.type==='version');observation=m.kind==='training'?'计划草稿可转为可执行题组；推荐和能力预测为演示。':'脚本报告完成；所有结论仅适用于引用的合成输入与假设，可打开原版本核对。';}
          const latest=get(id);if(!latest||latest.status==='cancelled')return {ok:false,message:'任务已取消'};
          const finished=latest.cursor+1>=steps[latest.kind].length;
          put({...latest,cursor:latest.cursor+1,status:finished?'completed':latest.status==='paused'?'paused':'running',trace:latest.trace.map((t,i)=>i===latest.trace.length-1?{...t,status:'completed',observation,refs}:t),message:finished?'脚本化 Agent 任务完成，可打开实际成果。':observation});return {ok:true,value:undefined};
        }catch(error){const latest=get(id);if(latest&&latest.status!=='cancelled')put({...latest,status:'failed',message:error instanceof Error?error.message:'脚本执行失败',trace:latest.trace.map((t,i)=>i===latest.trace.length-1?{...t,status:'failed',observation:error instanceof Error?error.message:'失败'}:t)});return {ok:false,message:'执行未完成，已有成果保留。'};}
      };
      const promise=perform().finally(()=>executing.delete(id));executing.set(id,promise);return promise;
    },
    runMission(id:string):Promise<Result>{const existing=loops.get(id);if(existing)return existing;const run=async():Promise<Result>=>{const m=get(id);if(!m)return ctx.fail('任务不存在。');if(m.blockedSource)return ctx.fail(m.blockedSource);if(['completed','cancelled','conflict'].includes(m.status))return ctx.fail('当前任务不能继续。');update(id,{status:'running'});while(get(id)?.status==='running'){const result=await api.stepMission(id);if(!result.ok)return result;}return {ok:true,value:undefined};};const promise=run().finally(()=>loops.delete(id));loops.set(id,promise);return promise;},
    pauseMission(id:string){if(get(id)?.status==='running')update(id,{status:'paused',message:'已暂停；当前工具如已开始会先结束，之后不执行下一步。'});},
    cancelMission(id:string){const m=get(id);if(!m||m.status==='completed')return;update(id,{status:'cancelled',trace:m.trace.map(t=>t.status==='running'?{...t,status:'cancelled',observation:'当前工具已取消；已登记成果保留，不执行下一工具。'}:t),message:'已取消，已产生成果保留，不执行下一工具。'});const linked=linkedJobs.get(id);if(linked)ctx.base.cancelJob(linked.caseId,linked.jobId);},
    setMissionBudget(id:string,budget:number):Result{const m=get(id);if(!m||!Number.isInteger(budget)||budget<m.spent||budget>50)return ctx.fail('预算需为已用额度至 50 的整数。');update(id,{budget});return {ok:true,value:undefined};},
    resolveMissionConflict(id:string):Result{const m=get(id);if(!m||m.status!=='conflict')return ctx.fail('当前没有冲突。');if(!m.branchId){const branch=ownedBranch(m);if(!branch)return ctx.fail('无法保留读取快照。');update(id,{branchId:branch.id,status:'paused',message:'将在读取快照的新分支继续；原草稿保留。'});}else{const c=ctx.getCase(m.branchId)!;update(id,{branchRevision:c.draft.editRevision,artifactRevisions:m.artifactRevisions?Object.fromEntries(Object.keys(m.artifactRevisions).map(caseId=>[caseId,ctx.getCase(caseId)!.draft.editRevision])):undefined,status:'paused',message:'已明确采用分支当前修订，下一步按其内容提交。'});}return {ok:true,value:undefined};},
  };return api;
}
