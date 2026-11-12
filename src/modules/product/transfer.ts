import { allCombos, normalizeCombo, validateSpot, validateSubmission } from '../study/domain';
import type { RangeInputs, SolveInput, StudyCase, WorkspaceSnapshot } from '../study/domain';
import { copy, uid } from './context';
import type { ProductContext, Result } from './context';
import { emptyProduct, runningStatuses } from './domain';
import { snapshotSchema } from '../../persistence/schema';
import { btnRange, bbRange, fixtureVersion } from '../../fixtures/s01';

type Inspection={cases:number;versions:number;sessions:number;warnings:string[]};
function parseImport(raw:string):{data:WorkspaceSnapshot;inspection:Inspection}{
  if(raw.length>20*1024*1024)throw Error('备份超过 20 MB，请拆分后再导入。');
  const json:unknown=JSON.parse(raw),payload=json&&typeof json==='object'&&'workspace'in json?(json as{workspace:unknown}).workspace:json;
  const parsed=snapshotSchema.safeParse(payload);if(!parsed.success)throw Error('JSON/schema 校验失败；现有工作区未修改。');
  const data:WorkspaceSnapshot=parsed.data,warnings:string[]=[];
  if(data.fixtureVersion!==fixtureVersion)warnings.push(`缺少来源 fixture ${data.fixtureVersion}：保留用户输入，旧结果另存未验证归档，不作为当前参考。`);
  function checkInput(input:Pick<SolveInput,'spot'|'ranges'>,requireRanges=false){
    const error=validateSpot(input.spot);if(error)throw Error(`局面语义无效：${error}`);
    if(requireRanges&&!input.ranges)throw Error('固定题目/作业缺少输入范围快照。');
    const ranges:RangeInputs=input.ranges??{BTN:btnRange,BB:bbRange};if(!ranges[input.spot.actor])throw Error('当前行动者没有输入范围。');
    if(Object.values(ranges).some(weights=>Object.keys(weights).some(combo=>!allCombos.includes(combo))))throw Error('输入包含无效组合 ID。');
  }
  for(const [key,c] of Object.entries(data.cases)){
    if(key!==c.id)throw Error('案例记录键与 ID 不一致。');
    for(const input of [{spot:c.spot,ranges:c.ranges,choices:c.draft.choices},...c.versions,...Object.values(c.nodeDrafts??{})]){
      const error=validateSpot(input.spot);if(error)throw Error(`局面语义无效：${error}`);
      const ranges:RangeInputs=input.ranges??{BTN:btnRange,BB:bbRange};if(!ranges[input.spot.actor])throw Error('缺少当前行动者的输入范围。');
      if(Object.values(ranges).some(weights=>Object.keys(weights).some(combo=>!allCombos.includes(combo)))||Object.keys(input.choices).some(combo=>!allCombos.includes(combo)))throw Error('备份包含无效组合 ID。');
    }
    for(const version of c.versions){const ranges:RangeInputs=version.ranges??{BTN:btnRange,BB:bbRange};const error=validateSubmission(version.spot,ranges[version.spot.actor],version.choices);if(error)throw Error(`固定版本不完整：${error}`);}
    for(const job of c.jobs)if(job.input)checkInput(job.input,true);
    for(const report of c.reports){const version=c.versions.find(v=>v.id===report.policyRevisionId),job=c.jobs.find(j=>j.id===report.jobId);if(!version||!job?.result||job.policyRevisionId!==version.id||report.spotRevisionId!==version.spotRevisionId||job.result.inputFingerprint!==report.inputFingerprint)throw Error('报告引用或输入指纹不一致，未导入。');}
    if(c.branchSource&&!data.cases[c.branchSource.caseId])warnings.push(`${c.name} 的来源案例未随包导入；保留来源说明。`);
  }
  for(const session of Object.values(data.product?.sessions??{})){
    checkInput(session.input,true);
    if(Object.keys(session.choices).some(combo=>!allCombos.includes(combo)))throw Error('作答包含无效组合。');
    for(const attempt of session.attempts)if(['range','branch'].includes(session.kind)){const error=validateSubmission(session.input.spot,session.input.ranges![session.input.spot.actor],attempt.choices);if(error)throw Error(`已提交作答不完整：${error}`);}
  }
  for(const plan of Object.values(data.product?.plans??{})){if(!plan.input)throw Error('训练计划缺少固定输入。');checkInput(plan.input,true);}
  for(const mission of Object.values(data.product?.missions??{}))if(mission.input)checkInput(mission.input);
  for(const hand of Object.values(data.product?.hands??{}))for(const d of hand.decisions){checkInput({spot:{board:d.board,potMinor:d.potMinor,stackMinor:d.stackMinor,actor:d.actor,unitsPerBb:100,rangeVersion:'review',treeVersion:'review'}});const hero=normalizeCombo(d.hero);if(!hero||d.board.some(card=>hero.includes(card)))throw Error('复盘手牌与公共牌冲突。');}
  const ids:string[]=[];function collect(value:unknown){if(!value||typeof value!=='object'||('short'in value&&'color'in value)||('type'in value&&'id'in value))return;for(const [key,v]of Object.entries(value)){if(key==='id'&&typeof v==='string'&&!['flop','turn','river'].includes(v))ids.push(v);collect(v);}}
  collect(data);if(new Set(ids).size!==ids.length)throw Error('备份中有重复制品 ID，引用不明确。');
  return {data,inspection:{cases:Object.keys(data.cases).length,versions:Object.values(data.cases).reduce((n,c)=>n+c.versions.length,0),sessions:Object.keys(data.product?.sessions??{}).length,warnings:[...new Set(warnings)]}};
}
function remap(data:WorkspaceSnapshot){
  const mapping=new Map<string,string>();
  function collect(value:unknown){if(!value||typeof value!=='object'||('short'in value&&'color'in value)||('type'in value&&'id'in value))return;for(const [key,v]of Object.entries(value)){if(typeof v==='string'&&(key==='id'||key==='spotRevisionId')&&!['flop','turn','river'].includes(v)&&!mapping.has(v))mapping.set(v,uid(v.split('-')[0]||'import'));collect(v);}}
  collect(data);
  function rewrite(value:unknown,key=''):unknown{if(typeof value==='string')return key==='id'||/(Id|Ids|From)$/.test(key)?mapping.get(value)??value:value;if(Array.isArray(value))return value.map(v=>rewrite(v,key));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[mapping.get(k)??k,rewrite(v,k)]));return value;}
  return rewrite(data) as WorkspaceSnapshot;
}
export function createTransferCommands(ctx:ProductContext){
  return {
    inspectImport(raw:string):Result<Inspection>{try{return {ok:true,value:parseImport(raw).inspection};}catch(e){return ctx.fail(e instanceof Error?e.message:'无法读取备份。');}},
    importWorkspace(raw:string):Result<Inspection>{
      try{
        const parsed=parseImport(raw),incoming=remap(copy(parsed.data)),foreign=incoming.fixtureVersion!==fixtureVersion;
        for(const c of Object.values(incoming.cases)){
          c.name=`${c.name} · 导入副本`;c.importWarnings=copy(parsed.inspection.warnings);
          if(foreign){c.unverifiedEvidence={fixtureVersion:incoming.fixtureVersion,raw:JSON.stringify({jobs:c.jobs,reports:c.reports})};c.jobs=[];c.reports=[];}
          else c.jobs=c.jobs.map(job=>runningStatuses.includes(job.status)?{...job,status:'interrupted',stage:'导入时未完成的任务已中断，可新建重试'}:job);
        }
        const product=incoming.product??emptyProduct();
        for(const m of Object.values(product.missions)){if(foreign){m.blockedSource='来源版本缺失，历史轨迹仅供归档；请从保留的研究输入创建新任务。';m.status='interrupted';}else if(['running','planned','paused'].includes(m.status))m.status='interrupted';}
        if(foreign){for(const s of Object.values(product.sessions)){s.unavailableReason='来源练习 fixture 缺失：保留作答归档，不载入当前题目的参考或重新评分。';s.fixtureVersion=incoming.fixtureVersion;}for(const p of Object.values(product.plans))p.blockedSource='来源训练计划版本缺失，请基于保留研究重新生成计划。';}
        const current=ctx.getData(),existing=current.product??emptyProduct();
        ctx.replaceData({...current,cases:{...current.cases,...incoming.cases},product:{settings:existing.settings,missions:{...existing.missions,...product.missions},sessions:{...existing.sessions,...product.sessions},plans:{...existing.plans,...product.plans},hands:{...existing.hands,...product.hands}}});
        ctx.notice(`已导入 ${parsed.inspection.cases} 个新副本，原案例保留。${foreign?' 来源结果未验证，已归档。':''}`,'info');return {ok:true,value:parsed.inspection};
      }catch(e){return ctx.fail(e instanceof Error?e.message:'导入失败；现有内容保留。');}
    },
    resetWorkspace():Result{ctx.stopAll();ctx.onReset();ctx.replaceData({schemaVersion:1,fixtureVersion,cases:{},product:emptyProduct()});ctx.notice('本应用工作区已重置；没有操作其他应用的浏览器数据。','info');return {ok:true,value:undefined};},
    exportMarkdown(caseId?:string):string{
      const data=ctx.getData(),cases=caseId?[data.cases[caseId]].filter((c):c is StudyCase=>!!c):Object.values(data.cases),clean=(v:unknown)=>String(v).replace(/[\r\n|<>]/g,' ');
      const lines=['# Riverline 研究记录','','所有 Solver / EV / 权益 / 对抗评价均为合成示例，未执行真实求解。',`fixtureVersion: ${fixtureVersion}`,''];
      for(const c of cases){lines.push(`## ${clean(c.name)}`,`案例 ${c.id} · 场景 ${c.scenarioId}`,`当前输入 ${c.spotRevisionId} · 节点 ${c.spot.nodeId??'S01-root'}`,`公共牌 ${c.spot.board.join(' ')} · 单位 ${c.spot.unit??'bb'}`,`笔记：${clean(c.note)}`,'');for(const v of c.versions){lines.push(`### V${v.number} / ${v.id}`,`输入 ${v.spotRevisionId} · 节点 ${v.spot.nodeId??'S01-root'} · 行动者 ${v.spot.actor}`,`公共牌 ${v.spot.board.join(' ')} · 底池 ${v.spot.potMinor/v.spot.unitsPerBb} bb · 单位 ${v.spot.unit??'bb'}`,`辅助状态 ${v.assistance??'user-input'}`,'');for(const report of c.reports.filter(r=>r.policyRevisionId===v.id))lines.push(`- 报告 ${report.id} / job ${report.jobId} / synthetic`,`  - 指纹 ${report.inputFingerprint}`,`  - 结构：完整；参考频率差异 ${report.difference===null?'未覆盖':(report.difference*100).toFixed(2)+'%'}`,`  - 固定模型 EV 示例 ${report.sampleEv?.value??'未覆盖'} ${v.spot.unit??'bb'}；不可当作真实策略收益`,`  - 对抗评价示例 ${report.sampleAdversarial?.value??'未覆盖'} ${report.sampleAdversarial?.unit??v.spot.unit??'bb'}`);}
        if(c.origin)lines.push(`来源手牌 ${c.origin.handId} / ${c.origin.decisionId}`);if(c.experiment)lines.push(`实验基准 ${c.experiment.baselineCaseId} / ${c.experiment.baselineVersionId}`,`锁定规格 ${JSON.stringify(c.experiment.lock)}`);if(c.importWarnings?.length)lines.push(...c.importWarnings.map(w=>`来源警告：${clean(w)}`));}
      lines.push('','## 作答证据');for(const session of Object.values(data.product?.sessions??{}))for(const a of session.attempts)lines.push(`- ${session.id} / ${a.id} / ${session.scenarioId} / ${a.assisted?'assisted':'independent'}`,`  - ${clean(a.feedback)} / fixture ${a.fixtureVersion} / fingerprint ${a.inputFingerprint}`);
      lines.push('','## Agent 任务');for(const m of Object.values(data.product?.missions??{}))lines.push(`- ${m.id} / ${m.kind} / ${m.status} / 额度 ${m.spent}/${m.budget}`,`  - ${clean(m.message)}`,`  - 成果 ${m.trace.flatMap(t=>t.refs.map(r=>`${r.type}:${r.id}`)).join(', ')}`);
      return lines.join('\n');
    },
  };
}
