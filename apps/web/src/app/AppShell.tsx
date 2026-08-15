import { GearSix, FolderOpen, MusicNotesSimple } from "@phosphor-icons/react";
import { matchPath, NavLink, Outlet, useLocation } from "react-router";
import {useEffect} from "react";
import {runIntegrityScan} from "../storage/integrity";
import {StorageNotice} from "./StorageNotice";
import {UpdateNotice} from "./UpdateNotice";
import {NowPlayingBar} from "./NowPlayingBar";
import {PlaybackSessionProvider,usePlaybackSession} from "../features/studio/PlaybackSession";
import {DEMO_TRACK} from "../features/studio/useDemoAudio";
import styles from "./AppShell.module.css";

/**
 * The header, inside the session so its Studio links carry the open song.
 *
 * A bare `/studio` is how the bundled demo is reached, so a nav link pointing
 * there unloaded whatever was playing and started the demo instead — the exact
 * thing the session above the router exists to prevent.
 */
function TopBar() {
  const { pathname } = useLocation();
  const { original } = usePlaybackSession();
  const studio = original ? `/studio/${original.id}` : "/studio";
  const navigation = [
    { to: studio, label: "Studio" },
    { to: "/library", label: "Library" },
    { to: "/settings", label: "Settings" },
  ];
  return (
    <header className={styles.topbar}>
      <NavLink to={studio} className={styles.brand} aria-label="Atarang Studio home">
        <MusicNotesSimple weight="fill" aria-hidden />
        <span>Atarang</span>
      </NavLink>
      <nav aria-label="Primary navigation" className={styles.nav}>
        {navigation.map((item) => (
          <NavLink key={item.label} to={item.to} className={({ isActive }) => isActive ? styles.active : ""}>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className={styles.actions}>
        {pathname.startsWith("/studio") && <NavLink to="/library" className="icon-button" aria-label="Open another song"><FolderOpen aria-hidden /></NavLink>}
        <NavLink to="/settings" className="icon-button" aria-label="Settings"><GearSix aria-hidden /></NavLink>
      </div>
    </header>
  );
}

function PageTitle(){
  const{pathname}=useLocation(),{original}=usePlaybackSession(),path=pathname.replace(/\/$/,""),studio=matchPath("/studio/:songId?",path);
  const page=path==="/library"?"Library":path==="/settings"?"Settings":studio?(original?.title??(original===undefined?"Studio":studio.params.songId?"Song not found":DEMO_TRACK.title)):"Page not found";
  useEffect(()=>{document.title=`${page} — Atarang`},[page]);
  return null;
}

export function AppShell() {
  useEffect(()=>{void runIntegrityScan()},[]);
  const { pathname } = useLocation();
  const inStudio = pathname.startsWith("/studio");

  return (
    <PlaybackSessionProvider><PageTitle/><div className={styles.shell}>
      <TopBar />
      <UpdateNotice />
      <StorageNotice />
      <main className={styles.main}>
        <Outlet />
      </main>
      {/* In the Studio the transport is this bar with a waveform on top of it. */}
      {!inStudio && <NowPlayingBar />}
    </div></PlaybackSessionProvider>
  );
}
