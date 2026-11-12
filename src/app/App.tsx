import { Component, lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { commands, queries, useWorkspace } from './workspace';
import { Board, Dialog, Icon, dateTime } from '../shared/ui';
import s from '../styles/App.module.css';
import { Settings } from '../modules/product/Settings';
const Study = lazy(() => import('../modules/strategy/Study').then(module => ({ default: module.Study })));

const PracticeHub = lazy(()=>import('../modules/product/LearningPages').then(m=>({default:m.PracticeHub})));
const PracticeSessionPage = lazy(()=>import('../modules/product/LearningPages').then(m=>({default:m.PracticeSessionPage})));
const Progress = lazy(()=>import('../modules/product/LearningPages').then(m=>({default:m.Progress})));
const Knowledge = lazy(()=>import('../modules/product/Knowledge').then(m=>({default:m.Knowledge})));
const AgentCenter = lazy(()=>import('../modules/product/AgentPanel').then(m=>({default:m.AgentCenter})));
const AgentPanel = lazy(()=>import('../modules/product/AgentPanel').then(m=>({default:m.AgentPanel})));

class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info.componentStack); }
  render() { return this.state.error ? <div className={s.fatal}><h1>工作台遇到了问题</h1><p>已保存的内容仍在本地。你可以刷新页面重试。</p><button onClick={() => location.reload()}>重新载入</button></div> : this.props.children; }
}
function downloadBackup() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(queries.snapshot(), null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'riverline-workspace.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function App() {
  const hydrated = useWorkspace(st => st.hydrated);
  const saveStatus = useWorkspace(st => st.saveStatus);
  const savedAt = useWorkspace(st => st.savedAt);
  const storageError = useWorkspace(st => st.storageError);
  const notice = useWorkspace(st => st.notice);
  const fourColor = useWorkspace(st => st.data.product?.settings.fourColor ?? false);
  const pendingInput = useWorkspace(st => st.pendingInput);
  const hasCases = useWorkspace(st => Object.keys(st.data.cases).length > 0);
  const [about, setAbout] = useState(false);
  const blocker = useBlocker(pendingInput);
  const location = useLocation();
  const [agentOpen,setAgentOpen] = useState(false);
  const activePractice = location.pathname.startsWith('/practice/')?location.pathname.split('/')[2]:undefined;
  const currentCase = location.pathname.startsWith('/study/')?location.pathname.split('/')[2]:undefined;
  const lastPractice = useRef<string|undefined>(undefined);
  useEffect(()=>{if(activePractice)lastPractice.current=activePractice;else if(lastPractice.current&&/^\/(study|knowledge|agent)(\/|$)/.test(location.pathname)){const session=queries.learning(queries.snapshot()).practice(lastPractice.current);if(session?.status==='answering'&&session.mode==='independent')commands.practiceHint(session.id);}},[activePractice,location.pathname]);
  useEffect(() => { void commands.initialize(); }, []);
  useEffect(() => {
    if (!notice || notice.kind === 'error') return;
    const timer = setTimeout(commands.dismissNotice, 5500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (pendingInput || (hasCases && ['saving', 'error', 'memory'].includes(saveStatus))) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [pendingInput, hasCases, saveStatus]);
  const saveLabels = { loading: '正在载入', saving: '正在保存', saved: savedAt ? '已保存到本地' : '本地存储就绪', error: '保存未成功', memory: '仅内存模式' };
  return <ErrorBoundary><div className={s.app} data-four-color={fourColor}>
    <aside className={s.sidebar}>
      <Link to="/" className={s.brand}><img src="/riverline.svg" alt="" /><span>riverline<span className={s.brandSub}>POKER STUDY LAB</span></span></Link>
      <div className={s.workspaceLabel}>个人工作空间<span className={s.localBadge}>LOCAL</span></div>
      <nav className={s.nav} aria-label="主导航">
        <NavLink to="/" end className={({ isActive }) => isActive ? s.navActive : ''}><Icon name="home" />工作台</NavLink>
        <NavLink to="/library" className={({ isActive }) => isActive ? s.navActive : ''}><Icon name="grid" />局面库<span className={s.navCount}>10</span></NavLink>
        <NavLink to="/practice" className={({isActive})=>isActive?s.navActive:''}><Icon name="play"/>训练中心</NavLink>
        <NavLink to="/knowledge" className={({isActive})=>isActive?s.navActive:''}><Icon name="bookmark"/>理论知识</NavLink>
        <NavLink to="/agent" className={({isActive})=>isActive?s.navActive:''}><Icon name="layers"/>Agent 任务</NavLink>
        <NavLink to="/progress" className={({isActive})=>isActive?s.navActive:''}><Icon name="report"/>学习记录</NavLink>
        <NavLink to="/settings" className={({ isActive }) => isActive ? s.navActive : ''}><Icon name="sliders" />演示设置</NavLink>
        <NavLink to="/reports" className={({ isActive }) => isActive ? s.navActive : ''}><Icon name="report" />研究记录</NavLink>
      </nav>
      <div className={s.sidebarHint}><span className={s.eyebrow}>当前探索</span><b>从组合到整个范围</b><p>构建、比较、修订。让每一次行动，都成为完整策略的一部分。</p><Link to="/library">开始一项研究 <Icon name="arrow" size={15} /></Link></div>
      <div className={s.sidebarBottom}><button onClick={() => setAbout(true)}><Icon name="info" />关于这版演示</button><div className={s.localStatus}><span className={saveStatus === 'saved' ? s.greenDot : s.amberDot} />{pendingInput ? '输入尚未应用' : saveLabels[saveStatus]}</div><span className={s.buildLabel}>RIVERLINE · PRODUCT DEMO</span></div>
    </aside>
    <div className={s.mainShell}>
      <header className={s.topbar}><div className={s.breadcrumb}>Riverline <span>/</span> 策略研究工作台</div><div className={s.topbarRight}><button className={s.secondaryButton} onClick={()=>setAgentOpen(true)}>Agent 助手</button><span className={s.demoBadge}><span />本地演示</span><button className={s.iconButton} onClick={downloadBackup} title="导出当前工作区备份" aria-label="导出工作区备份"><Icon name="download" /></button><span className={s.avatar}>R</span></div></header>
      {storageError && <div className={s.storageWarning} role="status"><Icon name="info" />{storageError}<button onClick={downloadBackup}>导出备份</button>{saveStatus === 'error' && <button onClick={commands.retrySave}>重试保存</button>}</div>}
      {hydrated ? <main className={s.main}><Suspense fallback={<div className={s.loading}>正在打开研究视图…</div>}><Routes><Route path="/" element={<Home />} /><Route path="/library" element={<Library />} /><Route path="/study/:caseId" element={<Study />} /><Route path="/reports" element={<Reports />} /><Route path="/settings" element={<Settings/>}/><Route path="/practice" element={<PracticeHub/>}/><Route path="/practice/:sessionId" element={<PracticeSessionPage/>}/><Route path="/progress" element={<Progress/>}/><Route path="/knowledge" element={<Knowledge/>}/><Route path="/agent" element={<AgentCenter/>}/><Route path="*" element={<div className={s.empty}><h1>这个页面还没有建立</h1><Link to="/">回到工作台</Link></div>} /></Routes></Suspense></main> : <div className={s.loading}><span className={s.spinner} />正在打开你的工作空间…</div>}
    </div>
    {notice && <div className={`${s.toast} ${notice.kind === 'error' ? s.errorToast : ''}`} role={notice.kind === 'error' ? 'alert' : 'status'}><Icon name={notice.kind === 'error' ? 'info' : 'check'} /><span>{notice.text}</span><button onClick={commands.dismissNotice} aria-label="关闭提示"><Icon name="close" size={16} /></button></div>}
    {agentOpen&&<Dialog title="Agent 助手与工具轨迹" onClose={()=>setAgentOpen(false)}><Suspense fallback={<div className={s.dialogBody}>正在打开任务…</div>}><AgentPanel caseId={currentCase} practiceId={activePractice} onClose={()=>setAgentOpen(false)}/></Suspense></Dialog>}
    {about && <Dialog title="关于这版演示" onClose={() => setAbout(false)}><div className={s.dialogBody}><span className={s.demoBadge}>D02 · 范围编辑与版本比较</span><p>可以从 Hero 推演进入全范围，筛选、多选、批量混频、锁定、撤销、修订输入权重、提交、比较与建立分支。编辑、版本和本地保存真实工作。</p><p>范围、参考策略与收益数值由作者编写，均为合成示例，没有连接真实 Solver 或 AI 模型。</p><p>当前提供 S01。完整 Agent、连续策略和训练仍在后续轮次；Hero 自定义尺度和混合频率留待完整产品。</p><p className={s.muted}>数据保存在当前浏览器，不能替代独立备份。可以通过右上角导出 JSON。</p><button className={s.primaryButton} onClick={() => setAbout(false)}>了解，继续研究</button></div></Dialog>}
    {blocker.state === 'blocked' && <Dialog title="还有尚未应用的输入" onClose={() => blocker.reset()}><div className={s.dialogBody}><p>频率或权重输入尚未写入草稿。离开会放弃这些输入，已应用并保存的草稿仍保留。</p><div className={s.dialogActions}><button className={s.secondaryButton} onClick={() => blocker.reset()}>继续编辑</button><button className={s.primaryButton} onClick={() => { commands.setPendingInput(false); blocker.proceed(); }}>放弃输入并离开</button></div></div></Dialog>}
  </div></ErrorBoundary>;
}
function useCreateCase() {
  const navigate = useNavigate();
  return () => { const result = commands.createCase(); if (result.ok) navigate('/study/' + result.value + '?view=explore'); };
}
function Home() {
  const cases = useWorkspace(st => st.data.cases);
  const list = Object.values(cases).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const create = useCreateCase();
  const versions = list.reduce((sum, c) => sum + c.versions.length, 0);
  return <div className={s.page}>
    <div className={s.pageHeading}><div><span className={s.eyebrow}>YOUR STUDY SPACE</span><h1>每一手牌，都有一个更大的范围。</h1><p>从具体局面出发，构建属于你的完整策略。</p></div><span className={s.sessionLabel}><span className={s.greenDot} />工作空间已就绪</span></div>
    <section className={s.homeHero}><div className={s.heroCopy}><span className={s.pill}>第一项研究 · S01</span><h2>从一手牌出发，<br />理解整个范围。</h2><p>先选择 Hero，想清行动与后续条件，再对照整套范围策略。无需先手填几百个组合。</p><button className={s.primaryButton} onClick={create}>创建研究案例 <Icon name="arrow" /></button><div className={s.heroFoot}><Icon name="check" size={14} />无需账号<span>·</span>本地保存<span>·</span>合成参考数据</div></div><div className={s.heroScene}><div className={s.sceneHeader}><span>BTN <i>vs</i> BB</span><span className={s.outlineBadge}>SRP · 100 bb</span></div><Board cards={queries.catalogue()[0].board} /><div className={s.scenePot}>底池 <strong>5.5</strong> bb <span>·</span> 行动方 BTN</div><div className={s.sceneActions}><span><i style={{ background: '#79aee8' }} />过牌</span><span><i style={{ background: '#e6ad6b' }} />下注 33%</span><span><i style={{ background: '#b697e4' }} />下注 75%</span></div><div className={s.sceneFooter}>Hero → 同类组合 → 整个范围 <Icon name="layers" size={16} /></div></div></section>
    <div className={s.statGrid}><div><Icon name="grid" /><span>可研究局面</span><strong>01<small>首轮精选</small></strong></div><div><Icon name="layers" /><span>我的研究</span><strong>{String(list.length).padStart(2, '0')}<small>保存在此浏览器</small></strong></div><div><Icon name="bookmark" /><span>已提交策略</span><strong>{String(versions).padStart(2, '0')}<small>独立版本快照</small></strong></div></div>
    <div className={s.sectionHeading}><div><h2>继续研究</h2><p>你的思考与每一次修订，都留在这里。</p></div><Link to="/library">浏览局面库 <Icon name="arrow" size={15} /></Link></div>
    {list.length ? <div className={s.caseGrid}>{list.map(c => <Link className={s.caseCard} to={'/study/' + c.id} key={c.id}><div className={s.cardTopline}><span className={s.pill}>S01 · 范围构建</span><Icon name="arrow" /></div><h3>{c.name}</h3><Board cards={c.spot.board} small /><div className={s.cardBottom}><span>{c.versions.length} 个提交 · 草稿 r{c.draft.editRevision}</span><span>{dateTime(c.updatedAt)}</span></div></Link>)}</div> : <div className={s.emptyCard}><div className={s.emptyIcon}><Icon name="layers" size={25} /></div><h3>你的第一份策略，从这里开始</h3><p>选择一个局面，保存你的思考，再回来继续。</p><button className={s.secondaryButton} onClick={create}>开始第一项研究 <Icon name="arrow" size={16} /></button></div>}
  </div>;
}
function Library() {
  const [search, setSearch] = useState('');
  const [examplePending, setExamplePending] = useState(false);
  const navigate = useNavigate();
  async function openComparison() {
    setExamplePending(true);
    try { const result = await commands.createComparisonExample(); if (result.ok) navigate(`/study/${result.value}?view=history`); }
    finally { setExamplePending(false); }
  }
  const cards = queries.catalogue().filter(c => (c.title + c.subtitle + c.tags.join(' ')).toLowerCase().includes(search.toLowerCase()));
  return <div className={s.page}><div className={s.pageHeading}><div><span className={s.eyebrow}>SCENARIO LIBRARY</span><h1>选择一个值得深入的局面。</h1><p>第一轮从一份清楚、可重播的范围研究开始。</p></div></div><div className={s.libraryToolbar}><label className={s.search}><Icon name="search" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索位置、底池类型或街道" aria-label="搜索局面" /></label><span className={s.outlineBadge}>翻牌 · 现金局</span><span className={s.muted}>{cards.length} 个可用局面</span></div>
    <div className={s.libraryLayout}><div>{cards.length ? cards.map(c => <section className={s.libraryCard} key={c.id}><div className={s.cardTopline}><span className={s.pill}>{c.id} · {c.tags.join(" / ")}</span><span className={s.smallMuted}>合成示例</span></div><div className={s.libraryCardMain}><div><h2>{c.title}</h2><p>{c.subtitle}</p></div><Board cards={c.board} /></div><div className={s.tags}>{c.tags.map(t => <span key={t}>{t}</span>)}</div><p className={s.description}>{c.description}</p><div className={s.libraryCardFoot}><span><Icon name="layers" size={15} />3 种行动 · 组合级编辑</span>{c.id==='S01'&&<button className={s.secondaryButton} disabled={examplePending} onClick={() => void openComparison()}>{examplePending ? '正在建立示例…' : '打开双版本示例'}</button>}<button className={s.primaryButton} onClick={()=>{const result=commands.createScenario(c.id);if(result.ok)navigate(`/study/${result.value}?view=explore`);}}>{c.id==='S01'?'创建研究案例':`打开 ${c.id} 研究`} <Icon name="arrow" size={16} /></button></div></section>) : <div className={s.emptyCard}><h3>没有找到匹配局面</h3><p>试试 BTN、BB、翻牌或 SRP。</p><button className={s.secondaryButton} onClick={() => setSearch('')}>清除搜索</button></div>}</div><aside className={s.guideCard}><span className={s.eyebrow}>HOW TO STUDY</span><h3>把局面变成策略</h3>{[['01', '构建', '为每个组合分配行动，而不只选择一手牌。'], ['02', '比较', '提交后，对照示例参考查看范围结构。'], ['03', '修订', '保留原版本，在新的草稿中继续思考。']].map(([n, title, text]) => <div className={s.guideStep} key={n}><span>{n}</span><div><b>{title}</b><p>{text}</p></div></div>)}<div className={s.guideNote}><Icon name="info" size={16} />参考与数值为演示材料，不是已验证的扑克建议。</div></aside></div></div>;
}
function Reports() {
  const cases = useWorkspace(st => st.data.cases);
  const rows = Object.values(cases).flatMap(c => c.reports.map(r => ({ c, r, v: c.versions.find(v => v.id === r.policyRevisionId)! }))).sort((a, b) => b.r.createdAt.localeCompare(a.r.createdAt));
  return <div className={s.page}><div className={s.pageHeading}><div><span className={s.eyebrow}>RESEARCH RECORDS</span><h1>把每次修订，留成可回看的证据。</h1><p>报告始终引用提交时的局面与策略版本。</p></div><span className={s.outlineBadge}>{rows.length} 份报告</span></div>{rows.length ? <div className={s.recordList}>{rows.map(({ c, r, v }) => <Link className={s.recordRow} to={`/study/${c.id}?view=feedback&version=${v.id}&report=${r.id}`} key={r.id}><div className={s.recordIcon}><Icon name="report" /></div><div><h3>{c.name} <span className={s.versionPill}>V{v.number}</span></h3><p>{dateTime(r.createdAt)} · 合成参考 · {r.difference === null ? '未覆盖的自定义输入' : `频率差异 ${(r.difference * 100).toFixed(1)}%`}</p></div><Board cards={v.spot.board} small /><Icon name="chevron" /></Link>)}</div> : <div className={s.emptyCard}><Icon name="report" size={28} /><h3>还没有研究报告</h3><p>提交一份完整策略并运行模拟分析，报告就会出现在这里。</p><Link className={s.secondaryButton} to="/library">选择局面 <Icon name="arrow" size={16} /></Link></div>}</div>;
}
