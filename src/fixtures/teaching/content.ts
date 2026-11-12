import type { Choices, RangeInputs, Spot } from '../../modules/study/domain';
import type { Contrast, Evidence, Field, LessonPackage, Question, TeachingBundle, TeachingNode } from '../../modules/teaching/domain';
import { contentHash, stepNames } from '../../modules/teaching/domain';

// Explicit author-created concept examples. No solver output or strategic EV.
export const teachingCombos = ['AhJh','AdJd','AcJc','KsJs','KcJc','7h7d'];
const bbCombos = ['AsKd','AhKc','KdQc','QhJd','9s9c','6h6d'];
const initial = (combos:string[]) => Object.fromEntries(combos.map(c=>[c,10000]));
const opening:Choices = {AhJh:{fold:2500,raise25:7500},AdJd:{fold:2500,raise25:7500},AcJc:{fold:2500,raise25:7500},KsJs:{fold:5000,raise25:5000},KcJc:{fold:5000,raise25:5000},'7h7d':{fold:0,raise25:10000}};
const bPolicy:Choices = {AhJh:{check:4000,bet50:6000},AdJd:{check:4000,bet50:6000},AcJc:{check:7000,bet50:3000},KsJs:{check:5000,bet50:5000},KcJc:{check:7000,bet50:3000},'7h7d':{check:8000,bet50:2000}};
const fill = (combos:string[],policy:Record<string,number>):Choices => Object.fromEntries(combos.map(c=>[c,{...policy}]));
const opened = Object.fromEntries(teachingCombos.map(c=>[c,opening[c].raise25]));
const scale = (weights:Record<string,number>,factor:number)=>Object.fromEntries(Object.entries(weights).map(([c,w])=>[c,w*factor]));
const actionName:Record<string,string>={fold:'弃牌',raise3:'加注至 3 bb',raise25:'加注至 2.5 bb',raise10:'加注至 10 bb',raise22:'加注至 22 bb',call:'跟注',check:'过牌',bet50:'下注 50% 底池'};
const colors:Record<string,string>={fold:'#85919e',raise3:'#e6ad6b',call:'#79aee8',check:'#79aee8',raise25:'#e6ad6b',raise10:'#e6ad6b',raise22:'#b697e4',bet50:'#e6ad6b'};

function nodes():Record<string,TeachingNode>{
  const out:Record<string,TeachingNode>={};
  function add(id:string,label:string,actor:string,board:string[],pot:number,remaining:{BTN:number;BB:number},contributions:{BTN:number;BB:number;SB:number},ranges:RangeInputs,reference:Choices,edges:Record<string,string>,parent?:string,via='起始节点',toCall=0,ownPath:TeachingNode['ownPath']=[]) {
    const spot:Spot={nodeId:id,board,potMinor:pot,stackMinor:Math.min(remaining.BTN,remaining.BB),unitsPerBb:100,actor,rangeVersion:`${id}-range@1`,treeVersion:`${id.startsWith('TP01')?'TP01':'TP02'}-tree@1`,actionSet:Object.keys(Object.values(reference)[0]??{}).map(a=>({id:a,name:actionName[a],short:a==='bet50'?'B50':a==='check'?'X':a==='fold'?'F':a==='call'?'C':a.toUpperCase(),color:colors[a]}))};
    const history=parent?[...out[parent].history,via]:['六人桌 · 无前注/不计抽水 · 开局 100 bb','UTG / HJ / CO 已弃牌'];
    out[id]={id,label,parent,via,kind:'decision',spot,ranges,reference,history,contributions,remaining,toCall,edges,ownPath};
  }
  const r0={BTN:initial(teachingCombos),BB:initial(bbCombos)};
  add('TP01-P0','翻前 · BTN 首次入池','BTN',[],150,{BTN:10000,BB:9900},{BTN:0,BB:100,SB:50},r0,opening,{fold:'TP01-T0',raise25:'TP01-P1'});
  const r1={BTN:opened,BB:initial(bbCombos)};
  add('TP01-P1','翻前 · BB 面对 Open','BB',[],400,{BTN:9750,BB:9900},{BTN:250,BB:100,SB:50},r1,fill(bbCombos,{fold:3000,call:5000,raise10:2000}),{fold:'TP01-T1',call:'TP01-F1',raise10:'TP01-P2'},'TP01-P0','BTN 加至 2.5 bb；SB 弃牌',150,[{player:'BTN',nodeId:'TP01-P0',action:'raise25'}]);
  const r2={BTN:opened,BB:scale(r1.BB,.2)};
  add('TP01-P2','翻前 · BTN 面对 3-bet','BTN',[],1300,{BTN:9750,BB:9000},{BTN:250,BB:1000,SB:50},r2,fill(teachingCombos,{fold:4000,call:4000,raise22:2000}),{fold:'TP01-T2',call:'TP01-F2',raise22:'TP01-P3'},'TP01-P1','BB 加至 10 bb',750,[...out['TP01-P1'].ownPath,{player:'BB',nodeId:'TP01-P1',action:'raise10'}]);
  const r3={BTN:scale(opened,.2),BB:r2.BB};
  add('TP01-P3','翻前 · BB 面对 4-bet','BB',[],3250,{BTN:7800,BB:9000},{BTN:2200,BB:1000,SB:50},r3,fill(bbCombos,{fold:6000,call:4000}),{fold:'TP01-T3',call:'TP01-F3'},'TP01-P2','BTN 加至 22 bb',1200,[...out['TP01-P2'].ownPath,{player:'BTN',nodeId:'TP01-P2',action:'raise22'}]);
  const flops=[{n:1,pot:550,left:9750,paid:250,ranges:{BTN:opened,BB:scale(r1.BB,.5)},parent:'TP01-P1',via:'BB 跟至 2.5 bb'}, {n:2,pot:2050,left:9000,paid:1000,ranges:{BTN:scale(opened,.4),BB:r2.BB},parent:'TP01-P2',via:'BTN 跟至 10 bb'}, {n:3,pot:4450,left:7800,paid:2200,ranges:{BTN:r3.BTN,BB:scale(r3.BB,.4)},parent:'TP01-P3',via:'BB 跟至 22 bb'}];
  for(const f of flops){const path=[...out[f.parent].ownPath,{player:out[f.parent].spot.actor,nodeId:f.parent,action:'call'}];
    add(`TP01-F${f.n}`,`翻牌 · ${f.n===1?'SRP':f.n===2?'3-bet 底池':'4-bet 底池'} BB 行动`,'BB',['Qs','9h','5d'],f.pot,{BTN:f.left,BB:f.left},{BTN:f.paid,BB:f.paid,SB:50},f.ranges,fill(bbCombos,{check:10000}),{check:`TP01-H${f.n}`},f.parent,f.via+'；固定示例翻牌',0,path);
    add(`TP01-H${f.n}`,'翻牌 · BTN 研究节点','BTN',['Qs','9h','5d'],f.pot,{BTN:f.left,BB:f.left},{BTN:f.paid,BB:f.paid,SB:50},f.ranges,fill(teachingCombos,{check:5000,bet50:5000}),{check:`TP01-END${f.n}`,bet50:`TP01-END${f.n}`},`TP01-F${f.n}`,'BB 过牌',0,path);
  }
  for(const [i,parent,winner,gross,returned,pot]of [[0,'TP01-P0','BB',150,50,100],[1,'TP01-P1','BTN',400,150,250],[2,'TP01-P2','BB',1300,750,550],[3,'TP01-P3','BTN',3250,1200,2050]] as const){const base=out[parent];out[`TP01-T${i}`]={...structuredClone(base),id:`TP01-T${i}`,parent,via:'弃牌终局',label:'弃牌 · 已结算',kind:'terminal',edges:{},reference:{},settlement:{winner,gross,returned,pot},history:[...base.history,`${base.spot.actor} 弃牌${i===0?'；SB 弃牌':''}`]};}
  for(const f of flops)out[`TP01-END${f.n}`]={...structuredClone(out[`TP01-H${f.n}`]),id:`TP01-END${f.n}`,parent:`TP01-H${f.n}`,via:'本步决策后',kind:'segment-end',label:'教学片段结束',edges:{},reference:{}};
  const opening3=Object.fromEntries(Object.entries(opening).map(([combo,a])=>[combo,{fold:a.fold,raise3:a.raise25}]));
  add('TP01-C3-P0','对照 Open 3 · BTN 入池','BTN',[],150,{BTN:10000,BB:9900},{BTN:0,BB:100,SB:50},r0,opening3,{raise3:'TP01-C3-P1'});
  add('TP01-C3-P1','对照 Open 3 · BB 回应','BB',[],450,{BTN:9700,BB:9900},{BTN:300,BB:100,SB:50},r1,fill(bbCombos,{fold:3000,call:5000,raise10:2000}),{call:'TP01-C3-F'},'TP01-C3-P0','BTN 加至 3 bb；SB 弃牌',200,[{player:'BTN',nodeId:'TP01-C3-P0',action:'raise3'}]);
  const c3Path=[...out['TP01-C3-P1'].ownPath,{player:'BB',nodeId:'TP01-C3-P1',action:'call'}];
  add('TP01-C3-F','对照 Open 3 · 固定翻牌 BB 行动','BB',['Qs','9h','5d'],650,{BTN:9700,BB:9700},{BTN:300,BB:300,SB:50},out['TP01-H1'].ranges,fill(bbCombos,{check:10000}),{check:'TP01-C3'},'TP01-C3-P1','BB 跟至 3；固定翻牌',0,c3Path);
  add('TP01-C3','对照 · Open 3 / BB Call','BTN',['Qs','9h','5d'],650,{BTN:9700,BB:9700},{BTN:300,BB:300,SB:50},out['TP01-H1'].ranges,fill(teachingCombos,{check:5000,bet50:5000}),{},'TP01-C3-F','BB 过牌',0,[...c3Path,{player:'BB',nodeId:'TP01-C3-F',action:'check'}]);
  const base=out['TP01-H1'];
  add('TP02-F0','翻牌 · 近邻组合研究','BTN',base.spot.board,550,base.remaining,base.contributions,base.ranges,bPolicy,{check:'TP02-TX',bet50:'TP02-BB'},undefined);
  out['TP02-F0'].history=[...base.history];out['TP02-F0'].ownPath=structuredClone(base.ownPath);
  add('TP02-BB','翻牌 · BB 面对半池下注','BB',base.spot.board,825,{BTN:9475,BB:9750},{BTN:525,BB:250,SB:50},{BTN:Object.fromEntries(teachingCombos.map(c=>[c,opened[c]*bPolicy[c].bet50/10000])),BB:base.ranges.BB},fill(bbCombos,{fold:2500,call:7500}),{fold:'TP02-FOLD',call:'TP02-TB'},'TP02-F0','BTN 下注 2.75 bb',275,[...base.ownPath,{player:'BTN',nodeId:'TP02-F0',action:'bet50'}]);
  const turns=[{id:'TX',pot:550,left:9750,paid:250,parent:'TP02-F0',r:{BTN:Object.fromEntries(teachingCombos.map(c=>[c,opened[c]*bPolicy[c].check/10000])),BB:base.ranges.BB},via:'BTN 过牌'}, {id:'TB',pot:1100,left:9475,paid:525,parent:'TP02-BB',r:{BTN:out['TP02-BB'].ranges.BTN,BB:scale(base.ranges.BB,.75)},via:'BB 跟注 2.75 bb'}];
  for(const t of turns)for(const suit of ['h','c']){const id=`TP02-${t.id}${suit}`;add(id,`转牌 2${suit} · BTN 决策`,'BTN',['Qs','9h','5d',`2${suit}`],t.pot,{BTN:t.left,BB:t.left},{BTN:t.paid,BB:t.paid,SB:50},t.r,fill(teachingCombos,{check:5000,bet50:5000}),{check:'TP02-END',bet50:'TP02-END'},t.parent,t.via+`；示例转牌 2${suit}；BB 过牌`,0,out[t.parent].ownPath);}
  out['TP02-F0'].edges.check='TP02-TXh';out['TP02-BB'].edges.call='TP02-TBh';
  out['TP02-END']={...structuredClone(out['TP02-TBh']),id:'TP02-END',parent:'TP02-TBh',kind:'segment-end',label:'教学片段结束',via:'本步决策后',edges:{},reference:{}};
  out['TP02-FOLD']={...structuredClone(out['TP02-BB']),id:'TP02-FOLD',parent:'TP02-BB',kind:'terminal',label:'BB 弃牌 · 已结算',via:'BB 弃牌',edges:{},reference:{},settlement:{winner:'BTN',gross:825,returned:275,pot:550}};
  for(const i of [1,2,3])out[`TP01-H${i}`].ownPath.push({player:'BB',nodeId:`TP01-F${i}`,action:'check'});
  out['TP02-F0'].ownPath=structuredClone(out['TP01-H1'].ownPath);
  out['TP02-BB'].ownPath=[...out['TP02-F0'].ownPath,{player:'BTN',nodeId:'TP02-F0',action:'bet50'}];
  for(const suit of ['h','c']){out[`TP02-TX${suit}`].ownPath=[...out['TP02-F0'].ownPath,{player:'BTN',nodeId:'TP02-F0',action:'check'}];out[`TP02-TB${suit}`].ownPath=[...out['TP02-BB'].ownPath,{player:'BB',nodeId:'TP02-BB',action:'call'}];}
  // Last user action ends this teaching segment, but its public ledger still changes.
  for(const n of Object.values(out).filter(n=>n.kind==='decision'&&Object.values(n.edges).some(id=>id.startsWith('TP01-END')||id==='TP02-END'))){
    for(const a of Object.keys(n.edges)){const id=`${n.id}-end-${a}`,delta=a==='bet50'?n.spot.potMinor/2:0;const end=structuredClone(n);end.id=id;end.parent=n.id;end.kind='segment-end';end.label='教学片段结束';end.via=actionName[a];end.spot={...end.spot,nodeId:id,potMinor:n.spot.potMinor+delta,stackMinor:Math.min(n.remaining.BTN-delta,n.remaining.BB)};end.contributions.BTN+=delta;end.remaining.BTN-=delta;end.edges={};end.reference={};end.ownPath.push({player:n.spot.actor,nodeId:n.id,action:a});end.history.push(`BTN ${actionName[a]}`);out[id]=end;n.edges[a]=id;}
  }
  for(const id of ['TP01-END1','TP01-END2','TP01-END3','TP02-END'])delete out[id];
  for(const n of Object.values(out))n.spot.nodeId=n.id;
  return out;
}
const field = (id:string,label:string,options:[string,string][]):Field=>({id,label,options:options.map(([id,label])=>({id,label}))});
const yesNo = [['yes','是'],['no','否']] as [string,string][];
function question(id:string,title:string,prompt:string,fields:Field[],answer:Record<string,string>,feedback:string,extra:Partial<Question>={}):Question {
  const q:Question={id,version:1,hash:'',packageId:id.startsWith('A')?'LP-A':'LP-B',title,prompt,objective:id.startsWith('A')?'LO02':'LO04',board:id.startsWith('A')?[]:['Qs','9h','5d'],hero:'AhJh',fields,answer,feedback,exposureKeys:[`fact:${id}`],kind:'concept',claimIds:id.startsWith('A')?['TC01','TC03']:['TC08','TC17'],hint:'先核对当前输入和问题的条件，不用频率替代 EV。',...extra};q.hash=contentHash({...q,hash:undefined});return q;
}
export function createTeachingBundle():TeachingBundle {
  const nodeMap=nodes();
  const questions:Record<string,Question>={};const add=(q:Question)=>{questions[q.id]=q;};
  add(question('A-I01','识别行动前条件','前位已经弃牌，当前轮到谁？SB 的后续弃牌已经发生了吗？',[field('actor','当前行动方',[['BTN','BTN'],['BB','BB']]),field('sb','SB 已弃牌',yesNo)],{actor:'BTN',sb:'no'},'当前 BTN 行动；后续 SB 弃牌不能提前当作历史。',{objective:'LO01'}));
  add(question('B-I01','核对当前牌面','AhJh 在 Qs9h5d 已经是同花听牌吗？',[field('draw','当前是同花听牌',yesNo)],{draw:'no'},'现在只有三张红桃可用，是后门可能；不是四张同花的听牌。',{objective:'LO04'}));
  for(const p of ['A','B'])add(question(`${p}-P01`,'记录 Hero 预测','先选择自己的行动，可记录理由和不确定性。当前没有可信的最优动作数值，本步不判战略对错。',[],{},'预测已固定；后续观察不会覆盖你原先的判断。',{kind:'prediction',actions:p==='A'?[{id:'fold',name:'弃牌'},{id:'raise25',name:'加注至 2.5 bb'}]:[{id:'check',name:'过牌'},{id:'bet50',name:'下注 50%'}]}));
  const numberField=(id:string,label:string,values:string[])=>field(id,label,values.map(v=>[v,v]));
  add(question('A-Q01','追溯单玩家权重','AhJh 初始权重 10000，Open 频率 75%，再跟 3-bet 频率 40%。保留权重是多少？',[numberField('weight','保留权重',['3000','7500','1500'])],{weight:'3000'},'10000 × 0.75 × 0.4 = 3000；未计算双方相容性，这不是完整真实到达概率。'));
  add(question('A-Q02','检查账本','BTN 加至 2.5、BB 跟注后，底池和双方剩余分别是多少 bb？',[numberField('pot','底池',['5.5','6.5','4']),numberField('left','各自剩余',['97.5','99','95'])],{pot:'5.5',left:'97.5'},'2.5 + 2.5 + SB 0.5 = 5.5；双方各剩 97.5。',{exposureKeys:['fact:srp-ledger']}));
  add(question('B-Q01','比较近邻花色','AhJh 与 AcJc 在 Qs9h5d 有相同的后门同花条件吗？',[field('same','条件相同',yesNo)],{same:'no'},'牌面有一张红桃但没有梅花；只核对事实，不由此证明示意频率。',{exposureKeys:['fact:flop-neighbors']}));
  add(question('B-Q02','区分比例分母','“下注范围中某类别占比”和“该类别下注比例”的分母相同吗？',[field('same','分母相同',yesNo)],{same:'no'},'前者分母是下注总量，后者分母是该类别总量。',{claimIds:['TC17','TC18']}));
  for(const p of ['A','B']){const targets=p==='A'?['AhJh','AdJd','AcJc']:['AhJh','AdJd','KsJs'];const policy=p==='A'?opening:bPolicy;add(question(`${p}-R01`,'局部范围作品','只为指定的三个组合分配行动；其余组合是题目给定，不计为你的作答。',[],{},'结构与作者示意分布的差异分别显示；这不是 GTO 评分。',{kind:'range',targets,given:Object.fromEntries(teachingCombos.filter(c=>!targets.includes(c)).map(c=>[c,policy[c]])),weights:p==='A'?initial(teachingCombos):opened,reference:policy,actions:Object.keys(policy.AhJh).map(id=>({id,name:actionName[id]})),claimIds:['TC01','TC03','TC17']}));}
  add(question('A-X01','相同总量的反例','把 AhJh 与 7h7d 的 Open 分配互换：总量相同吗？逐组合策略相同吗？',[field('total','总量相同',yesNo),field('policy','逐组合相同',yesNo)],{total:'yes',policy:'no'},'同起始权重下总量相同，但分配给各组合的行动不同。',{exposureKeys:['fact:composition-not-total']}));
  add(question('B-X01','检验后门规则','换成 Qc9s5d，AhJh 仍有后门红桃同花可能吗？',[field('backdoor','有后门红桃可能',yesNo)],{backdoor:'no'},'当前只有手里两张红桃，两张未来牌也不足五张。',{board:['Qc','9s','5d']}));
  add(question('A-M01','迁移 · 当前节点','BTN 已加至 2.5、SB 已弃牌，BB 还投入 1 bb。现在谁行动，跟注需再投入多少？',[field('actor','行动方',[['BTN','BTN'],['BB','BB']]),numberField('call','跟注增量 bb',['1.5','2.5','1'])],{actor:'BB',call:'1.5'},'BB 决策，再投入 1.5 bb 跟至 2.5。',{exposureKeys:['fact:bb-open-call']}));
  add(question('A-M02','迁移 · 3-bet 底池','BTN 跟至 10 bb 后，底池与双方剩余分别为多少？',[numberField('pot','底池 bb',['20.5','5.5','32.5']),numberField('left','双方剩余 bb',['90','97.5','78'])],{pot:'20.5',left:'90'},'10 + 10 + 0.5 = 20.5；各自剩余 90。',{exposureKeys:['fact:threebet-ledger']}));
  add(question('A-M03','迁移 · 新权重','某组合初始权重 5000，自身连续两步行动频率为 60% 和 25%。保留权重是多少？',[numberField('weight','保留权重',['750','3000','1250'])],{weight:'750'},'5000 × 0.6 × 0.25 = 750。这里只是单玩家简化示意。'));
  add(question('A-D01','延迟复测 · 4-bet 条件','BB 跟至 22 bb 后，底池与双方剩余是多少？可直接沿用 SRP 的范围版本吗？',[numberField('pot','底池 bb',['44.5','20.5','32.5']),numberField('left','双方剩余 bb',['78','90','97.5']),field('reuse','可直接沿用 SRP 范围',yesNo)],{pot:'44.5',left:'78',reuse:'no'},'22 + 22 + 0.5 = 44.5；各剩 78，范围来自不同前序行动。',{exposureKeys:['fact:fourbet-ledger']}));
  add(question('B-M01','迁移 · 新组合','KdJd 在 Qh9c5s 有后门方块同花可能吗？',[field('backdoor','有后门方块可能',yesNo)],{backdoor:'no'},'翻牌没有方块，两张未来牌不足以形成五张方块。',{hero:'KdJd',board:['Qh','9c','5s']}));
  const drawOptions:[string,string][]=[['made','已经成花'],['draw','同花听牌，未成花'],['backdoor','仅后门可能']];
  add(question('B-M02','迁移 · 转牌状态','AsJs 在 Qd9s5c2s 属于哪种状态？',[field('state','同花状态',drawOptions)],{state:'draw'},'手里两张与牌面两张黑桃，共四张，是同花听牌。',{hero:'AsJs',board:['Qd','9s','5c','2s']}));
  add(question('B-M03','迁移 · 比较边界','总下注量相同，足以确定具体组合构成与 EV 都相同吗？',[field('same','足以确定',yesNo)],{same:'no'},'仍需逐组合策略、输入条件与评价模型。',{exposureKeys:['fact:composition-not-total'],claimIds:['TC17','TC25']}));
  add(question('B-D01','延迟复测 · 条件判断','AcJc 在 Qd9h5c2c 的同花状态是什么？仅凭此事实足以决定最优动作吗？',[field('state','同花状态',drawOptions),field('optimal','足以决定最优动作',yesNo)],{state:'draw',optimal:'no'},'四张梅花，是同花听牌；仍缺双方范围、树与评价依据。',{hero:'AcJc',board:['Qd','9h','5c','2c']}));
  const evidence:Record<string,Evidence>={
    'A-E01':{id:'A-E01',title:'范围如何沿自身行动保留',observation:'AhJh：Open 后 7500；跟 3-bet 路径 3000；4-bet 路径 1500。',conditions:'输入权重 10000，自身对应示意频率 75% / 40% / 20%。',limitations:'单玩家权重示意，未计算对手范围相容性与移除效应；示意频率没有 Solver 验证。',claimIds:['TC01','TC02','TC03'],exposureKeys:['fact:A-Q01']},
    'A-E02':{id:'A-E02',title:'逐步投入，而非把加注额再加一次',observation:'SRP 底池 5.5 bb / 各剩 97.5；3-bet 跟注底池 20.5 / 各剩 90；4-bet 跟注底池 44.5 / 各剩 78。',conditions:'开局 100 bb；SB 0.5、BB 1；无前注、不计抽水。',limitations:'有限示例账本；raise-to 与新增投入区分。毛额、未跟注退还和净利润不同。',claimIds:['TC25','TC26'],exposureKeys:['fact:srp-ledger','fact:threebet-ledger','fact:fourbet-ledger']},
    'A-E03':{id:'A-E03',title:'总频率不代表组合构成',observation:'相同权重下互换两个组合的分配可保持总量，但具体行动范围不同。',conditions:'需同时检查各组合及固定输入。',limitations:'总量或频率相似不是 EV 或可利用性证明。',claimIds:['TC01','TC17','TC18'],exposureKeys:['fact:composition-not-total']},
    'B-E01':{id:'B-E01',title:'近邻花色事实',observation:'Qs9h5d：AhJh/AdJd/KsJs 有相应后门同花可能；AcJc/KcJc 没有；7h7d 为口袋对子。',conditions:'仅核对这六组合和指定牌面的花色事实。',limitations:'事实不能证明示意动作频率，也不声称完整识别顺子听牌或阻断强度。',claimIds:['TC08','TC15','TC16'],exposureKeys:['fact:B-I01','fact:flop-neighbors']},
    'B-E02':{id:'B-E02',title:'读图时先看分母',observation:'类别内行动比例的分母是类别总量；行动内类别占比的分母是行动总量。',conditions:'按输入权重汇总；重叠标签不能相加凑 100%。',limitations:'没有 joint matchup 计算，不能称真实行动到达频率。',claimIds:['TC17','TC18','TC36'],exposureKeys:['fact:B-Q02']},
    'B-E03':{id:'B-E03',title:'将观察、假说和证据分开',observation:'一个花色事实或一个作者给定分布，不足以确定这个动作的真实 EV。',conditions:'需要完整输入、对手策略、树与结果来源。',limitations:'当前教学包战略 EV 不可用；正确总结可以是“证据不足以解释精确频率”。',claimIds:['TC05','TC08','TC25'],exposureKeys:[]},
  };
  const contrasts:Record<string,Contrast>={
    'A-C01':{id:'A-C01',title:'BB 跟注或 3-bet',variable:'BB 的回应',baseline:'BB 跟至 2.5：底池 5.5 bb，各剩 97.5 bb。',variant:'BB 加至 10、BTN 跟注：底池 20.5 bb，各剩 90 bb，范围路径不同。',observation:'BB 的回应改变了投入及后续条件；不能拿 SRP 结果改名。',limits:'这是受控示例，不判哪个动作更赚钱。',claimIds:['TC03','TC25'],exposureKeys:['fact:srp-ledger','fact:threebet-ledger']},
    'A-C02':{id:'A-C02',title:'Open 尺度 2.5 与 3',variable:'BTN Open 至的金额',baseline:'2.5 bb / BB Call：底池 5.5，各剩 97.5。',variant:'3 bb / BB Call：底池 6.5，各剩 97。',observation:'初始筹码与范围固定；金额差异是尺度变化派生的。',limits:'保持示意策略不变是作者假设，不代表真实策略不会变化。',claimIds:['TC25','TC26'],exposureKeys:['fact:srp-ledger']},
    'B-C01':{id:'B-C01',title:'转牌 2♥ 与 2♣',variable:'一张转牌的花色',baseline:'Qs9h5d2h：AhJh 有四张红桃，是同花听牌。',variant:'Qs9h5d2c：AhJh 只有三张红桃，下一张不能完成同花。',observation:'固定翻牌 Bet/Call 路径，底池均为 11 bb，各剩 94.75。',limits:'花色事实不证明必须下注，也不提供真实 EV 变化。',claimIds:['TC08','TC15'],exposureKeys:['fact:turn-heart-vs-club']},
    'B-C02':{id:'B-C02',title:'AhJh 与 AcJc',variable:'Hero 具体花色组合',baseline:'AhJh 在 Qs9h5d 有后门红桃可能。',variant:'AcJc 在同一牌面没有后门梅花可能。',observation:'点数和牌面相同，具体花色条件不同。',limits:'观察不等于精确策略原因；60%/30% 是作者示意。',claimIds:['TC15','TC16'],exposureKeys:['fact:flop-neighbors']},
  };
  const packages:Record<string,LessonPackage>={};
  for(const [id,title,description]of [['LP-A','翻前行动怎样形成翻后范围','从 BTN 入池到 3-bet / 4-bet，再追踪进入翻后的范围。'],['LP-B','从近邻组合读懂范围结构','核对具体花色，理解两个统计分母，用对照检验解释。']] as const){const p=id==='LP-A'?'A':'B';const item:LessonPackage={id,version:1,hash:'',title,description,kind:'concept-demo',publication:'demo-ready',review:'结构校验与作者自检；未独立教学审核；无真实 Solver 验证',objectives:id==='LP-A'?['LO01','LO02','LO03','LO05','LO06']:['LO03','LO04','LO05','LO06'],steps:[...stepNames],questionIds:Object.keys(questions).filter(q=>q.startsWith(p)),evidenceIds:[`${p}-E01`,`${p}-E02`,`${p}-E03`],contrastIds:[`${p}-C01`,`${p}-C02`],transferIds:[`${p}-M01`,`${p}-M02`,`${p}-M03`],delayedId:`${p}-D01`,rootNode:id==='LP-A'?'TP01-P0':'TP02-F0',scenarioId:id==='LP-A'?'TP01':'TP02'};item.hash=contentHash({...item,hash:undefined,questions:item.questionIds.map(q=>questions[q]),evidence:item.evidenceIds.map(e=>evidence[e]),contrasts:item.contrastIds.map(c=>contrasts[c])});packages[`${id}@1`]=item;}
  const bundle:TeachingBundle={schemaVersion:1,packages,questions,evidence,contrasts,nodes:nodeMap};
  for(const p of Object.values(packages))p.hash=lessonPackageHash(p,bundle);
  return bundle;
}
export function lessonPackageHash(p:LessonPackage,b:TeachingBundle){return contentHash({...p,hash:undefined,questions:p.questionIds.map(id=>b.questions[id]),evidence:p.evidenceIds.map(id=>b.evidence[id]),contrasts:p.contrastIds.map(id=>b.contrasts[id]),nodes:Object.values(b.nodes).filter(n=>n.id.startsWith(p.scenarioId))});}
export const builtInTeachingBundle=createTeachingBundle();
