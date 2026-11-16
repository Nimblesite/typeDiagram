// [WEB-DEBOUNCE] Trailing-edge debounce.
export const debounce = <A extends readonly unknown[]>(
  fn: (...args: A) => void,
  ms: number
): ((...args: A) => void) => {
  let t: ReturnType<typeof setTimeout> | null = null;
  return (...args: A) => {
    if (t !== null) {
      clearTimeout(t);
    }
    t = setTimeout(() => {
      fn(...args);
    }, ms);
  };
};
