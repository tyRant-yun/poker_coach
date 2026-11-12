import { builtInTeachingBundle, lessonPackageHash } from '../../fixtures/teaching/content';
import { createKnowledgeSeed } from '../../fixtures/teaching/knowledge';
import { actionsFor, allCombos, normalizeCombo, validAllocation, validateSpot } from '../study/domain';
import type { WorkspaceSnapshot } from '../study/domain';
import { contentHash, packageKey } from './domain';
import type { LessonPackage, Question, TeachingBundle, TeachingState } from './domain';

export function emptyTeaching():TeachingState {
  return {version:1,workspaceId:`teaching-${crypto.randomUUID()}`,seq:0,continuity:'complete',bundles:{builtin:structuredClone(builtInTeachingBundle)},runs:{},sessions:{},attempts:{},evaluations:{},exposures:[],reviews:{},experiments:{},knowledge:createKnowledgeSeed(),traces:{},commandResults:{},disabledPackages:[]};
}
export function teachingBundle(state:TeachingState,key:string):TeachingBundle|undefined{return Object.values(state.bundles).find(b=>!!b.packages[key]);}
export function lesson(state:TeachingState,key:string):LessonPackage|undefined{return teachingBundle(state,key)?.packages[key];}
export function teachingQuestion(state:TeachingState,id:string,packageRef?:{id:string;version:number;hash:string}):Question|undefined{
  const b=packageRef?teachingBundle(state,packageKey(packageRef.id as 'LP-A'|'LP-B',packageRef.version)):Object.values(state.bundles).find(b=>!!b.questions[id]);
  const p=packageRef&&b?.packages[packageKey(packageRef.id as 'LP-A'|'LP-B',packageRef.version)];
  if(packageRef&&p?.hash!==packageRef.hash)return undefined;return b?.questions[id];
}
export function validateTeachingBundle(b:TeachingBundle):string[] {
  const errors:string[]=[];
  if(b.schemaVersion!==1||!b.packages||!b.questions||!b.nodes||!b.evidence||!b.contrasts)return ['内容包结构不完整'];
  for(const [id,q]of Object.entries(b.questions)){
    if(q.id!==id||!q.prompt||!q.hash||q.version<1)errors.push(`${id} 题目身份/正文不完整`);
    if(q.hash!==contentHash({...q,hash:undefined}))errors.push(`${id} 内容哈希不匹配`);
    const invalidBoard=validateSpot({board:q.board,potMinor:100,stackMinor:10000,unitsPerBb:100,actor:'BTN',rangeVersion:'content',treeVersion:'content'});if(invalidBoard)errors.push(`${id} 公共牌无效：${invalidBoard}`);
    if(q.board.length&&q.board.length!==3&&q.board.length!==4&&q.board.length!==5)errors.push(`${id} 牌面长度无效`);
    const hero=normalizeCombo(q.hero);if(!hero||q.board.some(card=>hero.includes(card)))errors.push(`${id} Hero 与牌面冲突`);
    for(const field of q.fields)if(!field.options.some(o=>o.id===q.answer[field.id]))errors.push(`${id}/${field.id} 答案不在选项中`);
    if(q.kind==='range'){
      if(!q.targets?.length||q.targets.some(c=>!allCombos.includes(c)||q.given?.[c]))errors.push(`${id} 目标/给定集合错误`);
      for(const c of q.targets??[])if(!q.reference?.[c]||!validAllocation(q.reference[c],(q.actions??[]).map(a=>({...a,short:a.id,color:''}))))errors.push(`${id}/${c} 示意分配无效`);
    }
  }
  for(const [id,n] of Object.entries(b.nodes)){
    if(n.id!==id)errors.push(`${id} 节点 ID 错误`);
    const invalid=validateSpot(n.spot);if(invalid)errors.push(`${id}: ${invalid}`);
    if(Object.values(n.contributions).reduce((s,a)=>s+a,0)!==n.spot.potMinor)errors.push(`${id} 投入与底池不守恒`);
    for(const p of ['BTN','BB'] as const)if(n.remaining[p]+n.contributions[p]!==10000)errors.push(`${id} ${p} 筹码不守恒`);
    if(n.settlement&&n.settlement.gross-n.settlement.returned!==n.settlement.pot)errors.push(`${id} 退还/结算不守恒`);
    for(const next of Object.values(n.edges))if(!b.nodes[next])errors.push(`${id} 缺后续节点 ${next}`);
    if(n.kind==='decision'){const initial=b.nodes['TP01-P0']?.ranges;for(const player of ['BTN','BB'])for(const [combo,weight]of Object.entries(n.ranges[player]??{})){let expected=initial?.[player]?.[combo]??0;for(const path of n.ownPath.filter(p=>p.player===player))expected*=(b.nodes[path.nodeId]?.reference[combo]?.[path.action]??0)/10000;if(Math.abs(weight-expected)>0.000001)errors.push(`${id}/${player}/${combo} 自身行动权重来源不一致`);}}
    for(const path of n.ownPath){const source=b.nodes[path.nodeId];if(!source||!actionsFor(source.spot).some(a=>a.id===path.action))errors.push(`${id} 范围来源行动缺失 ${path.nodeId}/${path.action}`);}
    if(n.kind==='decision')for(const [c,a]of Object.entries(n.reference))if(!normalizeCombo(c)||!validAllocation(a,actionsFor(n.spot)))errors.push(`${id}/${c} 组合分配无效`);
  }
  for(const [key,p]of Object.entries(b.packages)){
    if(p.hash!==lessonPackageHash(p,b))errors.push(`${key} 内容/输入哈希不匹配`);
    if(key!==packageKey(p.id,p.version)||!p.hash||!b.nodes[p.rootNode])errors.push(`${key} 包身份或根节点缺失`);
    for(const id of [...p.questionIds,...p.transferIds,p.delayedId])if(!b.questions[id])errors.push(`${key} 缺题 ${id}`);
    for(const id of p.evidenceIds)if(!b.evidence[id])errors.push(`${key} 缺证据 ${id}`);
    for(const id of p.contrastIds)if(!b.contrasts[id])errors.push(`${key} 缺对照 ${id}`);
  }
  return errors;
}
export function upgradeTeachingSnapshot(snapshot:WorkspaceSnapshot):WorkspaceSnapshot {
  const data=structuredClone(snapshot),legacy=data.schemaVersion===1;
  data.schemaVersion=2;data.teaching??=emptyTeaching();
  if(legacy){data.teaching.continuity='unknown-history';data.teaching.migration={sourceSchema:1,sourceDigest:contentHash(snapshot),at:new Date().toISOString()};}
  for(const trace of Object.values(data.teaching.traces))if(['planned','running','paused'].includes(trace.status)){trace.status='interrupted';trace.message='刷新中断，已有成果保留；可新建教学任务。';}
  for(const run of Object.values(data.teaching.runs)){
    const p=lesson(data.teaching,packageKey(run.packageRef.id as 'LP-A'|'LP-B',run.packageRef.version));
    if(!p||p.hash!==run.packageRef.hash){run.status='blocked';run.blockedReason='固定内容版本缺失，原作答只读保留。';}
  }
  return data;
}
