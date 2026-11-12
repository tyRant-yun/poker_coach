import type { Allocation, Choices, RangeInputs, Spot } from '../study/domain';

export type PackageId = 'LP-A' | 'LP-B';
export type ContentKind = 'concept-demo' | 'workflow-synthetic';
export type AssetRef = { id: string; version: number; hash: string };
export type Field = { id: string; label: string; options: { id: string; label: string }[] };
export type Question = {
  id: string; version: number; hash: string; packageId: PackageId; title: string;
  objective: string; prompt: string; board: string[]; hero: string;
  fields: Field[]; answer: Record<string,string>; feedback: string;
  exposureKeys: string[]; kind: 'concept' | 'prediction' | 'range' | 'summary';
  claimIds: string[]; hint: string; actions?: { id:string; name:string }[];
  targets?: string[]; given?: Choices; weights?: Record<string,number>; reference?: Choices;
};
export type TeachingNode = {
  id:string; label:string; parent?:string; via:string; kind:'decision'|'terminal'|'segment-end';
  spot:Spot; ranges:RangeInputs; reference:Choices; history:string[];
  contributions:{BTN:number;BB:number;SB:number}; remaining:{BTN:number;BB:number};
  toCall:number; edges:Record<string,string>; ownPath:{player:string;action:string;nodeId:string}[];
  settlement?:{winner:string;gross:number;returned:number;pot:number};
};
export type Evidence = { id:string; title:string; observation:string; conditions:string; limitations:string; claimIds:string[]; exposureKeys:string[] };
export type Contrast = {id:string;title:string;variable:string;baseline:string;variant:string;observation:string;limits:string;exposureKeys:string[];claimIds:string[]};
export type LessonPackage = {
  id:PackageId;version:number;hash:string;title:string;description:string;kind:ContentKind;
  publication:'draft'|'demo-ready'|'disabled';review:string;objectives:string[];steps:string[];
  questionIds:string[];evidenceIds:string[];contrastIds:string[];transferIds:string[];delayedId:string;
  rootNode:string;scenarioId:'TP01'|'TP02';
};
export type TeachingBundle = {schemaVersion:1;packages:Record<string,LessonPackage>;questions:Record<string,Question>;evidence:Record<string,Evidence>;contrasts:Record<string,Contrast>;nodes:Record<string,TeachingNode>};
export type Exposure = {id:string;seq:number;at:string;keys:string[];kind:'seen'|'possible'|'hint';source:string;sessionId?:string};
export type TeachingResponse = {answers:Record<string,string>;action:string;reason:string;confidence:string;choices:Choices};
export const blankResponse = ():TeachingResponse => ({answers:{},action:'',reason:'',confidence:'unknown',choices:{}});
export type TeachingEvaluation = {
  id:string;attemptId:string;policy:'T1-EP01';at:string;inputHash:string;definitionHash:string;
  structure:'valid'|'incomplete';concept:Record<string,{correct:boolean;expected:string;label:string}>;
  distribution:number|null;strategicEV:null;reasonStatus:'recorded-not-graded';feedback:string;claimIds:string[];citationBundleId?:string;
};
export type TeachingAttempt = {
  id:string;runId?:string;sessionId?:string;questionId:string;definition:AssetRef;packageRef:AssetRef;
  createdAt:string;response:TeachingResponse;assisted:boolean;exposure:'no-record'|'seen'|'possible'|'unknown-history';
  submitSeq:number;kind:'lesson'|'transfer'|'retake'|'delayed'|'demo-preview';parentId?:string;evaluationId:string;
};
export type TeachingSession = {
  id:string;runId:string;questionId:string;packageRef:AssetRef;revision:number;status:'answering'|'feedback'|'completed'|'blocked';
  kind:TeachingAttempt['kind'];response:TeachingResponse;assisted:boolean;hintLevel:number;revealed:boolean;attemptIds:string[];
  createdAt:string;reviewId?:string;blockedReason?:string;parentId?:string;
};
export type LineRun = {mode:'guided'|'test';nodeId:string;decisions:{nodeId:string;action:string;at:string}[];complete:boolean;revealed:boolean};
export type LessonRun = {
  id:string;packageRef:AssetRef;revision:number;status:'active'|'paused'|'completed'|'abandoned'|'blocked';step:number;
  draft:TeachingResponse;attemptIds:string[];revealed:string[];skipped:string[];contrastPredictions:Record<string,string>;
  experimentIds:string[];line?:LineRun;summary?:string;createdAt:string;updatedAt:string;blockedReason?:string;
};
export type TeachingExperiment = {id:string;runId:string;contrastId:string;prediction:string;baseline:string;variant:string;variable:string;observation:string;conclusion:string;createdAt:string;baselineCaseId?:string;variantCaseId?:string;baselineVersionId?:string;variantVersionId?:string;baselineInputHash?:string;variantInputHash?:string};
export type ReviewItem = {id:string;runId:string;questionId:string;packageRef:AssetRef;dueAt:string;status:'scheduled'|'completed'|'blocked';attemptIds:string[];previewIds:string[]};
export type TheoryContext = {format?:'cash'|'mtt';players?:'HU'|'multiway';street?:'preflop'|'flop'|'turn'|'river';model?:'bb'|'ICM';variant?:'NLHE'|'Omaha';runId?:string};
export type TheorySource = {id:string;version:number;title:string;author:string;url:string;publishedAt:string|null;checkedAt:string;kind:string;status:'available'|'offline';limits:string};
export type TheoryClaim = {
  id:string;version:number;hash:string;topicId:string;conceptId:string;title:string;statement:string;aliases:string[];
  sourceId:string;locator:{section:string;paragraph:string;summary:string;checked:boolean};
  misconception?:string;conditions:TheoryContext;scope:'general'|'conditional';exceptions:string;counterexample:string;
  status:'draft'|'source-checked'|'usable-for-demo'|'disputed'|'retired';review:string;
  relatedIds:string[];conflictIds:string[];exposureKeys:string[];
};
export type TheoryTopic = {id:string;title:string;concepts:{id:string;name:string;aliases:string[]}[]};
export type RetrievalHit = {claimId:string;claimRef?:AssetRef;sourceVersion?:number;score:number;applicability:'match'|'conflict'|'insufficient-context'|'general-background';reasons:string[]};
export type RetrievalRecord = {id:string;query:string;context:TheoryContext;indexVersion:string;createdAt:string;filters?:{topicId?:string;conceptId?:string};hits:RetrievalHit[];excluded:{claimId:string;reason:string}[];restricted:boolean};
export type CitationBundle = {id:string;retrievalId:string;createdAt:string;claimRefs:AssetRef[];sourceRefs:{sourceId:string;version:number;section:string;paragraph:string}[];limitations:string[];status:'supported-background'|'insufficient'|'historical';purpose:'backgroundConcept'};
export type KnowledgeTask = {id:string;question:string;topicId:string;sourceId?:string;draft?:TheoryClaim;status:'question'|'source-located'|'drafted'|'source-checked'|'published'|'blocked';revision:number;notes:string[];createdAt:string};
export type KnowledgeState = {topics:TheoryTopic[];sources:Record<string,TheorySource>;claims:Record<string,TheoryClaim>;claimArchive:Record<string,TheoryClaim>;sourceArchive:Record<string,TheorySource>;tasks:Record<string,KnowledgeTask>;retrievals:Record<string,RetrievalRecord>;citations:Record<string,CitationBundle>;indexVersion:string;feedback:{id:string;claimId:string;text:string;at:string}[]};
export type TeachingTrace = {id:string;runId?:string;sessionId?:string;intent:string;status:'planned'|'running'|'completed'|'failed'|'cancelled'|'paused'|'interrupted';steps:{tool:string;observation:string;refs:string[]}[];createdAt:string;budget:number;spent:number;cursor:number;revision:number;retrievalId?:string;citationId?:string;message:string};
export type TeachingState = {
  version:1;workspaceId:string;seq:number;continuity:'complete'|'unknown-history';bundles:Record<string,TeachingBundle>;
  runs:Record<string,LessonRun>;sessions:Record<string,TeachingSession>;attempts:Record<string,TeachingAttempt>;evaluations:Record<string,TeachingEvaluation>;
  exposures:Exposure[];reviews:Record<string,ReviewItem>;experiments:Record<string,TeachingExperiment>;
  knowledge:KnowledgeState;traces:Record<string,TeachingTrace>;commandResults:Record<string,string>;
  activeSessionId?:string;pendingDisclosure?:boolean;disabledPackages:string[];contentDrafts?:Record<string,{id:string;raw:string;errors:string[];createdAt:string;publishedKeys:string[]}>;migration?:{sourceSchema:number;sourceDigest:string;at:string};
};
export const packageKey = (id:PackageId,version=1) => `${id}@${version}`;
export function stableString(value:unknown):string {
  if(Array.isArray(value)) return `[${value.map(stableString).join(',')}]`;
  if(value && typeof value==='object')return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+stableString(v)).join(',')}}`;
  return JSON.stringify(value)??'null';
}
export function contentHash(value:unknown):string {const s=stableString(value);let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return `fnv1a32:${(h>>>0).toString(16).padStart(8,'0')}:${s.length}`;}
export const refOf = (value:{id:string;version:number;hash:string}):AssetRef => ({id:value.id,version:value.version,hash:value.hash});
export function questionExposureKeys(q:Question):string[]{return [...new Set([...q.exposureKeys,`semantic:${contentHash({prompt:q.prompt,board:q.board,hero:q.hero,fields:q.fields,answer:q.answer,targets:q.targets,weights:q.weights,reference:q.reference})}`])];}
export const stepNames = ['目标与 Hero 预测','证据与近邻','局部范围构建','条件对照','反例检验','连续决策片段','总结与迁移','迁移与复测'];
export function distributionDistance(choices:Choices,reference:Choices,weights:Record<string,number>,targets:string[],actions:string[]):number|null {
  let sum=0,mass=0;
  for(const combo of targets){const p=choices[combo],q=reference[combo],w=weights[combo]??0;if(!p||!q||actions.some(a=>!Number.isInteger(p[a])||p[a]<0||p[a]>10000)||Object.keys(p).some(a=>!actions.includes(a))||actions.reduce((s,a)=>s+p[a],0)!==10000)return null;sum+=w*actions.reduce((s,a)=>s+Math.abs(p[a]-q[a])/20000,0);mass+=w;}
  return mass?sum/mass:null;
}
export function allocationFor(actions:string[],selected:string):Allocation{return Object.fromEntries(actions.map(id=>[id,id===selected?10000:0]));}
