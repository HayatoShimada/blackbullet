// Tests may load this module without a syscall host.
if (typeof (globalThis as any).syscall === "undefined") {
  (globalThis as any).syscall = () => {
    throw new Error("Not implemented here");
  };
}

// Late binding syscall
export function syscall(name: string, ...args: any[]): Promise<any> {
  return (globalThis as any).syscall(name, ...args);
}
