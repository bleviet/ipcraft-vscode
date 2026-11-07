/** Disjoint sets over the integers `0..size-1`; the smallest member is the root of its set. */
export class UnionFind {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index: number): number {
    let root = index;
    while (this.parent[root] !== root) {
      root = this.parent[root];
    }
    this.parent[index] = root;
    return root;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) {
      this.parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
    }
  }
}
