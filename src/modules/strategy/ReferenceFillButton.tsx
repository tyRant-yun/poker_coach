import { useState } from 'react';
import { commands, queries } from '../../app/workspace';
import type { StudyCase } from '../study/domain';
import { Dialog, Icon } from '../../shared/ui';
import s from '../../styles/App.module.css';

export function ReferenceFillButton({ c, jobId, onComplete }: { c: StudyCase; jobId: string; onComplete?: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const job = c.jobs.find(j => j.id === jobId);
  const compatible = job?.spotRevisionId === c.spotRevisionId;
  const missing = queries.stats(c).missing;
  return <>
    <div className={s.referenceFill}>
      <div><b>只调整你关心的部分</b><p>已有行动保留，其余 {missing} 个未填写组合可以用参考辅助补全。</p></div>
      <button className={s.secondaryButton} disabled={!compatible || !missing} onClick={() => setConfirm(true)}>
        <Icon name="layers" size={15} />用参考补全未填写组合
      </button>
      {!compatible && <p className={s.muted}>这是历史局面的参考，不能用于当前草稿。</p>}
    </div>
    {confirm && <Dialog title="用参考辅助补全范围" onClose={() => setConfirm(false)}>
      <div className={s.dialogBody}>
        <p>将当前草稿中 {missing} 个未填写组合设为这份示例参考。你已经填写的 Hero 或其他组合保持不变。</p>
        <p>草稿会标记为“参考辅助”。补全不会自动提交，也不代表你已独立掌握整个范围。</p>
        <div className={s.dialogActions}>
          <button className={s.secondaryButton} onClick={() => setConfirm(false)}>暂不补全</button>
          <button className={s.primaryButton} onClick={() => {
            const result = commands.fillFromReference(c.id, jobId, c.draft.editRevision);
            if (result.ok) { setConfirm(false); onComplete?.(); }
          }}>确认辅助补全</button>
        </div>
      </div>
    </Dialog>}
  </>;
}
