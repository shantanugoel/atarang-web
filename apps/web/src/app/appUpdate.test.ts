import { describe, expect, test } from "bun:test";
import { watchForUpdate } from "./appUpdate";

type Listeners = Record<string, Array<() => void>>;
const emitter = () => {
  const listeners: Listeners = {};
  return {
    listeners,
    addEventListener: (type: string, handler: () => void) => { (listeners[type] ??= []).push(handler); },
    removeEventListener: (type: string, handler: () => void) => { listeners[type] = (listeners[type] ?? []).filter((item) => item !== handler); },
    emit: (type: string) => { for (const handler of [...(listeners[type] ?? [])]) handler(); },
  };
};

function harness({ controlled = true, waiting = false }: { controlled?: boolean; waiting?: boolean } = {}) {
  const registrationEvents = emitter();
  const workerEvents = emitter();
  const installing = { ...workerEvents, state: "installing" } as unknown as ServiceWorker & { state: string };
  const registration = {
    ...registrationEvents,
    installing: null as unknown as ServiceWorker | null,
    waiting: waiting ? ({ state: "installed" } as ServiceWorker) : null,
    update: async () => {},
  };
  const container = {
    controller: controlled ? {} : null,
    getRegistration: async () => registration as unknown as ServiceWorkerRegistration,
  } as unknown as ServiceWorkerContainer;
  const seen: ServiceWorker[] = [];
  return { container, registration, registrationEvents, workerEvents, installing, seen, start: () => watchForUpdate((worker) => seen.push(worker), container) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("watchForUpdate", () => {
  test("reports a build that is already waiting", async () => {
    const h = harness({ waiting: true });
    h.start();
    await settle();
    expect(h.seen).toHaveLength(1);
  });

  test("reports one that finishes installing while the tab is open", async () => {
    const h = harness();
    h.start();
    await settle();
    expect(h.seen).toHaveLength(0);
    h.registration.installing = h.installing;
    h.registrationEvents.emit("updatefound");
    // Still downloading: nothing to offer yet.
    h.workerEvents.emit("statechange");
    expect(h.seen).toHaveLength(0);
    h.installing.state = "installed";
    h.workerEvents.emit("statechange");
    expect(h.seen).toEqual([h.installing]);
  });

  test("says nothing on a first install, where there is no older build", async () => {
    const h = harness({ controlled: false, waiting: true });
    h.start();
    await settle();
    h.registration.installing = h.installing;
    h.registrationEvents.emit("updatefound");
    h.installing.state = "installed";
    h.workerEvents.emit("statechange");
    expect(h.seen).toHaveLength(0);
  });

  test("stops listening when it is torn down", async () => {
    const h = harness();
    const stop = h.start();
    await settle();
    h.registration.installing = h.installing;
    h.registrationEvents.emit("updatefound");
    stop();
    h.installing.state = "installed";
    h.workerEvents.emit("statechange");
    h.registrationEvents.emit("updatefound");
    expect(h.seen).toHaveLength(0);
    expect(h.registrationEvents.listeners.updatefound).toHaveLength(0);
  });

  test("does nothing where service workers are unavailable", () => {
    expect(() => watchForUpdate(() => {}, undefined)()).not.toThrow();
  });
});
