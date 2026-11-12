import { contentHash } from '../../modules/teaching/domain';
import type { KnowledgeState, TheoryClaim, TheoryContext, TheorySource, TheoryTopic } from '../../modules/teaching/domain';

const topicRows = [
  ['规则与行动语义','位置顺序/action order','合法行动/legal action','加注至与增量/raise to','未跟注退还/uncalled return'],
  ['组合与概率','组合数/combinations','条件概率/conditional probability','公共死牌/dead cards','私牌相容性/matchup compatibility'],
  ['范围与策略','输入权重/range weights','行动分布/strategy frequencies','到达范围/reach range','真实频率/matchups'],
  ['EV 与权益','期望收益/EV','权益/equity','权益实现/EQR','收益参照原点/EV origin'],
  ['投入与收益计算','底池赔率/pot odds','隐含赔率/implied odds','反向隐含赔率/reverse implied odds','筹码底池比/SPR'],
  ['博弈论基础','均衡/equilibrium','混合策略/mixed strategy','最佳响应/best response','可利用性/exploitability'],
  ['翻前入池','首次加注/RFI','溜入/limp','隔离加注/isolation raise','位置与范围/position range'],
  ['翻前回应','跟注/flat call','三次下注/3-bet','四五次下注/4-bet 5-bet','挤压加注/squeeze'],
  ['盲注与筹码深度','盲注防守/blind defense','有效筹码/effective stacks','短筹码/short stack','深筹码/deep stack'],
  ['范围结构','范围优势/range advantage','坚果优势/nut advantage','极化与线性/polarized linear','封顶范围/capped range'],
  ['牌面与类别','成牌与听牌/made hand draw','牌面纹理/board texture','后门可能/backdoor','类别重叠/overlapping categories'],
  ['位置与主动权','有利不利位置/IP OOP','位置价值/position value','先前进攻方/aggressor','延迟行动/delayed action'],
  ['翻牌策略','持续下注/c-bet','过牌加注/check raise','领打/donk','试探下注/probe'],
  ['转牌与河牌计划','二次开火/double barrel','后续牌/runout','延迟下注/delayed bet','河牌范围/river range'],
  ['价值与诈唬','薄价值/thin value','半诈唬/semi bluff','抓诈/bluff catch','价值诈唬构成/value bluff'],
  ['尺度与约束','小注/small bet','大注超池/overbet','几何下注/geometric sizing','全压与树/all in tree'],
  ['防守与风险收益','最小防守/MDF','诈唬阈值/alpha','防守含加注/defend raise','模型条件/model assumptions'],
  ['阻断与信息','移除效应/card removal','阻断/blocker','不阻断/unblocker','弃牌聚集/bunching'],
  ['剥削与假设','组合锁定/nodelock','频率锁定/frequency lock','样本不确定性/sample uncertainty','鲁棒调整/robust exploit'],
  ['多人底池','多方范围/multiway range','多人防守/multiway defense','边池/side pot','单挑边界/heads up boundary'],
  ['赛事价值模型','筹码期望/chipEV','独立筹码模型/ICM','风险溢价/risk premium','泡沫决赛桌/bubble final table'],
  ['赛事扩展','未来模拟/FGS','淘汰赏金/KO','累进赏金/PKO','奖金单位/prize utility'],
  ['求解与模型','反事实遗憾/CFR','树抽象/abstraction','收敛质量/convergence','重算边界/re-solving'],
  ['学习与证据','复盘偏差/review bias','结果与质量/result decision','迁移检索/transfer retrieval','方差样本/variance sample'],
];
export const theoryTopics:TheoryTopic[] = topicRows.map(([title,...names],i)=>({id:`KT${String(i+1).padStart(2,'0')}`,title,concepts:names.map((text,j)=>{const [name,english]=text.split('/');return {id:`KT${String(i+1).padStart(2,'0')}.C${j+1}`,name,aliases:[name,english]};})}));
const sourceRows = [
  ['Pio 概念 FAQ','PioSOLVER','https://site.piosolver.com/docs/faq/gto_concept/'],
  ['Pio 数值含义','PioSOLVER','https://site.piosolver.com/docs/viewer/numbers_in_piosolver/'],
  ['Equity Realization','GTO Wizard · Andrew Brokos','https://blog.gtowizard.com/equity-realization/'],
  ['MDF & Alpha','GTO Wizard · Tombos21','https://blog.gtowizard.com/mdf-alpha/'],
  ['Understanding Blockers in Poker','GTO Wizard · Madmanslime','https://blog.gtowizard.com/understanding-blockers-in-poker/'],
  ['Breakdown Tab','GTO Wizard Help','https://help.gtowizard.com/breakdown-tab/'],
  ['Tree Configuration','HoldemResources','https://www.holdemresources.net/docs/tree-config/'],
  ['Working with Frequency Locks','HoldemResources','https://www.holdemresources.net/docs/frequency-locks/'],
  ['Postflop Calculations','HoldemResources','https://www.holdemresources.net/docs/postflop/'],
  ['Monte Carlo Sampling','HoldemResources','https://www.holdemresources.net/docs/monte-carlo-sampling/'],
  ['Views','MonkerWare','https://www.monkerware.com/views.html'],
  ['Abstraction','MonkerWare','https://www.monkerware.com/compare.html'],
];
type Seed = [number,number,number,string,string,string,string,string,TheoryContext?];
// Each item is an independently locatable authored paraphrase, not a copied strategy table.
const seeds:Seed[] = [
  [1,1,3,'范围权重','权重表达某组合在范围中的相对出现量。','What is the difference between Range and Strategy?','L58','不能把权重当作该手牌下注频率。'],
  [2,1,3,'行动频率','策略为持有某组合时采取各动作的概率分配。','What is the difference between Range and Strategy?','L60','与输入权重分开；动作概率应合计为一。'],
  [3,1,3,'自身行动后的范围','起始权重沿自身已选行动的策略比例保留。','What is the difference between Range and Strategy?','L61-L64','单玩家示意还不是考虑双方相容性的真实频率。'],
  [4,2,2,'真实频率与相容性','共同牌及对手范围会改变组合的实际相对可能性。','Range weight vs real frequency','L39-L43','只统计自身组合权重会遗漏相容性。'],
  [5,1,6,'混合动作的 EV 条件','精确均衡中使用的混合动作有相同 EV。','Why is solver sometimes choosing action with negative EV?','L28-L33','近似解存在误差；不等于任意整套混频都不可利用。'],
  [6,1,4,'EV 的参照原点','全局投入收益与界面弃牌为零的口径可不同。','What are two numbers returned by solver command calc_ev_pp?','L38-L40','比较前应固定单位和参照原点。'],
  [7,2,4,'权益的含义','权益衡量在无后续下注的比较中占有的底池份额。','Equity calculation','L58-L63','不是当前动作的完整 EV。'],
  [8,3,4,'权益不直接等于决策价值','有后续下注时，权益本身不足以表达行动价值。','Equity and Expected Value','paragraphs 1-3','还需要范围、后续策略与下注机会。'],
  [9,3,4,'权益实现与后续策略','EQR 解释权益在后续策略中的实现程度。','Equity Realization; Using Equity Realization','main definition and closing discussion','依赖局面与双方后续行为，不是固定手牌常数。'],
  [10,3,4,'EQR 的单位约定','EQR 将权益与 EV 联系起来，需沿同一底池和收益口径。','Equity Realization','definition and displayed relation','零权益或不同 EV 原点时不可直接套比例。'],
  [11,4,17,'防守不只是跟注','在 MDF 讨论中，继续可以通过跟注或加注实现。','What Counts as “Defending”?','L56-L58','不能把整体防守目标称为跟注比例。',{players:'HU'}],
  [12,4,17,'MDF 的零权益假设','MDF 的风险收益推导围绕零权益诈唬的盈亏平衡。','What Is the Minimum Defense Frequency?','L49-L55','不是每个翻后节点必须执行的通用动作表。',{players:'HU'}],
  [13,4,17,'初始下注公式有边界','初始下注的 pot/bet 写法不能不变地用于加注。','Calculation / The Formula','L90-L103; disclaimer after cheat sheet','加注应重新明确风险和奖励。',{players:'HU'}],
  [14,4,17,'对手假设影响防守研究','讨论 MDF 时仍要核对对手是否有足够诈唬。','Warning About MDF','L59-L71','不能将简化模型当对所有对手的强制行动。',{players:'HU'}],
  [15,5,18,'阻断取决于行动角色','阻断相关范围时，价值下注、诈唬、抓诈有不同目标。','Understanding Blockers','L49-L81','不能从“有 blocker”直接推出应诈唬。'],
  [16,5,18,'先看对手范围再解释花色','同样花色的意义需回到对手价值和诈唬组成。','Analyzing Blockers','L124-L140','外部特例的策略频率不能复制给当前课程。',{street:'river',players:'HU'}],
  [17,6,10,'类别内行动比例','Performed% 回答该类别采取所选行动的比例。','Definitions','L35-L36','分母为该类别，不是整个行动范围。'],
  [18,6,10,'行动内类别占比','Represented% 回答所选行动范围中某类别的组成。','Definitions','L37-L38','与类别内行动比例使用不同分母。'],
  [19,6,11,'类别范围占比','Range% 以整个输入范围为类别组合占比的分母。','Definitions','L31-L34','输入加权口径和重叠标签需另外声明。'],
  [20,11,11,'分类视图的聚合','类别视图可汇总对应手牌的 EV、数量和行动频率。','Introducing views','paragraph 1','聚合视图不是新的求解结果。'],
  [21,11,11,'类别优先级','重叠类别按该产品视图的先后顺序分配。','Creating a view','paragraph after format example','该产品的优先级规则不等于所有分类都互斥。'],
  [22,8,19,'频率锁定与组合锁定','频率锁定约束到达节点时的整体行动频率。','Key Concepts','L90-L94','不等于固定某一比例的具体组合。'],
  [23,8,19,'保留未锁行动','HRC 频率锁定操作要求至少一个动作未锁定。','How to Use Frequency Locking','L78-L81','这是特定产品约束，不代表本 Demo 已实现该求解。'],
  [24,8,19,'锁定修改后的重算','HRC 修改频率锁定后需按文档重跑采样。','How to Use Frequency Locking','L84','不能只改标题就声称新策略已求得。'],
  [25,7,23,'研究树定义问题','Solver 求的是指定抽象游戏，树不合适会使结论失去实际意义。','Introduction','L61-L65','树未建模的动作不等于真实规则中不合法。'],
  [26,7,16,'加注至与增量','尺寸语法中的 raise-to 表达累计到达额，需与本次增量区分。','Sizing Syntax','L71-L84','金额解释还需前序投入；本地账本为独立算例。'],
  [27,10,23,'CI 是启发式指标','HRC CI 追踪近期翻前策略变化的稳定程度。','The Convergence Indicator (CI)','L70-L80','不是严格误差界或本地示例的数学收敛证明。'],
  [28,10,23,'罕见分支的收敛','罕见行动线可能比主范围更晚稳定。','The Convergence Indicator (CI)','L74-L81','主范围稳定不能自动证明所有深层节点精确。'],
  [29,10,23,'子树重算固定上游','子树采样从给定前序条件开始，不更新更早行动的范围与 EV。','Subtree Sampling','L89-L105','不能将局部结果描述成整树已经重新优化。'],
  [30,10,23,'初始采样并非完成','新建 Monte Carlo 分析的初始采样通常不足以得到准确结果。','The Basics: Calculating a Monte Carlo Hand','L52-L66','任务建立成功和结果质量是不同状态。'],
  [31,9,23,'翻后副本的输入继承','从翻前创建的独立翻后分析继承输入后，不随原范围后来修改而改变。','Setting Up Postflop Calculations','L68-L78','旧成果保留旧输入，新研究需明确新版本。'],
  [32,9,23,'抽象影响可解释粒度','HRC 翻后不同抽象选项会舍弃不同花色细节。','Postflop Abstraction Options','L79-L117','抽象掉的信息不能用于精确阻断解释。'],
  [33,9,23,'缺失 EV 不应填零','HRC 文档的低质量抽象选项在相关街道不显示 EV。','Postflop Abstraction Options / [LQ] IR','L111-L117','不能将未提供指标显示成零收益或零损失。'],
  [34,12,23,'并桶限制策略','抽象将手牌合并入桶后，桶内使用相同动作频率。','Abstraction','paragraphs 1-2','这是求解抽象，不是只合并显示。'],
  [35,12,18,'抽象可能舍弃阻断差异','Monker 的例子说明部分花色并桶可能合并非完全等价手牌。','Omaha postflop','final example and paragraph','该例属于 Omaha；不能直接当作当前 NLHE 策略证明。'],
  [36,11,11,'未分类组合仍需保留','分类视图未命中类别的手牌归入 Other。','Creating a view','paragraph after format example','不能只汇总已选类别而丢掉剩余范围。'],
];
export function createKnowledgeSeed():KnowledgeState {
  const sources:Record<string,TheorySource>={};sourceRows.forEach(([title,author,url],i)=>{const id=`TS${String(i+1).padStart(2,'0')}`;sources[id]={id,version:1,title,author,url,publishedAt:null,checkedAt:'2026-11-12',kind:'官方文档/作者公开教学文章',status:'available',limits:'人工阅读并定位后自写摘要；未独立教学审核；不支持本地示意频率。'};});
  const claims:Record<string,TheoryClaim>={};
  for(const [n,s,t,title,statement,section,paragraph,exceptions,conditions={}] of seeds){const id=`TC${String(n).padStart(2,'0')}`,topicId=`KT${String(t).padStart(2,'0')}`;const c:TheoryClaim={id,version:1,hash:'',topicId,conceptId:`${topicId}.C1`,title,statement,aliases:[title,...theoryTopics[t-1].concepts.flatMap(c=>c.aliases)],sourceId:`TS${String(s).padStart(2,'0')}`,locator:{section,paragraph,summary:statement,checked:true},conditions,scope:Object.keys(conditions).length?'conditional':'general',exceptions,counterexample:exceptions,status:'usable-for-demo',review:'来源段落已核对；作者摘要自检；未独立审核',relatedIds:[],conflictIds:[],exposureKeys:[]};c.hash=contentHash({...c,hash:undefined});claims[id]=c;}
  const conceptSlot:Record<number,number>={1:1,2:2,3:3,4:4,5:2,6:4,7:2,8:1,9:3,10:3,11:3,12:1,13:4,14:4,15:2,16:3,17:4,18:4,19:4,20:4,21:4,22:2,23:2,24:2,25:2,26:3,27:3,28:3,29:4,30:3,31:4,32:2,33:2,34:2,35:1,36:4};
  const extraAliases:Record<number,string[]>={13:['MDF','alpha formula'],16:['blocker','阻断花色'],17:['Performed%','range breakdown','分类分母'],18:['Represented%','range breakdown','分类分母'],19:['Range%','分类分母'],26:['raise to','加注至'],27:['confidence interval','置信区间'],28:['rare line','低频路径'],30:['Monte Carlo','采样质量'],36:['Other','未分类']};
  for(const [n]of seeds){const c=claims[`TC${String(n).padStart(2,'0')}`];if([17,18,19].includes(n))c.topicId='KT11';if(n===26)c.topicId='KT01';const topic=theoryTopics.find(t=>t.id===c.topicId)!;const slot=conceptSlot[n]??1;c.conceptId=`${c.topicId}.C${slot}`;c.aliases=[c.title,...topic.concepts[slot-1].aliases,...extraAliases[n]??[]];}
  const misunderstandings:Record<string,[string,string]>={
    TC01:['输入权重 75% 就是该手牌下注 75%。','概念构造：某组合可以有 75% 输入权重，却在当前节点 100% 过牌；两个概率口径不同，不是 Solver 数值。'],
    TC07:['权益较高就可以直接决定跟注。','反例条件：改变跟注价格或未来下注机会，不能沿用只比较摊牌份额的结论；仍缺完整行动 EV。'],
    TC09:['某手牌有一个永远不变的权益实现率。','对手范围、位置和后续策略改变时，不能直接搬用另一局面的 EQR；本库不提供通用手牌常数。'],
    TC12:['每个节点都必须严格达到 MDF。','多人局或对手没有足够诈唬时，HU 零权益诈唬模型不能无条件变成当前动作要求。'],
    TC16:['持有某花色 blocker 就应该拿来诈唬。','价值下注、诈唬和抓诈会关注不同的对手范围部分；本条还限定河牌 HU，不能直接证明翻牌 AhJh 的频率。'],
    TC17:['类别内下注比例等于下注范围中的类别占比。','作者算术例：类别权重 50、其中下注 30、总下注权重 100，则前者 60%、后者 30%；不是任何实际策略输出。'],
    TC27:['界面置信区间保证真实 GTO 已精确收敛。','低频路径的采样不确定性与模型抽象误差需分别检查；来源称启发式区间，不是所有误差的数学保证。'],
    TC34:['把组合合并入求解桶只是换一种显示方式。','同一求解桶会限制桶内共同策略；单纯显示聚合并不施加同频限制，不能混为一谈。'],
  };
  for(const [id,[wrong,counter]]of Object.entries(misunderstandings)){claims[id].misconception=wrong;claims[id].counterexample=counter;}
  claims.TC35.conditions={variant:'Omaha'};claims.TC35.scope='conditional';
  claims.TC17.exposureKeys=['fact:B-Q02'];claims.TC18.exposureKeys=['fact:B-Q02'];
  sources.TS03.publishedAt='2022-11-16';sources.TS04.publishedAt='2022-07-01';sources.TS05.publishedAt='2023-03-14';
  claims.TC01.relatedIds=['TC02','TC03','TC04'];claims.TC17.relatedIds=['TC18','TC19'];claims.TC11.relatedIds=['TC12','TC13','TC14'];
  for(const c of Object.values(claims))c.hash=contentHash({...c,hash:undefined});
  return {topics:structuredClone(theoryTopics),sources,claims,claimArchive:{},sourceArchive:{},tasks:{},retrievals:{},citations:{},indexVersion:'knowledge-seed@1',feedback:[]};
}
