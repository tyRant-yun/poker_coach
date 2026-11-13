import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { callAnalysis, connectAnalysis } from "./client";
import {
  projectAuthorityExposure,
  hasAuthorityExposure,
} from "../../shared/authorityExposure";
import s from "../../styles/App.module.css";
function registeredNotice() {
  if (!hasAuthorityExposure()) return null;
  return (
    <div
      role="note"
      style={{ padding: "8px 20px", background: "#142c38", color: "#d7e5ec" }}
    >
      原版 Demo 保留。进入 S1
      后的相关旧版作答按可能暴露/辅助处理；历史首次记录保持原意。
    </div>
  );
}
export function LegacyGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false),
    [blocked, setBlocked] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true,
      registered = false,
      inFlight = false;
    const check = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const c = await connectAnalysis();
        const state = await callAnalysis<{
          independent?: unknown;
          totalSituations: number;
          attempts: unknown[];
          exposures: number;
        }>(c, "workspace_get");
        if (!alive) return;
        if (state.data.independent) {
          setReady(false);
          setBlocked(true);
          return;
        }
        const active =
          state.data.totalSituations > 0 ||
          state.data.attempts.length > 0 ||
          state.data.exposures > 0;
        if (active && !registered) {
          await callAnalysis(c, "teaching_record_exposure", {
            expectedRevision: state.revision,
          });
          registered = true;
        }
        projectAuthorityExposure(active);
        if (alive) {
          setBlocked(false);
          setError("");
          setReady(true);
        }
      } catch (e) {
        if (alive) {
          setReady(false);
          setError(String(e));
        }
      } finally {
        inFlight = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  if (ready)
    return (
      <>
        {registeredNotice()}
        {children}
      </>
    );
  return (
    <section className={s.fatal}>
      <h1>{blocked ? "S1 独立题仍在进行" : "正在核对本地工作区的信息边界"}</h1>
      <p>
        {blocked
          ? "旧版课程、复盘和研究也可能包含答案。请先完成固定作答，或明确登记辅助身份后阅读。"
          : "本地服务失联时不会绕过允许信息规则。"}
        {error}
      </p>
      <a className={s.primaryButton} href="/solver">
        回到 S1 分析与作答
      </a>
      {blocked && (
        <button
          className={s.secondaryButton}
          onClick={async () => {
            try {
              const c = await connectAnalysis(),
                state = await callAnalysis(c, "workspace_get");
              await callAnalysis(c, "teaching_reveal", {
                expectedRevision: state.revision,
              });
              setBlocked(false);
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          登记辅助并阅读旧版
        </button>
      )}
    </section>
  );
}
