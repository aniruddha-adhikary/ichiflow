import type { NumberAllocationContract } from "./types.js";

export interface AllocationRecord {
  key: string;
  contractId: string;
  value: number;
  referenceNumber: string;
}

export interface VoidRecord {
  contractId: string;
  value: number;
  reason: string;
}

export class NumberAllocator {
  private readonly next = new Map<string, number>();
  private readonly memo = new Map<string, AllocationRecord>();
  private readonly voids: VoidRecord[] = [];

  allocate(caseId: string, stepId: string, contract: NumberAllocationContract): AllocationRecord {
    const key = `${caseId}\u0000${stepId}`;
    const prior = this.memo.get(key);
    if (prior) return prior;
    const value = this.next.get(contract.id) ?? contract.startsAt;
    this.next.set(contract.id, value + 1);
    const record = {
      key,
      contractId: contract.id,
      value,
      referenceNumber: `${contract.prefix}${String(value).padStart(contract.width, "0")}`,
    };
    this.memo.set(key, record);
    return record;
  }

  voidNext(contract: NumberAllocationContract, reason: string): VoidRecord {
    const value = this.next.get(contract.id) ?? contract.startsAt;
    this.next.set(contract.id, value + 1);
    const record = { contractId: contract.id, value, reason };
    this.voids.push(record);
    return record;
  }

  allocations(): AllocationRecord[] {
    return [...this.memo.values()];
  }

  voidLedger(): VoidRecord[] {
    return [...this.voids];
  }
}
