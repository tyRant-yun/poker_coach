import type { WorkspaceSnapshot } from '../study/domain';
import { contentHash, packageKey, questionExposureKeys } from './domain';
import type { Question, TeachingState, TheoryClaim, TheoryContext } from './domain';
import { lesson, teachingBundle, teachingQuestion, validateTeachingBundle } from './content';

export function exposureStatus(t:TeachingState,keys:string[]):'no-record'|'seen'|'possible'|'unknown-history'{
  if(t.continuity!=='complete')return 'unknown-history';
  const hits=t.exposures.filter(e=>e.keys.some(k=>keys.includes(k)));
  return hits.some(e=>e.kind==='seen'||e.kind==='hint')?'seen':hits.length?'possible':'no-record';
}
export function safeQuestion(q:Question,reveal=false){
  const {answer,feedback,reference,hint,...safe}=structuredClone(q);
  return {...safe,...(reveal?{answer,feedback,reference,hint}:{})};
}
export function activeIndependent(t?:TeachingState){const s=t?.sessions[t.activeSessionId??''];return s?.status==='answering'&&(!s.assisted||t?.pendingDisclosure)?s:undefined;}
export function applicability(c:TheoryClaim,context:TheoryContext){
  const reasons:string[]=[];let missing=false,conflict=false;
  for(const [key,value]of Object.entries(c.conditions))if(key!=='runId'){
    const current=context[key as keyof TheoryContext];
    if(current===undefined){missing=true;reasons.push(`缺少 ${key} 条件`);}else if(current!==value){conflict=true;reasons.push(`${key}: ${value} 与当前 ${current} 不同`);}
  }
  const status=conflict?'conflict':missing?'insufficient-context':c.scope==='general'?'general-background':'match';
  return {status:status as 'match'|'conflict'|'insufficient-context'|'general-background',reasons};
}
export const teachingQueries={
  study(data:WorkspaceSnapshot,caseId:string){const c=data.cases[caseId];if(!c||activeIndependent(data.teaching))return null;const node=Object.values(data.teaching?.bundles??{}).flatMap(b=>Object.values(b.nodes)).find(n=>n.id===c.spot.nodeId);if(!node)return null;const matches=contentHash(node.spot)===contentHash(c.spot)&&contentHash(node.ranges)===contentHash(c.ranges);return {covered:matches,node:matches?{contributions:node.contributions,remaining:node.remaining,toCall:node.toCall,ownPath:node.ownPath,settlement:node.settlement,kind:node.kind}:null};},
  reviewRecommendation(data:WorkspaceSnapshot,handId:string,decisionId:string){const hand=data.product?.hands[handId],d=hand?.decisions.find(d=>d.id===decisionId);if(!d)return {matched:false,reason:'尚未选择行动前节点。'};const input=d.teachingInput,p=input&&data.teaching?lesson(data.teaching,`${input.packageRef.id}@${input.packageRef.version}`):undefined,b=p&&data.teaching?teachingBundle(data.teaching,`${p.id}@${p.version}`):undefined,n=input?b?.nodes[input.spot.nodeId??'']:undefined;if(input&&p&&n&&p.hash===input.packageRef.hash&&input.inputHash===contentHash({spot:n.spot,ranges:n.ranges})&&contentHash(input.spot)===contentHash(n.spot)&&contentHash(input.ranges)===contentHash(n.ranges)&&contentHash({board:d.board,actor:d.actor,pot:d.potMinor,stack:d.stackMinor,hero:d.hero,history:d.actionHistory})===contentHash({board:n.spot.board,actor:n.spot.actor,pot:n.spot.potMinor,stack:n.spot.stackMinor,hero:'AhJh',history:n.history}))return {matched:true,packageId:p.id,version:p.version,reason:'行动前事实、上游版本与双方范围完全匹配固定教材快照；仅推荐概念课程，不判真实策略优劣。'};return {matched:false,reason:'当前牌谱缺少与教材固定范围、抽水/前注及完整上游版本一致的证据，保留研究；不因牌面相同强配课程。',related:d.board.length===0?'LP-A':'LP-B'};},
  catalogue(data:WorkspaceSnapshot){const t=data.teaching;if(!t)return [];return Object.values(t.bundles).flatMap(b=>Object.entries(b.packages).map(([key,p])=>({...p,key,disabled:t.disabledPackages.includes(key),errors:validateTeachingBundle(b)})));},
  run(data:WorkspaceSnapshot,id:string){
    const t=data.teaching,r=t?.runs[id];if(!t||!r)return null;if(activeIndependent(t))return {run:r,blocked:'独立题期间不读取其他课程的答案或历史反馈。'};const key=packageKey(r.packageRef.id as 'LP-A'|'LP-B',r.packageRef.version),b=teachingBundle(t,key),p=lesson(t,key);
    if(!p||!b||p.hash!==r.packageRef.hash)return {run:r,blocked:r.blockedReason??'内容版本缺失或停用，记录只读保留。'};
    const letter=p.id==='LP-A'?'A':'B';
    const ids=r.step===0?[`${letter}-I01`,`${letter}-P01`]:r.step===1?[`${letter}-Q01`,`${letter}-Q02`]:r.step===2?[`${letter}-R01`]:r.step===4?[`${letter}-X01`]:[];
    const lineNode=r.line?b.nodes[r.line.nodeId]:null;
    return {run:r,package:p,questions:ids.map(id=>safeQuestion(b.questions[id])),
      evidence:p.evidenceIds.map(id=>r.revealed.includes(id)?b.evidence[id]:{id,title:b.evidence[id].title}),
      contrasts:p.contrastIds.map(id=>{const e=r.revealed.includes(id)?Object.values(t.experiments).filter(e=>e.runId===r.id&&e.contrastId===id).at(-1):undefined;return {id,title:b.contrasts[id].title,variable:b.contrasts[id].variable,prediction:r.contrastPredictions[id]??'',experiment:e};}),
      attempts:r.attemptIds.map(id=>({attempt:t.attempts[id],evaluation:t.evaluations[t.attempts[id]?.evaluationId]})),
      lineNode:lineNode?{id:lineNode.id,label:lineNode.label,board:lineNode.spot.board,actor:lineNode.spot.actor,pot:lineNode.spot.potMinor,remaining:lineNode.remaining,toCall:lineNode.toCall,actions:lineNode.spot.actionSet??[],kind:lineNode.kind,settlement:lineNode.settlement,history:lineNode.history}:null,
      linePast:r.line?.decisions.map(d=>({action:d.action,label:b.nodes[d.nodeId]?.label,at:d.at})),
      reviews:Object.values(t.reviews).filter(v=>v.runId===id),
    };
  },
  session(data:WorkspaceSnapshot,id:string){const t=data.teaching,s=t?.sessions[id];if(!s||!t)return null;if(activeIndependent(t)&&t.activeSessionId!==id)return {session:s,blocked:'独立题期间只读取当前题目投影。'};const q=teachingQuestion(t,s.questionId,s.packageRef),p=lesson(t,packageKey(s.packageRef.id as 'LP-A'|'LP-B',s.packageRef.version));if(!q||!p||t.disabledPackages.includes(packageKey(p.id,p.version)))return {session:s,blocked:'题目固定版本缺失或停用；原作答保留。'};const revealed=s.status!=='answering'||s.revealed;return {session:s,question:safeQuestion(q,revealed),package:p,exposure:exposureStatus(t,questionExposureKeys(q)),hint:s.hintLevel?q.hint:null,attempts:s.attemptIds.map(id=>({attempt:t.attempts[id],evaluation:t.evaluations[t.attempts[id]?.evaluationId]}))};},
  progress(data:WorkspaceSnapshot){const t=data.teaching;if(!t||activeIndependent(t))return null;return {runs:Object.values(t.runs),attempts:Object.values(t.attempts),evaluations:t.evaluations,reviews:Object.values(t.reviews),continuity:t.continuity};},
  inspection(data:WorkspaceSnapshot){const t=data.teaching;if(!t||activeIndependent(t))return null;return {packages:Object.values(t.bundles).flatMap(b=>Object.entries(b.packages).map(([key,p])=>({...p,key,disabled:t.disabledPackages.includes(key),errors:validateTeachingBundle(b)}))),contentDrafts:Object.values(t.contentDrafts??{}),sources:Object.values(t.knowledge.sources),tasks:Object.values(t.knowledge.tasks),topics:t.knowledge.topics.map(topic=>({...topic,claims:Object.values(t.knowledge.claims).filter(c=>c.topicId===topic.id).length,usable:Object.values(t.knowledge.claims).filter(c=>c.topicId===topic.id&&c.status==='usable-for-demo').length})),claims:Object.values(t.knowledge.claims).map(c=>({id:c.id,title:c.title,status:c.status,version:c.version,hash:c.hash,sourceId:c.sourceId,checked:c.locator.checked})),feedback:t.knowledge.feedback,indexVersion:t.knowledge.indexVersion};},
  claim(data:WorkspaceSnapshot,id:string){const t=data.teaching;if(!t||activeIndependent(t))return null;const c=t.knowledge.claims[id]??t.knowledge.claimArchive[id]??Object.values(t.knowledge.claims).find(c=>`${c.id}@${c.version}`===id);if(!c)return null;return {claim:c,source:t.knowledge.sources[c.sourceId]??t.knowledge.sourceArchive[c.sourceId]};},
  retrieval(data:WorkspaceSnapshot,id:string){const t=data.teaching,r=t?.knowledge.retrievals[id];if(!t||!r)return null;if(activeIndependent(t))return {...r,hits:[],excluded:[],restricted:true};return {...r,hits:r.hits.map(hit=>({...hit,claim:hit.claimRef?(t.knowledge.claims[hit.claimId]?.hash===hit.claimRef.hash?t.knowledge.claims[hit.claimId]:t.knowledge.claimArchive[`${hit.claimRef.id}@${hit.claimRef.version}`]):t.knowledge.claims[hit.claimId]}))};},
  citation(data:WorkspaceSnapshot,id:string){const t=data.teaching,c=t?.knowledge.citations[id];if(!t||!c||activeIndependent(t))return null;return {...c,items:c.claimRefs.map(ref=>{const claim=Object.values(t.knowledge.claims).find(v=>v.id===ref.id&&v.version===ref.version&&v.hash===ref.hash)??t.knowledge.claimArchive[`${ref.id}@${ref.version}`];return {ref,claim,source:claim?(()=>{const sr=c.sourceRefs.find(v=>v.sourceId===claim.sourceId);return sr?(t.knowledge.sources[claim.sourceId]?.version===sr.version?t.knowledge.sources[claim.sourceId]:t.knowledge.sourceArchive[`${sr.sourceId}@${sr.version}`]):undefined;})():undefined,currentStatus:t.knowledge.claims[ref.id]?.status??'missing'};})};},
  activeIndependent:(data:WorkspaceSnapshot)=>activeIndependent(data.teaching),
  contentFingerprint:(q:Question)=>contentHash({question:q.id,hash:q.hash}),
};
