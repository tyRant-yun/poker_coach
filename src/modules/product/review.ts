import { normalizeCombo, validateSpot } from '../study/domain';
import type { Spot, WorkspaceSnapshot } from '../study/domain';
import { copy, now, uid } from './context';
import type { ProductContext, Result } from './context';
import { emptyProduct } from './domain';
import type { ImportedHand } from './domain';
import { completeHandText, incompleteHandText, handDecisions, scenarioFor } from '../../fixtures/scenarios';
import type { createLearningCommands } from './learning';

export function createReviewCommands(ctx:ProductContext,learning:ReturnType<typeof createLearningCommands>){
  function put(hand:ImportedHand){const data=ctx.getData(),product=data.product??emptyProduct();ctx.replaceData({...data,product:{...product,hands:{...product.hands,[hand.id]:hand}}});}
  const api={
    importHand(raw:string):Result<string>{
      if(!raw.trim()||raw.length>200000)return ctx.fail('请输入不超过 200 KB 的手牌文本。');
      const kind=raw.trim()===completeHandText?'complete':raw.trim()===incompleteHandText?'incomplete':'unknown',id=uid('hand');
      put({id,raw,kind,confirmed:kind==='complete',missing:kind==='complete'?[]:kind==='incomplete'?['底池','剩余筹码','行动历史需确认']:['未知格式：未执行通用解析，请手工确认一个行动前节点'],createdAt:now(),decisions:kind==='complete'?copy(handDecisions):[]});ctx.notice(kind==='complete'?'内置手牌脚本已识别，可在行动前视角复盘。':'原文已保存为待整理草稿，没有补造动作或金额。','info');return {ok:true,value:id};
    },
    importHandExample(kind:'complete'|'incomplete'):Result<string>{return api.importHand(kind==='complete'?completeHandText:incompleteHandText);},
    confirmHandNode(id:string,fields:{board:string[];potMinor:number;stackMinor:number;hero:string;actor:string}):Result{
      const hand=ctx.getData().product?.hands[id];if(!hand)return ctx.fail('手牌不存在。');
      const spot:Spot={board:fields.board,potMinor:fields.potMinor,stackMinor:fields.stackMinor,actor:fields.actor,unitsPerBb:100,rangeVersion:'manual',treeVersion:'manual'};
      const error=validateSpot(spot),hero=normalizeCombo(fields.hero);if(error||!hero||fields.board.some(card=>hero.includes(card))||!['BTN','BB'].includes(fields.actor))return ctx.fail(error??'请确认有效 Hero 手牌与当前行动者，不能与公共牌冲突。');
      put({...hand,confirmed:true,missing:[],decisions:[{id:uid('decision'),label:'用户确认的行动前节点',board:[...fields.board],actor:fields.actor,potMinor:fields.potMinor,stackMinor:fields.stackMinor,hero,actionHistory:['此节点来自用户确认；原始行动未被脚本解析。']}]});ctx.notice('已保存用户确认字段，原文保持不变。');return {ok:true,value:undefined};
    },
    extractHandNode(handId:string,decisionId:string):Result<string>{
      const hand=ctx.getData().product?.hands[handId],decision=hand?.decisions.find(d=>d.id===decisionId);if(!hand?.confirmed||!decision)return ctx.fail('请先确认缺失字段，再提取行动前节点。');
      const template=scenarioFor('S07')!.nodes.find(n=>n.id===(decision.id==='flop'?'S07-root':`S07-${decision.id}`))??scenarioFor('S07')!.nodes[0];
      const created=ctx.base.createCase(`复盘提取 · ${decision.label}`,'S07');if(!created.ok)return created;
      const c=ctx.getCase(created.value)!;
      const spot={...copy(template.spot),board:copy(decision.board),potMinor:decision.potMinor,stackMinor:decision.stackMinor,actor:decision.actor};
      if(hand.kind!=='complete')spot.upstream='user-confirmed-uncovered';
      ctx.replaceCase({...c,spot,spotRevisionId:uid('spot'),ranges:copy(template.ranges),origin:{handId,decisionId},note:'牌面与金额来自行动前快照；双方范围采用明确选择的 S07 合成研究假设，不代表实际对手范围。'});
      ctx.notice('已提取独立研究；双方范围使用 S07 示例假设，原始牌谱不改写。','info');return created;
    },
    practiceFromHand(handId:string,decisionId:string):Result<string>{const extracted=api.extractHandNode(handId,decisionId);if(!extracted.ok)return extracted;return learning.startPractice('range','S07',extracted.value);},
  };return api;
}
export const reviewQueries={
  hands:(data:WorkspaceSnapshot)=>Object.values(data.product?.hands??{}).map(({id,kind,confirmed,missing,createdAt})=>({id,kind,confirmed,missing,createdAt})),
  handView:(data:WorkspaceSnapshot,id:string,decisionId?:string,mode:'player'|'omniscient'='player')=>{
    const hand=data.product?.hands[id];if(!hand)return null;
    const d=hand.decisions.find(d=>d.id===decisionId)??hand.decisions[0];
    const safe=d?{id:d.id,label:d.label,board:copy(d.board),actor:d.actor,potMinor:d.potMinor,stackMinor:d.stackMinor,actionHistory:[...d.actionHistory],hero:d.hero}:null;
    return {id:hand.id,kind:hand.kind,confirmed:hand.confirmed,missing:[...hand.missing],mode,decisions:hand.decisions.map(({id,label})=>({id,label})),decision:mode==='omniscient'?copy(d??null):safe,raw:mode==='omniscient'?hand.raw:null,opponent:mode==='omniscient'?d?.opponent:undefined,future:mode==='omniscient'?d?.future:undefined};
  },
};
