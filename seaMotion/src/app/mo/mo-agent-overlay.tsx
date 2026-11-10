import * as React from "react";

import styles from "./mo-agent-overlay.module.css";

export type AgentView = Readonly<{ kind: "error" | "saved" | "working"; message: string; percent: number }>;

const RADIUS = 25;
const LENGTH = 2 * Math.PI * RADIUS;

type Place = Readonly<{ box: Readonly<{ height: number; left: number; top: number; width: number }> | null; x: number; y: number }>;

// Where the artboard is on screen: the dark layer covers it and the card sits on its centre (the middle of the window,
// with no dark layer, when it cannot be found).
function artboardPlace(): Place {
  const canvas = document.querySelector<HTMLElement>('[data-slot="toolcraft-runtime-app"] canvas');
  const rect = canvas?.getBoundingClientRect();
  if (!rect || rect.width < 40 || rect.height < 40) return { box: null, x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const x = Math.min(window.innerWidth - 140, Math.max(140, rect.left + rect.width / 2));
  const y = Math.min(window.innerHeight - 90, Math.max(90, rect.top + rect.height / 2));
  return { box: { height: rect.height, left: rect.left, top: rect.top, width: rect.width }, x, y };
}

// A number that moves smoothly to `target`: it eases toward it (about 0.6 s for a step, a little faster for big ones,
// never slower than 12% a second), restarting from 0 each time the card opens.
function useCountUp(target: number, active: boolean): number {
  const [value, setValue] = React.useState(0);
  const valueRef = React.useRef(0);
  const targetRef = React.useRef(target);
  targetRef.current = target;
  React.useEffect(() => {
    if (!active) {
      valueRef.current = 0;
      setValue(0);
      return undefined;
    }
    let frame = 0;
    let last = performance.now();
    const step = (now: number): void => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const goal = targetRef.current;
      const current = valueRef.current;
      if (Math.abs(goal - current) > 0.05) {
        const eased = (goal - current) * (1 - Math.exp(-dt * 5));
        const floor = Math.sign(goal - current) * Math.min(Math.abs(goal - current), 12 * dt);
        const next = current + (Math.abs(eased) > Math.abs(floor) ? eased : floor);
        valueRef.current = next;
        setValue(next);
      } else if (current !== goal) {
        valueRef.current = goal;
        setValue(goal);
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [active]);
  return value;
}

// Over the artboard while an agent works on the open project: progress 0-100%, what it is doing, then "Saved as version".
export function MoAgentOverlay({ view }: Readonly<{ view: AgentView | null }>): React.ReactNode {
  const [shown, setShown] = React.useState<AgentView | null>(view);
  const [leaving, setLeaving] = React.useState(false);
  const [at, setAt] = React.useState<Place>(() => artboardPlace());
  React.useEffect(() => {
    if (view) {
      setShown(view);
      setLeaving(false);
      setAt(artboardPlace());
      return undefined;
    }
    setLeaving(true);
    const timer = window.setTimeout(() => setShown(null), 340);
    return () => window.clearTimeout(timer);
  }, [view]);
  // The shown number counts toward the reported one (from 0 when the card appears, to 100 when the work is saved); the
  // check appears only once it has reached 100.
  const target = shown ? Math.max(0, Math.min(100, shown.kind === "working" ? shown.percent : 100)) : 0;
  const counted = useCountUp(shown ? target : 0, shown !== null);
  if (!shown) return null;
  const percent = Math.round(counted);
  const done = shown.kind === "saved" && counted >= 99.5;
  return (
    <>
      {at.box ? <div aria-hidden="true" className={styles.scrim} data-leaving={leaving || undefined} style={at.box} /> : null}
      <div
      aria-live="polite"
      className={styles.card}
      data-leaving={leaving || undefined}
      data-mo-agent={shown.kind}
      role="status"
      style={{ left: at.x, top: at.y }}
    >
      <div className={styles.ring}>
        {done ? null : <span className={styles.halo} />}
        <svg className={styles.progress} viewBox="0 0 58 58">
          <circle className={styles.track} cx="29" cy="29" r={RADIUS} />
          <circle className={styles.bar} cx="29" cy="29" r={RADIUS} strokeDasharray={LENGTH} strokeDashoffset={LENGTH * (1 - counted / 100)} />
        </svg>
        {done ? (
          <span className={styles.check}>
            <svg height="22" viewBox="0 0 22 22" width="22">
              <path d="M5 11.5l4 4 8-9" />
            </svg>
          </span>
        ) : (
          <>
            {shown.kind === "working" ? <span className={styles.orbit} /> : null}
            <span className={styles.percent}>{percent}%</span>
          </>
        )}
      </div>
      <p className={styles.label}>{done ? "Done" : shown.kind === "error" ? "Could not apply" : shown.kind === "saved" ? "Saving" : "Agent working"}</p>
      <p className={shown.kind === "error" ? styles.messageError : styles.message}>{shown.kind === "saved" && !done ? "Saving as a new version…" : shown.message}</p>
      </div>
    </>
  );
}
