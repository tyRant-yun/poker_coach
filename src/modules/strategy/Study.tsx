import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { commands, queries, useWorkspace } from '../../app/workspace';
import { actionsFor, policyStats } from '../study/domain';
import type { PolicyRevision, StudyCase } from '../study/domain';
import { Board, Dialog, Icon, dateTime, percent } from '../../shared/ui';
import { FrequencyBar } from './RangeVisuals';
import { ReferenceRange } from './ReferenceRange';
import { ReferenceFillButton } from './ReferenceFillButton';
import { HeroStudy } from './HeroStudy';
import { StrategyEditor } from './StrategyEditor';
import { VersionHistory } from './VersionHistory';
import { ResearchWorkbench } from '../product/ResearchWorkbench';
import { runningStatuses } from '../product/domain';
import s from '../../styles/App.module.css';

export function Study() {
  const { caseId = '' } = useParams();
  const c = useWorkspace(st => st.data.cases[caseId]);
  const [params, setParams] = useSearchParams();
  const tab = params.get('view') ?? 'explore';
  const [conditions, setConditions] = useState(false);
  const [selected, setSelected] = useState('AKs');
  const [confirm, setConfirm] = useState<'example' | 'clear' | null>(null);
  if (!c) return <div className={s.emptyCard}><h1>没有找到这个研究案例</h1><p>案例可能保存在另一个浏览器中。</p><Link to="/library" className={s.primaryButton}>返回局面库</Link></div>;
  const stats = queries.stats(c);
  const version = c.versions.find(v => v.id === params.get('version')) ?? c.versions.at(-1);
  const changeTab = (view: string, versionId?: string) => setParams({ view, ...(versionId ? { version: versionId } : {}) });
  function submit() {
    const result = commands.submitPolicy(caseId);
    if (result.ok) changeTab('feedback', result.value);
  }
  return <div className={s.studyPage}>
    <div className={s.studyTopline}><Link to="/library"><Icon name="grid" size={14} />局面库</Link><Icon name="chevron" size={13} /><span>{c.scenarioId} · {queries.scenario(c.scenarioId)?.title}</span><span className={s.studyDraft}>V{c.versions.length + 1} 草稿 · r{c.draft.editRevision}</span></div>
    {c.branchSource && <p className={s.assistanceNote}>研究分支 · 来源 V{c.branchSource.versionNumber} · {c.branchSource.caseId}</p>}
    <div className={s.studyHeading}><div><h1>{c.name}</h1><p>构建整个范围的行动，观察策略的结构。</p></div><button className={s.secondaryButton} onClick={() => setConditions(true)}><Icon name="sliders" size={16} />局面条件</button></div>
    <section className={s.spotBand}><div className={s.spotBoard}><span className={s.eyebrow}>{c.spot.board.length===5?'RIVER':c.spot.board.length===4?'TURN':c.spot.board.length===0?'PREFLOP':'FLOP'}</span><Board cards={c.spot.board} /></div><div className={s.spotMetric}><span>底池</span><b>{(c.spot.potMinor / c.spot.unitsPerBb).toFixed(1)}<small>bb</small></b></div><div className={s.spotMetric}><span>有效剩余筹码</span><b>{(c.spot.stackMinor / c.spot.unitsPerBb).toFixed(1)}<small>bb</small></b></div><div className={s.spotPosition}><div><span>行动方</span><strong>{c.spot.actor} <small>决策</small></strong></div><div><span>对手</span><strong>BB <small>OOP</small></strong></div></div><div className={s.actionPath}><span>翻前 <b>BTN 2.5 bb</b><Icon name="chevron" size={12} /><b>BB 跟注</b></span><span>翻牌 <b>BB 过牌</b><Icon name="chevron" size={12} /><strong>轮到 BTN</strong></span></div></section>
    <div className={s.studyTabs} role="tablist" aria-label="研究视图">{[['explore','Solver 研究','推荐'], ['hero', 'Hero 推演', '聚焦'], ['strategy', '全范围构建', '进阶'], ['feedback', '参考与反馈', '对照'], ['history', '版本记录', String(c.versions.length).padStart(2, '0')]].map(([id, name, num]) => <button role="tab" data-navigation="true" aria-selected={tab === id} className={tab === id ? s.tabActive : ''} onClick={() => changeTab(id)} key={id}>{name}<span>{num}</span></button>)}<span className={s.tabHint}><span className={s.greenDot} />Hero → 同类 → 全范围</span></div>
    {tab === 'explore' && <ResearchWorkbench key={c.id} c={c} onEdit={()=>changeTab('strategy')}/>}
    {tab === 'hero' && (c.spot.board.length!==3 || !actionsFor(c.spot).every(a=>['check','bet33','bet75'].includes(a.id))) && <p className={s.assistanceNote}>Hero 行动线表单当前演示翻牌 X/B33/B75；请在 Solver 研究中聚焦本节点的具体组合。</p>}
    {tab === 'hero' && c.spot.board.length===3 && actionsFor(c.spot).every(a=>['check','bet33','bet75'].includes(a.id)) && <HeroStudy key={c.id + c.spotRevisionId} c={c} onRange={label => { setSelected(label); changeTab('strategy'); }} />}
    {tab === 'strategy' && c.draft.assistance && <p className={s.assistanceNote}><Icon name="info" size={14} />当前草稿包含示例参考辅助，不作为独立范围训练的证据。</p>}
    {tab === 'strategy' && <div><StrategyEditor key={c.id} c={c} initialHand={selected} onSelectHand={setSelected} /><section className={s.submitBar}><div><span className={s.coverageRing} style={{ background: `conic-gradient(#76d6b3 ${stats.coverage * 360}deg,#34404a 0)` }}><span>{Math.round(stats.coverage * 100)}<small>%</small></span></span><div><b>你的范围构建</b><p>{stats.filled} / {stats.combos.length} 个组合已完成{stats.invalid ? ` · ${stats.invalid} 个频率待修正` : ''}</p></div></div><button className={s.primaryButton} onClick={submit}>提交策略 <Icon name="arrow" size={16} /></button></section><div className={s.inlineTools}><button onClick={() => commands.fillRemaining(caseId)}><Icon name="check" size={14} />{actionsFor(c.spot)[0]?.id==='check'?'其余全部过牌':`其余全部${actionsFor(c.spot)[0]?.name??'填写'}`}</button><button onClick={() => setConfirm('example')}>载入示例分配</button><button onClick={() => setConfirm('clear')}>清空草稿</button><span>提交版本将独立保存</span></div></div>}
    {tab === 'feedback' && <Feedback c={c} version={version} onVersion={id => changeTab('feedback', id)} onEdit={() => changeTab('strategy')} />}
    {tab === 'history' && <VersionHistory c={c} onOpen={id => changeTab('feedback', id)} onRestore={id => { commands.restoreAsDraft(caseId, id); changeTab('strategy'); }} />}
    {conditions && <Conditions c={c} onClose={() => setConditions(false)} />}
    {confirm && <Dialog title={confirm === 'example' ? '载入示例分配' : '清空当前草稿'} onClose={() => setConfirm(null)}><div className={s.dialogBody}><p>{confirm === 'example' ? '将未锁定的分配替换为作者编写的完整示例分配。它用于演示比较，并非真实 Solver 策略。' : '移除当前草稿未锁定的行动分配。已经提交的版本和报告不会被删除。'}</p><div className={s.dialogActions}><button className={s.secondaryButton} onClick={() => setConfirm(null)}>保留当前草稿</button><button className={s.primaryButton} onClick={() => { if (confirm === 'example') commands.loadExample(caseId); else commands.clearDraft(caseId); setConfirm(null); }}>确认{confirm === 'example' ? '载入' : '清空'}</button></div></div></Dialog>}
  </div>;
}
function Feedback({ c, version, onVersion, onEdit }: { c: StudyCase; version?: PolicyRevision; onVersion: (id: string) => void; onEdit: () => void }) {
  const [source, setSource] = useState(false);
  const job = c.jobs.filter(j => j.policyRevisionId === version?.id).at(-1);
  const report = c.reports.filter(r => r.policyRevisionId === version?.id).at(-1);
  const output = c.jobs.find(j => j.id === report?.jobId)?.result;
  const running = !!job && runningStatuses.includes(job.status);
  if (!version) {
    const currentReference = queries.latestReference(c);
    const pending = c.jobs.find(j => j.policyRevisionId === null && j.spotRevisionId === c.spotRevisionId && runningStatuses.includes(j.status));
    return <div>{currentReference?.result?.reference ? <>
      <ReferenceRange spot={c.spot} reference={currentReference.result.reference} weights={queries.weights('BTN', c)} heroCombo={queries.latestHeroPlan(c)?.combo} userChoices={c.draft.choices} />
      <ReferenceFillButton c={c} jobId={currentReference.id} onComplete={onEdit} />
    </> : <div className={s.emptyCard}><div className={s.emptyIcon}><Icon name="report" size={26} /></div><h2>不必先填完整个范围</h2><p>直接查看当前局面的合成参考；完整提交只用于评价你自己的范围方案。</p><button className={s.primaryButton} disabled={!!pending} onClick={() => void commands.requestReference(c.id)}>{pending ? '正在读取范围参考…' : '无需提交，运行范围参考'}</button></div>}</div>;
  }
  const stats = policyStats(version.spot, queries.weights(version.spot.actor, version), version.choices);
  const refStats = output?.reference ? policyStats(version.spot, queries.weights(version.spot.actor, version), output.reference) : null;
  return <div className={s.feedbackLayout}><section className={s.feedbackMain}><div className={s.versionHeader}><div><span className={s.eyebrow}>SUBMITTED STRATEGY</span><h2>提交版本 <span className={s.versionPill}>V{version.number}</span></h2><p>{dateTime(version.createdAt)} · 输入已固定，后续编辑不会改变本版。</p></div><label className={s.versionSelect}>查看版本<select aria-label="查看提交版本" value={version.id} onChange={e => onVersion(e.target.value)}>{c.versions.map(v => <option key={v.id} value={v.id}>V{v.number}</option>)}</select></label></div><div className={s.versionContext}><Board cards={version.spot.board} small /><span>底池 {(version.spot.potMinor / version.spot.unitsPerBb).toFixed(1)} bb</span><code>{version.spotRevisionId}</code></div>
    {version.assistance && <p className={s.assistanceNote}><Icon name="info" size={14} />这份提交包含参考辅助，不等同于独立作答。</p>}
    <div className={s.simulationBox}><div className={s.simulationIcon}>{running ? <span className={s.spinner} /> : <Icon name={job?.status === 'completed' ? 'check' : 'play'} size={22} />}</div><div><h3>{running ? '正在运行本地模拟' : job?.status === 'cancelled' ? '本次模拟已取消' : job?.status === 'interrupted' ? '上次模拟被刷新中断' : report ? '模拟反馈已生成' : '准备好比较你的策略了吗？'}</h3><p>{running ? job.stage : '使用预置合成参考，不执行真实扑克求解。'}</p></div>{running ? <button className={s.secondaryButton} onClick={() => commands.cancelJob(c.id, job.id)}>取消模拟</button> : <button className={s.primaryButton} onClick={() => void commands.requestSolve(c.id, version.id)}><Icon name="play" size={15} />{report ? '重新运行模拟' : '运行模拟分析'}</button>}</div>
    {running && <div className={s.progressTrack}><span /></div>}
    {!running && report && <><div className={s.reportHeading}><h2>范围结构反馈</h2><button className={s.textButton} onClick={() => setSource(true)}>查看来源与条件 <Icon name="info" size={14} /></button></div>{job?.status === 'cancelled' && <p className={s.muted}>以下保留的是上次完成的报告，本次取消未生成新结果。</p>}<div className={s.feedbackMetrics}><div><span>构建完整度</span><strong>100<small>%</small></strong><p>{stats.combos.length} 个组合 · 结构校验通过</p></div><div><span>参考频率差异</span><strong>{report.difference === null ? '—' : (report.difference * 100).toFixed(1)}{report.difference !== null && <small>%</small>}</strong><p>{report.difference === null ? '当前条件没有匹配参考' : '加权分配差异，越接近零越相似'}</p></div><div><span>固定对手 EV · 示例</span><strong>{report.sampleEv?.value.toFixed(2) ?? '未覆盖'}{report.sampleEv && <small>{version.spot.unit??'bb'}</small>}</strong><p>{report.sampleEv ? '仅绑定该预置策略的合成收益' : '不为任意自定义策略编造收益'}</p></div></div>
    {output?.reference && <ReferenceRange spot={version.spot} reference={output.reference} weights={queries.weights(version.spot.actor, version)} userChoices={version.choices} userLabel={`你的 V${version.number}`} heroCombo={c.heroPlans.filter(p => p.spotRevisionId === version.spotRevisionId).at(-1)?.combo} />}
    {output && output.availability !== 'available' ? <div className={s.uncoveredBox}><Icon name="info" /><div><h3>这组输入还没有演示结果</h3><p>{output.reason}</p><p>已提交策略与结构校验仍可查看。</p></div></div> : <section className={s.compareCard}><h3>整体行动分布</h3><FrequencyBar totals={stats.totals} available={actionsFor(version.spot)} label={`你的提交 · V${version.number}`} />{refStats && <FrequencyBar totals={refStats.totals} available={actionsFor(version.spot)} label="作者编写的示例参考" />}<div className={s.compareDivider} /><h3>差异最大的牌类</h3><p className={s.muted}>用于定位分配差异，不把差异直接判为错误。</p><div className={s.differenceRows}>{report.largestDifferences.map(d => <div key={d.label}><strong>{d.label}</strong><span><i style={{ width: percent(d.difference) }} /></span><b>{percent(d.difference)}</b></div>)}</div></section>}
    {output?.reference && <ReferenceFillButton c={c} jobId={report.jobId} onComplete={onEdit} />}
    <div className={s.feedbackActions}><button className={s.primaryButton} onClick={onEdit}>返回当前草稿修改 <Icon name="arrow" size={15} /></button><button className={s.secondaryButton} onClick={() => { commands.restoreAsDraft(c.id, version.id); onEdit(); }}>从此版本建立草稿</button></div></>}
    {!running && !report && <div className={s.feedbackBlank}><Icon name="layers" size={34} /><h3>让你的分配变得可比较</h3><p>模拟完成后，会在这里展示整体频率、组合差异与报告条件。</p></div>}
  </section><aside className={s.feedbackAside}><section className={s.guideCard}><span className={s.eyebrow}>READ THE FEEDBACK</span><h3>三个不同的问题</h3><div className={s.explanation}><span>01</span><div><b>结构完整吗？</b><p>是否覆盖所有组合，频率是否有效。</p></div></div><div className={s.explanation}><span>02</span><div><b>与参考差多少？</b><p>比较行动分配，帮助定位构成差异。</p></div></div><div className={s.explanation}><span>03</span><div><b>真实收益如何？</b><p>本轮没有真实求值，收益仅展示绑定输入的合成示例。</p></div></div><div className={s.guideNote}><Icon name="info" size={15} />频率差异不等于 EV 损失，也不证明整体可利用性。</div></section></aside>
    {source && report && <Dialog title="报告来源与适用条件" onClose={() => setSource(false)}><div className={s.dialogBody}><dl className={s.sourceList}><dt>数据身份</dt><dd>synthetic · 作者编写的演示数据</dd><dt>策略版本</dt><dd>V{version.number} · {version.id}</dd><dt>局面修订</dt><dd>{report.spotRevisionId}</dd><dt>生成作业</dt><dd>{report.jobId}</dd><dt>输入指纹</dt><dd><code>{report.inputFingerprint}</code></dd><dt>参考版本</dt><dd>{output?.fixtureVersion}</dd></dl><p>{output?.reason}</p><p className={s.muted}>完整度与频率差异在本地计算；收益为预置示例。后续编辑不会改变这份报告。</p><button className={s.primaryButton} onClick={() => setSource(false)}>返回报告</button></div></Dialog>}
  </div>;
}
function Conditions({ c, onClose }: { c: StudyCase; onClose: () => void }) {
  const [name, setName] = useState(c.name);
  const [board, setBoard] = useState(c.spot.board.join(' '));
  const [pot, setPot] = useState(String(c.spot.potMinor / c.spot.unitsPerBb));
  const [stack, setStack] = useState(String(c.spot.stackMinor / c.spot.unitsPerBb));
  return <Dialog title="研究局面与假设" onClose={onClose}><form className={s.dialogBody} onSubmit={e => { e.preventDefault(); const result = commands.reviseSpot(c.id, { ...c.spot, board: board.trim().split(/\s+/), potMinor: Math.round(Number(pot) * c.spot.unitsPerBb), stackMinor: Math.round(Number(stack) * c.spot.unitsPerBb) }, name); if (result.ok) onClose(); }}><label className={s.formField}>研究名称<input value={name} onChange={e => setName(e.target.value)} maxLength={80} /></label><label className={s.formField}>翻牌 · 例如 As 7d 2c<input value={board} onChange={e => setBoard(e.target.value)} aria-label="翻牌输入" /></label><div className={s.formColumns}><label className={s.formField}>底池 / bb<input type="number" step="0.01" min="0.01" value={pot} onChange={e => setPot(e.target.value)} aria-label="底池 bb" /></label><label className={s.formField}>剩余筹码 / bb<input type="number" step="0.01" min="0.01" value={stack} onChange={e => setStack(e.target.value)} /></label></div><div className={s.conditionFacts}><span>行动方 <b>BTN · IP</b></span><span>范围 <b>{c.spot.rangeVersion}</b></span><span>行动树 <b>{actionsFor(c.spot).map(a=>a.short).join(" / ")}</b></span></div><p className={s.muted}>修改会建立局面修订并清空当前草稿，历史版本保留。超出 S01 条件的输入可以研究和保存，但本轮没有对应模拟参考。</p><div className={s.dialogActions}><button type="button" className={s.secondaryButton} onClick={onClose}>取消</button><button type="submit" className={s.primaryButton}>建立修订并清空草稿</button></div></form></Dialog>;
}
