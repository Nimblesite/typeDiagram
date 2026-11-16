// [WEB-EDITOR-ZOOM] Ctrl+wheel zoom for the editor pane.
// Scales font size on the textarea + backdrop. Persists to localStorage.

const STORAGE_KEY = "typediagram-editor-zoom";
const MIN_SIZE = 8;
const MAX_SIZE = 32;
const DEFAULT_SIZE = 13;
const STEP = 1;

const clamp = (v: number): number => (v < MIN_SIZE ? MIN_SIZE : v > MAX_SIZE ? MAX_SIZE : v);

const load = (): number => {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored !== null && stored !== "" ? clamp(parseFloat(stored)) : DEFAULT_SIZE;
};

const save = (size: number) => {
  localStorage.setItem(STORAGE_KEY, String(size));
};

export const initEditorZoom = (editorWrap: HTMLElement, textarea: HTMLTextAreaElement, backdrop: HTMLElement) => {
  let fontSize = load();

  const apply = () => {
    const val = `${String(fontSize)}px`;
    textarea.style.fontSize = val;
    backdrop.style.fontSize = val;
  };

  apply();

  editorWrap.addEventListener(
    "wheel",
    (e) => {
      const hasModifier = e.ctrlKey || e.metaKey;
      if (!hasModifier) {
        return;
      }
      e.preventDefault();
      const delta = e.deltaY > 0 ? -STEP : STEP;
      fontSize = clamp(fontSize + delta);
      apply();
      save(fontSize);
    },
    { passive: false }
  );
};
