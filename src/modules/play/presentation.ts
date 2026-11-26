import { useEffect, useRef, useState } from "react";
import { gameCall } from "./client";
import type { FramePage, HandView, PublicFrame } from "./domain";

export type PlaybackSpeed = "comfort" | "fast" | "instant";
export class PlaybackClock {
  private timer?: ReturnType<typeof setTimeout>;
  private finish?: (active: boolean) => void;
  wait(ms: number) {
    return new Promise<boolean>((resolve) => {
      this.finish = resolve;
      this.timer = setTimeout(() => {
        this.finish = undefined;
        resolve(true);
      }, ms);
    });
  }
  cancel() {
    clearTimeout(this.timer);
    this.finish?.(false);
    this.finish = undefined;
  }
}
export function frameDelay(
  frame: Pick<PublicFrame, "kind">,
  speed: PlaybackSpeed,
) {
  if (speed === "instant") return 0;
  const base =
    frame.kind === "hand-closed"
      ? 1250
      : frame.kind === "board-dealt"
        ? 1000
        : frame.kind === "player-acted"
          ? 750
          : frame.kind === "ready"
            ? 0
            : 650;
  return speed === "fast" ? Math.round(base * 0.3) : base;
}
export function usePlayback(onError: (message: string) => void) {
  const [frame, setFrame] = useState<PublicFrame>(),
    [thinking, setThinking] = useState<number>(),
    [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState<PlaybackSpeed>(() => {
    try {
      const v = localStorage.getItem("riverline-play-speed");
      return v === "fast" || v === "instant" ? v : "comfort";
    } catch {
      return "comfort";
    }
  });
  const clock = useRef(new PlaybackClock()),
    generation = useRef(0),
    speedRef = useRef(speed),
    alive = useRef(true),
    publish = useRef<(() => void) | undefined>(undefined);
  const cancel = (commit = true) => {
    if (commit) publish.current?.();
    publish.current = undefined;
    generation.current++;
    clock.current.cancel();
    setPlaying(false);
    setFrame(undefined);
    setThinking(undefined);
  };
  const setSpeed = (value: PlaybackSpeed) => {
    speedRef.current = value;
    setSpeedState(value);
    try {
      localStorage.setItem("riverline-play-speed", value);
    } catch {}
    if (value === "instant") cancel();
  };
  useEffect(() => {
    alive.current = true;
    const hidden = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      alive.current = false;
      generation.current++;
      clock.current.cancel();
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  const play = async (hand: HandView, onTarget: () => void) => {
    cancel(false);
    if (!hand.transition || speedRef.current === "instant" || document.hidden) {
      onTarget();
      return;
    }
    publish.current = onTarget;
    const ticket = generation.current;
    setPlaying(true);
    let offset = 0;
    const seen = new Set<string>();
    try {
      const read = (offset: number) =>
        gameCall<FramePage>("game_transition_query", {
          handId: hand.id,
          handRevision: hand.revision,
          batchId: hand.transition!.batchId,
          offset,
          limit: 16,
        });
      const prefetch = (offset: number) =>
        read(offset).then(
          (page) => ({ page, error: undefined }),
          (error) => ({ page: undefined, error }),
        );
      let pending = prefetch(0);
      while (alive.current && generation.current === ticket) {
        const response = await pending;
        if (response.error) throw response.error;
        const page = response.page!;
        if (!alive.current || generation.current !== ticket) return;
        if (
          page.batchId !== hand.transition.batchId ||
          page.revision !== hand.revision
        )
          throw Error("动作帧与当前手牌版本不一致");
        if (publish.current) {
          setFrame(page.items[0]);
          publish.current();
          publish.current = undefined;
        }
        if (page.nextOffset !== null) pending = prefetch(page.nextOffset);
        for (const item of page.items) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          if (
            item.kind === "player-acted" &&
            item.actor !== hand.hero &&
            item.actor !== null
          ) {
            setThinking(item.actor);
            if (
              !(await clock.current.wait(
                speedRef.current === "comfort" ? 400 : 100,
              ))
            )
              return;
          }
          if (!alive.current || generation.current !== ticket) return;
          setThinking(undefined);
          setFrame(item);
          if (!(await clock.current.wait(frameDelay(item, speedRef.current))))
            return;
        }
        if (page.nextOffset === null) break;
        if (page.nextOffset <= offset) throw Error("动作帧游标未推进");
        offset = page.nextOffset;
      }
    } catch (e) {
      if (alive.current && generation.current === ticket)
        onError(
          `${e instanceof Error ? e.message : "播放中断"}；已回到保存的当前回合。`,
        );
    } finally {
      if (alive.current && generation.current === ticket) {
        publish.current?.();
        publish.current = undefined;
        setFrame(undefined);
        setThinking(undefined);
        setPlaying(false);
      }
    }
  };
  return { frame, thinking, playing, speed, setSpeed, play, cancel };
}
