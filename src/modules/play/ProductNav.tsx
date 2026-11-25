import { NavLink } from "react-router-dom";
import s from "./Play.module.css";
export function ProductNav() {
  return (
    <header className={s.nav}>
      <a className={s.brand} href="/play">
        riverline
      </a>
      <nav aria-label="主导航">
        <NavLink to="/play">练习</NavLink>
        <NavLink to="/hands">复盘</NavLink>
        <NavLink to="/solver/real">研究</NavLink>
      </nav>
      <details>
        <summary>更多</summary>
        <div>
          <a href="/learn">课程与示例</a>
          <a href="/legacy">历史工作台</a>
        </div>
      </details>
    </header>
  );
}
