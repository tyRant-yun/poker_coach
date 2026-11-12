import { actionsFor, activeCombos, canonicalPolicy, frequencyDifference, spotSignature, validateSubmission } from '../study/domain';
import type { Choices, ScenarioId, SolveInput, WorkspaceSnapshot } from '../study/domain';
import { copy, now, uid } from './context';
import type { ProductContext, Result } from './context';
import type { ExerciseKind, PracticeSession } from './domain';
import { emptyProduct } from './domain';
import { matchingReference, scenarioFor } from '../../fixtures/scenarios';
import { fixtureVersion } from '../../fixtures/s01';

export const exerciseNames: Record<ExerciseKind,string> = {range:'全范围构建',branch:'分支补全',diagnosis:'策略诊断',comparison:'局面比较'};
function referenceFor(session:PracticeSession) {return matchingReference(session.input.spot,session.input.ranges!);}
function initialChoices(kind:ExerciseKind,input:SolveInput):Choices {
  if(kind!=='branch')return {};
  return Object.fromEntries(activeCombos(input.spot,input.ranges![input.spot.actor]).slice(0,3).map(combo=>[combo,Object.fromEntries(actionsFor(input.spot).map((a,i)=>[a.id,i===0?10000:0]))]));
}
export function practiceView(data:WorkspaceSnapshot,id:string) {
  const session=data.product?.sessions[id];if(!session)return null;
  const {input,...safe}=copy(session);
  const reveal=session.revealed||session.status!=='answering';
  return {...safe,spot:copy(input.spot),weights:copy(input.ranges![input.spot.actor]),actions:actionsFor(input.spot),reference:reveal?referenceFor(session):null,
    hint:session.hints?'先检查覆盖与概率合计，再考虑各行动中的组合构成；频率差异不等于 EV 损失。':null,
    prompt:session.kind==='range'?'为当前完整范围分配行动；可以先批量填入自己的纯行动，再调整牌类与组合。':session.kind==='branch'?'这是固定的后续节点。已给出 3 个组合的起始分配，请补齐其余组合。':session.kind==='diagnosis'?'示例组合分配为：行动一 50%，行动二 20%，其余 0%。提交完整策略前，应先处理什么？':'左侧局面底池 5.5 bb，右侧 7.5 bb，牌面与范围相同。能仅凭频率差异判断哪版 EV 更高吗？',
    options:session.kind==='diagnosis'?[{id:'probability',label:'修正概率合计不足 100%'},{id:'always-bet',label:'所有组合改成下注'},{id:'no-change',label:'直接当作完整策略提交'}]:session.kind==='comparison'?[{id:'conditions',label:'不能，需要明确各版条件与评价模型'},{id:'frequency',label:'可以，下注更多的一版更优'},{id:'equal',label:'可以，频率相近就代表 EV 相同'}]:[],
  };
}
export function createLearningCommands(ctx:ProductContext) {
  const submitting=new Map<string,Promise<Result<string>>>();
  function put(session:PracticeSession){const data=ctx.getData(),product=data.product??emptyProduct();ctx.replaceData({...data,product:{...product,sessions:{...product.sessions,[session.id]:session}}});}
  const api={
    startPractice(kind:ExerciseKind,scenarioId:ScenarioId='S01',sourceCaseId?:string,mode:'independent'|'assisted'='independent',fixedInput?:SolveInput):Result<string>{
      if(!Object.keys(exerciseNames).includes(kind))return ctx.fail('题型未覆盖。');
      const c=sourceCaseId?ctx.getCase(sourceCaseId):undefined,scenario=scenarioFor(c?.scenarioId??scenarioId);
      const template=kind==='branch'&&!c?scenarioFor(scenarioId==='S03'?'S03':'S02')!.nodes.find(n=>n.id===(scenarioId==='S03'?'S03-turn':'S02-turn'))!:scenario?.nodes[0];
      if(!template)return ctx.fail('该练习没有匹配输入。');
      const input=copy(fixedInput??(c?{spot:c.spot,spotRevisionId:c.spotRevisionId,ranges:c.ranges??scenario!.nodes[0].ranges}:{spot:template.spot,spotRevisionId:uid('exercise-input'),ranges:template.ranges}));
      const actualScenario=c?.scenarioId??(kind==='branch'&&scenarioId!=='S03'?'S02':scenarioId),id=uid('practice');
      const sourceVersion=c?.versions.find(v=>v.spotRevisionId===input.spotRevisionId);
      put({id,kind,scenarioId:actualScenario,nodeId:input.spot.nodeId??`${actualScenario}-root`,input,sourceCaseId,sourceVersionId:sourceVersion?.id,mode,status:'answering',choices:initialChoices(kind,input),answer:'',reason:'',hints:mode==='assisted'?1:0,revealed:false,attempts:[],createdAt:now(),source:sourceCaseId?'research':'library'});
      ctx.notice('练习已建立；作答期间不加载参考答案或未来分支。');return {ok:true,value:id};
    },
    savePractice(id:string,patch:{choices?:Choices;answer?:string;reason?:string}):Result {
      const session=ctx.getData().product?.sessions[id];if(!session||session.status!=='answering')return ctx.fail('当前练习不能修改，请先进入修订。');
      if(patch.choices){const available=new Set(activeCombos(session.input.spot,session.input.ranges![session.input.spot.actor])),actions=actionsFor(session.input.spot);if(Object.entries(patch.choices).some(([combo,value])=>!available.has(combo)||actions.some(a=>!Number.isInteger(value[a.id])||value[a.id]<0||value[a.id]>10000)||Object.keys(value).some(key=>!actions.some(a=>a.id===key))))return ctx.fail('作答包含无效组合或频率。');}
      put({...session,...copy(patch),reason:(patch.reason??session.reason).slice(0,2000)});return {ok:true,value:undefined};
    },
    fillPractice(id:string,actionId:string):Result {
      const session=ctx.getData().product?.sessions[id];if(!session)return ctx.fail('练习不存在。');
      const actions=actionsFor(session.input.spot);if(!actions.some(a=>a.id===actionId))return ctx.fail('当前节点没有该行动。');
      const choices={...session.choices};for(const combo of activeCombos(session.input.spot,session.input.ranges![session.input.spot.actor]))if(!choices[combo])choices[combo]=Object.fromEntries(actions.map(a=>[a.id,a.id===actionId?10000:0]));
      return api.savePractice(id,{choices});
    },
    practiceHint(id:string,reveal=false):Result {
      const session=ctx.getData().product?.sessions[id];if(!session)return ctx.fail('练习不存在。');
      put({...session,mode:'assisted',hints:session.hints+1,revealed:session.revealed||reveal});ctx.notice(reveal?'参考已揭示；本次及后续修订保留辅助标记。':'已记录提示，本次作答标为辅助。','info');return {ok:true,value:undefined};
    },
    submitPractice(id:string):Promise<Result<string>> {
      const pending=submitting.get(id);if(pending)return pending;
      const perform=async():Promise<Result<string>>=>{
        const session=ctx.getData().product?.sessions[id];if(!session||session.status!=='answering')return ctx.fail('当前练习不可重复提交。');
        const snapshot=copy(session),spot=snapshot.input.spot,weights=snapshot.input.ranges![spot.actor];
        if(['range','branch'].includes(snapshot.kind)){const error=validateSubmission(spot,weights,snapshot.choices);if(error)return ctx.fail(error);}else if(!snapshot.answer)return ctx.fail('请先选择你的判断。');
        const key=spotSignature(spot)+JSON.stringify(Object.entries(snapshot.input.ranges!).sort())+canonicalPolicy(snapshot.choices,activeCombos(spot,weights),actionsFor(spot))+snapshot.answer;
        const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
        const current=ctx.getData().product?.sessions[id];if(!current||current.status!=='answering')return ctx.fail('练习已改变或重置，本次未登记作答。');
        const reference=referenceFor(snapshot),difference=reference&&['range','branch'].includes(snapshot.kind)?frequencyDifference(spot,weights,snapshot.choices,reference):null;
        const correct=snapshot.kind==='diagnosis'?snapshot.answer==='probability':snapshot.kind==='comparison'?snapshot.answer==='conditions':null;
        const attemptId=uid('attempt');
        const feedback=difference!==null?`已覆盖完整范围；与合成参考的加权分配差异 ${(difference*100).toFixed(1)}%。这不是 EV 损失或掌握度评分。`:correct!==null?(correct?'判断符合本题的结构/评价约定。':'请重新检查概率完整性或比较条件；反馈不代表真实 Solver 求值。'):'此固定输入没有匹配参考，保留作答，评价未覆盖；不计为零差异。';
        put({...current,status:'feedback',revealed:true,attempts:[...current.attempts,{id:attemptId,createdAt:now(),choices:snapshot.choices,answer:snapshot.answer,reason:snapshot.reason,assisted:snapshot.mode==='assisted'||snapshot.hints>0||snapshot.revealed||current.hints>snapshot.hints,revealed:snapshot.revealed,difference,correct,feedback,fixtureVersion,inputFingerprint:[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')}]});
        ctx.notice('作答已固定；反馈后修订作为新作答保留，首次记录不覆盖。');return {ok:true,value:attemptId};
      };
      const promise=perform().finally(()=>submitting.delete(id));submitting.set(id,promise);return promise;
    },
    revisePractice(id:string):Result {const session=ctx.getData().product?.sessions[id];if(!session||session.status==='answering')return ctx.fail('请先提交作答。');put({...session,status:'answering',mode:'assisted'});return {ok:true,value:undefined};},
    completePractice(id:string):Result {const session=ctx.getData().product?.sessions[id];if(!session||!session.attempts.length)return ctx.fail('请先完成一次作答。');put({...session,status:'completed'});return {ok:true,value:undefined};},
    startTransfer(id:string):Result<string> {const session=ctx.getData().product?.sessions[id];if(!session||!session.attempts.length)return ctx.fail('先完成当前练习，再进行迁移。');const started=api.startPractice(session.kind,'S03');if(started.ok){const next=ctx.getData().product!.sessions[started.value];put({...next,transferFrom:id});}return started;},
    draftTrainingPlan(caseId:string,missionId?:string):Result<string>{
      const c=ctx.getCase(caseId);if(!c)return ctx.fail('研究案例不存在。');const data=ctx.getData(),product=data.product??emptyProduct(),id=uid('plan');
      const plan={id,caseId,missionId,title:`${c.name} · 训练计划草稿`,reason:'围绕当前固定输入练习范围构建、分支补全、诊断与比较；推荐理由为脚本示例。',input:copy({spot:c.spot,spotRevisionId:c.spotRevisionId,ranges:c.ranges??scenarioFor(c.scenarioId)!.nodes[0].ranges}),exerciseKinds:['range','branch','diagnosis','comparison'] as ExerciseKind[],sessionIds:[]};
      ctx.replaceData({...data,product:{...product,plans:{...product.plans,[id]:plan}}});return {ok:true,value:id};
    },
    executeTrainingPlan(id:string):Result<string>{
      const plan=ctx.getData().product?.plans[id];if(!plan)return ctx.fail('训练计划不存在。');if(plan.sessionIds.length)return {ok:true,value:plan.sessionIds.find(id=>ctx.getData().product?.sessions[id]?.status!=='completed')??plan.sessionIds.at(-1)!};
      const sessions:string[]=[];for(const kind of plan.exerciseKinds){const made=api.startPractice(kind,kind==='branch'?'S02':'S01',kind==='range'?plan.caseId:undefined,'independent',kind==='range'?plan.input:undefined);if(!made.ok)return made;sessions.push(made.value);}
      const data=ctx.getData(),product=data.product!;ctx.replaceData({...data,product:{...product,plans:{...product.plans,[id]:{...plan,sessionIds:sessions}}}});return {ok:true,value:sessions[0]};
    },
  };return api;
}
export function learningQueries(data:WorkspaceSnapshot) {
  const product=data.product??emptyProduct();
  return {
    practice:(id:string)=>practiceView(data,id),
    sessions:()=>Object.values(product.sessions).map(({input,choices,...s})=>({...s,attempts:s.attempts.map(({choices,...a})=>a)})),
    plans:()=>Object.values(product.plans).map(({input,...plan})=>plan),
    nextPractice:(id:string)=>{const plan=Object.values(product.plans).find(p=>p.sessionIds.includes(id));return plan?.sessionIds[plan.sessionIds.indexOf(id)+1]??null;},
    toolContext:(context:{practiceId?:string;caseId?:string})=>context.practiceId?{mode:'practice',session:practiceView(data,context.practiceId)}:{mode:'study',case:context.caseId?data.cases[context.caseId]:null},
  };
}
