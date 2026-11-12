import { useEffect, useRef, useState } from 'react';
import { commands, queries } from '../../app/workspace';
import { actions, activeCombos, handByCombo, handClasses } from '../study/domain';
import type { Action, Allocation, HeroPlanInput, StudyCase } from '../study/domain';
import { Board, Dialog, Icon, dateTime, percent } from '../../shared/ui';
import { ReferenceRange } from './ReferenceRange';
import { ReferenceFillButton } from './ReferenceFillButton';
import s from '../../styles/App.module.css';

const responseLabels = { call: '跟注', raise: '加注', fold: '弃牌', reassess: '按牌面与尺寸再评估' };
const branchLabels = { call: '翻牌：BB 跟注', raise: '翻牌：BB 加注', fold: '翻牌：BB 弃牌', 'turn-bet': '转牌：BB 下注', 'turn-check': '转牌：BB 过牌' };

export function HeroStudy({ c, onRange }: { c: StudyCase; onRange: (label: string) => void }) {
  const latest = queries.latestHeroPlan(c);
  const active = activeCombos(c.spot, queries.weights('BTN', c));
  const defaultCombo = active.find(combo => handByCombo[combo] === 'AKs') ?? active[0] ?? '';
  const [combo, setCombo] = useState(latest?.combo ?? defaultCombo);
  const [action, setAction] = useState<Action | null>(latest?.action ?? null);
  const [branch, setBranch] = useState<HeroPlanInput['opponentBranch']>(latest?.opponentBranch ?? 'turn-bet');
  const [response, setResponse] = useState<HeroPlanInput['response']>(latest?.response ?? 'reassess');
  const [turnPlan, setTurnPlan] = useState(latest?.turnPlan ?? '');
  const [reason, setReason] = useState(latest?.reason ?? '');
  const [extend, setExtend] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setCombo(latest?.combo ?? defaultCombo); setAction(latest?.action ?? null);
    setBranch(latest?.opponentBranch ?? 'turn-bet'); setResponse(latest?.response ?? 'reassess');
    setTurnPlan(latest?.turnPlan ?? ''); setReason(latest?.reason ?? '');
  }, [c.id, c.spotRevisionId, latest?.id, defaultCombo]);

  const label = handByCombo[combo];
  const classes = handClasses.filter(h => h.combos.some(token => active.includes(token)));
  const candidates = active.filter(token => handByCombo[token] === label);
  const refJob = queries.latestReference(c);
  const currentJob = c.jobs.filter(j => j.policyRevisionId === null && j.spotRevisionId === c.spotRevisionId).at(-1);
  const running = !!currentJob && ['queued', 'running'].includes(currentJob.status);
  const reference = refJob?.result?.reference;
  const refAllocation = reference?.[combo];
  const stats = queries.stats(c);
  const input: HeroPlanInput | null = action ? { combo, action, opponentBranch: branch, response, turnPlan, reason } : null;
  const matchesSaved = !!latest && !!input && latest.combo === combo && latest.action === action && latest.opponentBranch === branch
    && latest.response === response && latest.reason === reason && latest.turnPlan === turnPlan;
  const preview: Allocation | null = action ? { check: action === 'check' ? 10000 : 0, bet33: action === 'bet33' ? 10000 : 0, bet75: action === 'bet75' ? 10000 : 0 } : null;

  function chooseCombo(next: string) {
    setCombo(next); setAction(null); setBranch('turn-bet'); setResponse('reassess'); setTurnPlan(''); setReason('');
  }
  function chooseAction(next: Action) {
    setAction(next); setBranch(next === 'check' ? 'turn-bet' : 'call'); setResponse('reassess');
  }
  function requestReference() {
    void commands.requestReference(c.id).then(result => {
      if (result.ok) requestAnimationFrame(() => {
        resultRef.current?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        resultRef.current?.focus({ preventScroll: true });
      });
    });
  }
  const branchOptions: HeroPlanInput['opponentBranch'][] = action === 'check' ? ['turn-bet', 'turn-check'] : ['call', 'raise', 'fold'];
  const needsResponse = branch === 'raise' || branch === 'turn-bet';
  return <div className={s.heroStudy}>
    <div className={s.heroIntro}>
      <div><span className={s.eyebrow}>HAND → HAND CLASS → RANGE</span><h2>从一手牌开始，把行动放回整个范围。</h2><p>先选 Hero、想清当前行动和后续条件，再用完整参考连接同类组合。不必先填完几百个组合。</p></div>
      <span className={s.pill}>推荐入口</span>
    </div>
    <div className={s.heroLayout}>
      <section className={s.heroHandCard}>
        <div className={s.fieldHeading}><b>1. 设置 Hero 手牌</b><span>BTN · IP</span></div>
        {combo && <div className={s.heroCards}><Board cards={[combo.slice(0, 2), combo.slice(2)]} /><span>{label}</span></div>}
        <label className={s.formField}>Hero 牌类<select aria-label="Hero 牌类" value={label ?? ''} onChange={e => chooseCombo(active.find(token => handByCombo[token] === e.target.value)!)}>
          {classes.map(h => <option key={h.label} value={h.label}>{h.label}</option>)}
        </select></label>
        <label className={s.formField}>具体组合<select aria-label="Hero 具体组合" value={combo} onChange={e => chooseCombo(e.target.value)}>
          {candidates.map(token => <option key={token} value={token}>{token.slice(0, 2)} / {token.slice(2)}</option>)}
        </select></label>
        <div className={s.heroRangeFact}><Icon name="layers" size={16} /><p>Hero 属于 {label}，该牌类有 {candidates.length} 个可用组合。Hero 是观察焦点，整个输入范围仍保留。</p></div>
        <button className={s.textButton} onClick={() => onRange(label)}>在范围草稿中定位 {label}<Icon name="arrow" size={14} /></button>
        <div className={s.heroCoverage}><b>范围草稿：{stats.filled} / {stats.combos.length}</b><p>保存 Hero 推演不计为全范围完成。</p></div>
      </section>
      <section className={s.heroPlanCard}>
        <div className={s.panelHeader}><div><h2>2. 构建这手牌的行动线</h2><p>当前事实：BB 已在翻牌过牌，轮到 Hero。</p></div><span className={s.outlineBadge}>研究草稿</span></div>
        <div className={s.heroActionChoices} role="group" aria-label="Hero 翻牌行动">
          {actions.map(a => <button key={a.id} aria-pressed={action === a.id} className={action === a.id ? s.heroActionSelected : ''} onClick={() => chooseAction(a.id)}><i style={{ background: a.color }} />{a.name}</button>)}
        </div>
        {action && <>
          {action === 'check' && <p className={s.heroStreetNote}>Hero 也过牌后，本轮结束。接下来思考的是转牌上 BB 的行动。</p>}
          <div className={s.formColumns}>
            <label className={s.formField}>对手后续假设<select aria-label="对手后续假设" value={branch} onChange={e => { setBranch(e.target.value as HeroPlanInput['opponentBranch']); setResponse('reassess'); }}>
              {branchOptions.map(b => <option value={b} key={b}>{branchLabels[b]}</option>)}
            </select></label>
            <label className={s.formField}>Hero 后续计划<select aria-label="Hero 后续计划" value={response} disabled={!needsResponse} onChange={e => setResponse(e.target.value as HeroPlanInput['response'])}>
              <option value="reassess">按牌面与尺寸再评估</option>
              {needsResponse && <><option value="call">计划跟注</option><option value="raise">计划加注</option><option value="fold">计划弃牌</option></>}
            </select></label>
          </div>
          <div className={s.heroLine} aria-label="Hero 行动线预览">
            <span>翻牌：Hero {actions.find(a => a.id === action)!.name}</span><Icon name="chevron" size={14} />
            <span>{branchLabels[branch]}</span><Icon name="chevron" size={14} />
            <span>{branch === 'fold' ? '手牌结束' : needsResponse ? `Hero：${responseLabels[response]}` : '进入转牌再评估'}</span>
          </div>
        </>}
        <label className={s.formField}>为什么这样行动？<textarea aria-label="Hero 行动理由" rows={2} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} placeholder="先写下自己的判断，再查看参考。" /></label>
        <label className={s.formField}>后续牌面与行动条件<textarea aria-label="Hero 转牌计划" rows={2} maxLength={2000} value={turnPlan} onChange={e => setTurnPlan(e.target.value)} placeholder="哪些转牌、下注尺寸或对手反应，会让你改变计划？" disabled={!!action && branch === 'fold'} /></label>
        <div className={s.heroPlanFoot}><p>后续分支是你的研究假设，尚无多街求解或合法尺寸验证。</p><button className={s.primaryButton} disabled={!input} onClick={() => { if (input) commands.saveHeroPlan(c.id, input, c.spotRevisionId); }}>保存 Hero 推演<Icon name="check" size={15} /></button></div>
        {latest && <div className={s.heroSaved}><Icon name="check" size={14} />{matchesSaved ? '当前推演已保存' : '当前有未保存修改'} · {dateTime(latest.createdAt)}</div>}
      </section>
    </div>
    <section className={s.heroBridge}>
      <div><h3>3. 从 Hero 连接到范围</h3><p>先保存推演，再明确选择扩展的范围。手牌相同类别，不代表所有花色组合应该采用相同策略。</p></div>
      <div className={s.heroBridgeActions}>
        <button className={s.secondaryButton} disabled={!matchesSaved} onClick={() => { if (latest) commands.applyHeroAction(c.id, latest.id, 'hero', c.draft.editRevision); }}>仅将 Hero 行动写入范围草稿</button>
        <button className={s.secondaryButton} disabled={!matchesSaved} onClick={() => setExtend(true)}>扩展到 {candidates.length} 个同牌类组合…</button>
      </div>
    </section>
    <div className={s.heroReferenceRequest}>
      <div><span className={s.eyebrow}>SEE THE BIG PICTURE</span><h2>4. 看整套策略，而不只看一个百分比</h2><p>模拟只需要当前局面和输入范围，无需先完成范围作答。</p></div>
      {running ? <button className={s.secondaryButton} onClick={() => commands.cancelJob(c.id, currentJob.id)}><span className={s.spinner} />取消参考模拟</button> : <button className={s.primaryButton} onClick={requestReference}><Icon name="play" size={15} />{reference ? '重新运行范围参考' : '查看全范围模拟策略'}</button>}
    </div>
    {running && <p className={s.muted} role="status">{currentJob.stage}；推演与范围草稿不会被自动改写。</p>}
    <div ref={resultRef} className={s.heroResults} role="region" aria-label="Hero 对照与全范围参考" tabIndex={-1}>
    {reference && refJob && <>
      {refAllocation && <div className={s.heroReferenceSummary}><Board cards={[combo.slice(0, 2), combo.slice(2)]} small /><div><b>Hero 在参考中的位置</b><p>{actions.map(a => `${a.name} ${percent(refAllocation[a.id] / 10000)}`).join(' · ')}</p></div><span className={s.pill}>合成示例</span></div>}
      <ReferenceRange spot={c.spot} reference={reference} weights={queries.weights('BTN', c)} heroCombo={combo}
        userChoices={preview ? { [combo]: preview } : {}} userLabel="Hero 当前想法" />
      <ReferenceFillButton c={c} jobId={refJob.id} onComplete={() => onRange(label)} />
    </>}
    {!running && currentJob?.status === 'completed' && currentJob.result?.availability === 'uncovered' && <div className={s.uncoveredBox}><Icon name="info" /><div><h3>当前条件没有全范围示例参考</h3><p>{currentJob.result.reason}</p></div></div>}
    </div>
    {extend && latest && <Dialog title="将 Hero 行动扩展到同牌类" onClose={() => setExtend(false)}><div className={s.dialogBody}>
      <p>将“{actions.find(a => a.id === latest.action)!.name}”以 100% 分配给 {label} 的 {candidates.length} 个组合：</p><p><code>{candidates.join('、')}</code></p>
      <p>这会覆盖这些组合已有的分配，其他组合不变。它是你主动选择的概括，不是 Solver 对同类组合的推荐。</p>
      <div className={s.dialogActions}><button className={s.secondaryButton} onClick={() => setExtend(false)}>暂不扩展</button><button className={s.primaryButton} onClick={() => {
        const result = commands.applyHeroAction(c.id, latest.id, 'class', c.draft.editRevision);
        if (result.ok) setExtend(false);
      }}>确认扩展这 {candidates.length} 个组合</button></div>
    </div></Dialog>}
  </div>;
}
