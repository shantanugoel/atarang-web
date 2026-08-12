import { GearSix, FolderOpen, MusicNotesSimple } from "@phosphor-icons/react";
import { NavLink, Outlet, useLocation } from "react-router";
import {useEffect} from "react";
import {runIntegrityScan} from "../storage/integrity";
import styles from "./AppShell.module.css";

const navigation = [
  { to: "/studio", label: "Studio" },
  { to: "/library", label: "Library" },
  { to: "/settings", label: "Settings" },
];

export function AppShell() {
  useEffect(()=>{void runIntegrityScan()},[]);
  const { pathname } = useLocation();
  const inStudio = pathname.startsWith("/studio");

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <NavLink to="/studio" className={styles.brand} aria-label="Atarang Studio home">
          <MusicNotesSimple weight="fill" aria-hidden />
          <span>Atarang</span>
        </NavLink>
        <nav aria-label="Primary navigation" className={styles.nav}>
          {navigation.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? styles.active : ""}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.actions}>
          {inStudio && <NavLink to="/library" className="icon-button" aria-label="Open another song"><FolderOpen aria-hidden /></NavLink>}
          <NavLink to="/settings" className="icon-button" aria-label="Settings"><GearSix aria-hidden /></NavLink>
        </div>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
