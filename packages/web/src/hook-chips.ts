// [WEB-HOOK-CHIPS] Toggle-chip UI bound to the PRESETS list. Tracks selected
// preset ids, renders chips into a container, and calls onChange when the
// selection mutates.
import { PRESETS, type PresetDef, type PresetId } from "./hook-presets.js";

export interface HookChipsHandle {
  readonly container: HTMLElement;
  readonly selected: () => ReadonlyArray<PresetDef>;
  readonly setSelected: (ids: ReadonlyArray<PresetId>) => void;
}

export const createHookChips = (onChange: (selected: ReadonlyArray<PresetDef>) => void): HookChipsHandle => {
  const container = document.createElement("div");
  container.className = "hook-chips";
  container.setAttribute("role", "group");
  container.setAttribute("aria-label", "render hook presets");
  const chipOf = new Map<PresetId, HTMLButtonElement>();
  const state = new Set<PresetId>();

  const select = (): ReadonlyArray<PresetDef> => PRESETS.filter((p) => state.has(p.id));

  const notify = () => {
    onChange(select());
  };

  const renderChip = (def: PresetDef) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hook-chip";
    btn.textContent = def.label;
    btn.title = def.blurb;
    btn.dataset.presetId = def.id;
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", () => {
      if (state.has(def.id)) {
        state.delete(def.id);
      } else {
        state.add(def.id);
      }
      sync();
      notify();
    });
    chipOf.set(def.id, btn);
    container.appendChild(btn);
  };

  const sync = () => {
    for (const [id, btn] of chipOf) {
      const on = state.has(id);
      btn.classList.toggle("hook-chip--on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
  };

  for (const p of PRESETS) {
    renderChip(p);
  }

  return {
    container,
    selected: select,
    setSelected: (ids) => {
      state.clear();
      for (const id of ids) {
        state.add(id);
      }
      sync();
      notify();
    },
  };
};
