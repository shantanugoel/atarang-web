import { useEffect, useRef } from "react";
import { X } from "@phosphor-icons/react";
import styles from "./ShortcutsSheet.module.css";

/**
 * The keymap, from anywhere.
 *
 * The shortcuts are global — they work on the Library and Settings too — and
 * were written down in one line at the bottom of the Practice panel, which is
 * the one place you have to already be to read them.
 *
 * A native `<dialog>` rather than SeparationSheet's hand-rolled backdrop: modal
 * mode brings the focus trap, focus restore, Escape and `::backdrop` with it, so
 * there is nothing here to keep correct.
 *
 * Kept deliberately to one screen. It describes shortcuts; it is not a place to
 * put settings.
 */
const SHORTCUTS: [keys: string[], action: string][] = [
  [["Space", "K"], "Play or pause"],
  [["J", "L"], "Back or forward 10 seconds"],
  [["I", "O"], "Set loop start or end at the playhead"],
  [["M"], "Metronome click"],
  [["R"], "Record a take"],
  [["?"], "This list"],
];

export function ShortcutsSheet({ onClose }: { onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return (
    // A click on the backdrop reports the dialog itself as the target, which is
    // the only way to tell it apart from a click on the contents.
    <dialog ref={dialog} className={styles.sheet} onClose={onClose} onMouseDown={(event) => { if (event.target === dialog.current) dialog.current?.close(); }} aria-labelledby="shortcuts-title">
      <header>
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <button aria-label="Close keyboard shortcuts" onClick={() => dialog.current?.close()}><X /></button>
      </header>
      <dl className={styles.keys}>
        {SHORTCUTS.map(([keys, action]) => (
          <div key={action}>
            <dt>{keys.map((key) => <kbd key={key}>{key}</kbd>)}</dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
      <footer>They work on every page. Typing in a text field passes them through. Drag the ruler above the waveform to loop a passage.</footer>
    </dialog>
  );
}
