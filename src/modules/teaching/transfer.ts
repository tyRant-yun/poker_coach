import type { TeachingState } from './domain';
import { contentHash, questionExposureKeys } from './domain';
import { lesson, teachingQuestion, validateTeachingBundle } from './content';
import { uid } from '../product/context';

/** Validate identities and relationships before a single workspace write. */
export function validateTeachingState(t:TeachingState):string[]{
  const errors:string[]=[];
  for(const b of Object.values(t.bundles))errors.push(...validateTeachingBundle(b));
  for(const records of [t.runs,t.sessions,t.attempts,t.evaluations,t.reviews,t.experiments,t.traces,t.knowledge.claims,t.knowledge.sources,t.knowledge.tasks,t.knowledge.retrievals,t.knowledge.citations])for(const [key,v]of Object.entries(records))if(key!==v.id)errors.push(`${key} 记录键与 ID 不一致`);
  if(t.seq<Math.max(0,...t.exposures.map(e=>e.seq)))errors.push('暴露顺序超出工作区序号');
  if(new Set(t.exposures.map(e=>e.id)).size!==t.exposures.length||new Set(t.exposures.map(e=>e.seq)).size!==t.exposures.length)errors.push('暴露 ID/序号重复');
  for(const r of Object.values(t.runs)){if(r.step>7)errors.push(`${r.id} 阶段越界`);for(const id of r.attemptIds)if(t.attempts[id]?.runId!==r.id)errors.push(`${r.id} 作答依赖缺失`);for(const id of r.experimentIds)if(t.experiments[id]?.runId!==r.id)errors.push(`${r.id} 对照依赖缺失`);}
  for(const a of Object.values(t.attempts)){const e=t.evaluations[a.evaluationId],q=teachingQuestion(t,a.questionId,a.packageRef);if(!e||e.attemptId!==a.id||e.definitionHash!==a.definition.hash||a.submitSeq>t.seq)errors.push(`${a.id} 评价身份/序号不一致`);if(q&&q.hash!==a.definition.hash)errors.push(`${a.id} 固定题目哈希不一致`);if(a.runId&&!t.runs[a.runId]||a.sessionId&&!t.sessions[a.sessionId]||a.parentId&&!t.attempts[a.parentId])errors.push(`${a.id} 作答关系缺失`);if(e?.citationBundleId&&!t.knowledge.citations[e.citationBundleId])errors.push(`${a.id} 固定引用束缺失`);}
  for(const s of Object.values(t.sessions)){if(!t.runs[s.runId]||s.attemptIds.some(id=>t.attempts[id]?.sessionId!==s.id)||s.reviewId&&!t.reviews[s.reviewId])errors.push(`${s.id} 练习关系缺失`);}
  for(const r of Object.values(t.reviews))if(!t.runs[r.runId]||[...r.attemptIds,...r.previewIds].some(id=>!t.attempts[id])||!Number.isFinite(Date.parse(r.dueAt)))errors.push(`${r.id} 复测关系/到期时间无效`);
  for(const c of [...Object.values(t.knowledge.claims),...Object.values(t.knowledge.claimArchive)]){if(c.hash!==contentHash({...c,hash:undefined}))errors.push(`${c.id} 主张哈希不匹配`);if(c.status==='usable-for-demo'&&(!c.locator.checked||!c.locator.section.trim()||!c.locator.paragraph.trim()||!t.knowledge.sources[c.sourceId]))errors.push(`${c.id} 缺少可核对来源与定位`);}
  for(const c of Object.values(t.knowledge.citations)){if(!t.knowledge.retrievals[c.retrievalId])errors.push(`${c.id} 检索记录缺失`);for(const ref of c.claimRefs){const claim=t.knowledge.claims[ref.id]?.version===ref.version?t.knowledge.claims[ref.id]:t.knowledge.claimArchive[`${ref.id}@${ref.version}`];if(!claim||claim.hash!==ref.hash)errors.push(`${c.id} 固定主张依赖缺失`);}for(const sr of c.sourceRefs)if(t.knowledge.sources[sr.sourceId]?.version!==sr.version&&!t.knowledge.sourceArchive[`${sr.sourceId}@${sr.version}`])errors.push(`${c.id} 固定来源依赖缺失`);}
  return [...new Set(errors)];
}

export function mergeTeaching(current:TeachingState,incoming:TeachingState):TeachingState{
  const errors=validateTeachingState(incoming);if(errors.length)throw Error(errors[0]);
  const out=structuredClone(current),copy=structuredClone(incoming),mapping=new Map<string,string>();
  const owned=['runs','sessions','attempts','evaluations','reviews','experiments','traces'] as const;
  for(const group of owned)for(const id of Object.keys(copy[group]))mapping.set(id,uid(id.split('-')[0]));
  for(const group of ['tasks','retrievals','citations'] as const)for(const id of Object.keys(copy.knowledge[group]))mapping.set(id,uid(id.split('-')[0]));
  for(const e of [...copy.exposures,...copy.knowledge.feedback])mapping.set(e.id,uid('import-record'));
  const rewrite=(v:unknown,key=''):unknown=>{if(typeof v==='string')return key==='id'||/(Id|Ids|^refs)$/.test(key)?mapping.get(v)??v:v;if(Array.isArray(v))return v.map(x=>rewrite(x,key));if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[mapping.get(k)??k,rewrite(x,k)]));return v;};
  const mapped=rewrite(copy) as TeachingState;
  for(const claim of Object.values(mapped.knowledge.claims)){
    const known=out.knowledge.claims[claim.id],archived=out.knowledge.claimArchive[`${claim.id}@${claim.version}`];
    const recognized=[known,archived].some(v=>v&&contentHash(v)===contentHash(claim));
    if(!recognized&&['usable-for-demo','source-checked'].includes(claim.status)){
      mapped.knowledge.claimArchive[`${claim.id}@${claim.version}`]=structuredClone(claim);
      claim.version=Math.max(claim.version,known?.version??0)+1;claim.status='draft';claim.locator.checked=false;
      claim.review='导入的自报审核不获采信；保留原版证据，需当前用户重新核对来源、定位和条件。';claim.hash=contentHash({...claim,hash:undefined});
      for(const citation of Object.values(mapped.knowledge.citations))if(citation.claimRefs.some(ref=>ref.id===claim.id)){
        citation.status='historical';citation.limitations.push('导入主张尚未在当前工作区重新核对；原解释保留为历史，不用于新答案。');
      }
    }
  }
  out.contentDrafts??={};for(const draft of Object.values(mapped.contentDrafts??{})){const id=uid('content-draft');out.contentDrafts[id]={...draft,id};}
  const knownPackages=new Set(Object.values(out.bundles).flatMap(b=>Object.entries(b.packages).map(([key,p])=>`${key}:${p.hash}`)));
  for(const b of Object.values(mapped.bundles))for(const [key,p]of Object.entries(b.packages))if(!knownPackages.has(`${key}:${p.hash}`))out.disabledPackages.push(key);
  const seqOffset=out.seq+1;for(const e of mapped.exposures)e.seq+=seqOffset;for(const a of Object.values(mapped.attempts))a.submitSeq+=seqOffset;
  out.seq=seqOffset+copy.seq;out.exposures.push(...mapped.exposures);
  for(const group of owned)Object.assign(out[group],mapped[group]);
  for(const [key,b]of Object.entries(mapped.bundles))if(!Object.values(out.bundles).some(existing=>contentHash(existing)===contentHash(b)))out.bundles[`${key}-${uid('archive')}`]=b;
  function mergeVersions<T extends {id:string;version:number}>(target:Record<string,T>,archive:Record<string,T>,values:Record<string,T>){for(const v of Object.values(values)){const old=target[v.id];if(!old){target[v.id]=v;continue;}if(old.version===v.version){if(contentHash(old)!==contentHash(v))throw Error(`${v.id}@${v.version} 同版本内容冲突，未覆盖现有工作区。`);}else if(old.version<v.version){archive[`${old.id}@${old.version}`]=old;target[v.id]=v;}else archive[`${v.id}@${v.version}`]=v;}}
  for(const [key,v]of Object.entries(mapped.knowledge.claimArchive)){if(out.knowledge.claimArchive[key]&&contentHash(out.knowledge.claimArchive[key])!==contentHash(v))throw Error(`${key} 历史主张冲突`);out.knowledge.claimArchive[key]=v;}
  for(const [key,v]of Object.entries(mapped.knowledge.sourceArchive)){if(out.knowledge.sourceArchive[key]&&contentHash(out.knowledge.sourceArchive[key])!==contentHash(v))throw Error(`${key} 历史来源冲突`);out.knowledge.sourceArchive[key]=v;}
  mergeVersions(out.knowledge.claims,out.knowledge.claimArchive,mapped.knowledge.claims);mergeVersions(out.knowledge.sources,out.knowledge.sourceArchive,mapped.knowledge.sources);
  for(const group of ['tasks','retrievals','citations'] as const)Object.assign(out.knowledge[group],mapped.knowledge[group]);out.knowledge.feedback.push(...mapped.knowledge.feedback);
  for(const r of Object.values(mapped.runs)){const p=lesson(out,`${r.packageRef.id}@${r.packageRef.version}`);if(!p||p.hash!==r.packageRef.hash){r.status='blocked';r.blockedReason='来源内容版本与当前包不一致；原作答只读保留，不套当前答案。';}}
  for(const s of Object.values(mapped.sessions))if(s.status==='answering'){s.assisted=true;s.revision++;}
  for(const trace of Object.values(mapped.traces))if(!['completed','cancelled','failed'].includes(trace.status)){trace.status='interrupted';trace.message='导入中断，已有成果保留；请新建任务。';}
  out.exposures.push({id:uid('exposure'),seq:++out.seq,at:new Date().toISOString(),keys:Object.values(copy.bundles).flatMap(b=>Object.values(b.questions).flatMap(questionExposureKeys)),kind:'possible',source:`import-with-answers:${copy.workspaceId}`});
  out.disabledPackages=[...new Set([...out.disabledPackages,...copy.disabledPackages])];
  if(copy.continuity==='unknown-history')out.continuity='unknown-history';out.knowledge.indexVersion=`knowledge:${contentHash(Object.values(out.knowledge.claims).map(c=>({id:c.id,version:c.version,hash:c.hash,status:c.status})))}`;
  const finalErrors=validateTeachingState(out);if(finalErrors.length)throw Error(finalErrors[0]);return out;
}
