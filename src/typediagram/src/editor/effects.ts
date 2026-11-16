// [EDITOR-EFFECTS] Explicit conditional effects without statement-level conditionals.
export const runWhen = (condition: boolean, effect: () => void) => {
  switch (condition) {
    case true:
      effect();
      break;
    default:
      break;
  }
};

export const runWhenDefined = <T>(value: T | undefined, effect: (current: T) => void) => {
  switch (value) {
    case undefined:
      break;
    default:
      effect(value);
  }
};
