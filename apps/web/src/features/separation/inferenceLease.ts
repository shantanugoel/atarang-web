let active = false;

export async function withLocalInferenceLease<T>(task: () => Promise<T>): Promise<T> {
  const locks = navigator.locks;
  if (locks) {
    return locks.request("atarang:local-inference", { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (!lock) throw new Error("local_inference_busy");
      return task();
    });
  }
  if (active) throw new Error("local_inference_busy");
  active = true;
  try {
    return await task();
  } finally {
    active = false;
  }
}
