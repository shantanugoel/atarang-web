import { ArrowClockwise } from "@phosphor-icons/react";
import { appVersion } from "../generated/app-version";
import { applyUpdate, useAppUpdate } from "./appUpdate";
import styles from "./UpdateNotice.module.css";

/**
 * One line saying a newer build is installed and waiting.
 *
 * Navigations are network-first, so the shell is never badly stale — but the
 * worker holding the new bundle cannot take over while this tab is open, and
 * nothing said so. Naming the running build is the difference between "there is
 * an update" and something a bug report can quote.
 */
export function UpdateNotice() {
  const waiting = useAppUpdate();
  if (!waiting) return null;
  return <div className={styles.notice} role="status">
    <ArrowClockwise aria-hidden />
    <p><b>A new version of Atarang is ready.</b> This tab is running <code>{appVersion}</code>. Reload when you are not in the middle of something.</p>
    <button className={styles.reload} onClick={() => applyUpdate(waiting)}>Reload</button>
  </div>;
}
