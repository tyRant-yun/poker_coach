let active = 0;
export function takeNativeQuerySlot() {
  if (active >= 2) throw Error("RESOURCE_LIMIT: 原生查询槽已满，请稍后重试");
  active++;
  let released = false;
  return () => {
    if (!released) {
      active--;
      released = true;
    }
  };
}
