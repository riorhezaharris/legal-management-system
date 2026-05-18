import { KybStatus, Role } from '@prisma/client';
import { AuthUser } from '../middleware/auth';

export type KybAction = 'SUBMIT' | 'REQUEST_REVISION' | 'APPROVE' | 'RESET';

export interface KybOptions {
  remarks?: string;
}

export class KybError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'KybError';
  }
}

export interface VendorSnapshot {
  id: string;
  kybStatus: KybStatus;
}

export function evaluateKyb(
  action: KybAction,
  actor: AuthUser,
  vendor: VendorSnapshot,
  options: KybOptions = {},
): { toStatus: KybStatus } {
  switch (action) {
    case 'SUBMIT': {
      if (actor.role !== Role.VENDOR) {
        throw new KybError('Only VENDOR can SUBMIT KYB', 403);
      }
      if (actor.id !== vendor.id) {
        throw new KybError('Forbidden', 403);
      }
      const allowedFromStatuses: KybStatus[] = [KybStatus.INVITED, KybStatus.REVISION, KybStatus.APPROVED];
      if (!allowedFromStatuses.includes(vendor.kybStatus)) {
        throw new KybError(`Cannot submit KYB from status ${vendor.kybStatus}`);
      }
      return { toStatus: KybStatus.SUBMITTED };
    }

    case 'REQUEST_REVISION': {
      if (actor.role !== Role.LEGAL_TEAM) {
        throw new KybError('Only LEGAL_TEAM can REQUEST_REVISION', 403);
      }
      if (!options.remarks?.trim()) {
        throw new KybError('remarks is required');
      }
      if (vendor.kybStatus !== KybStatus.SUBMITTED) {
        throw new KybError(`Cannot request revision from status ${vendor.kybStatus}`);
      }
      return { toStatus: KybStatus.REVISION };
    }

    case 'APPROVE': {
      if (actor.role !== Role.LEGAL_TEAM) {
        throw new KybError('Only LEGAL_TEAM can APPROVE KYB', 403);
      }
      if (vendor.kybStatus !== KybStatus.SUBMITTED) {
        throw new KybError(`Cannot approve from status ${vendor.kybStatus}`);
      }
      return { toStatus: KybStatus.APPROVED };
    }

    case 'RESET': {
      if (actor.role !== Role.IT_ADMIN) {
        throw new KybError('Only IT_ADMIN can RESET KYB', 403);
      }
      return { toStatus: KybStatus.INVITED };
    }

    default:
      throw new KybError(`Unknown KYB action: ${action as string}`);
  }
}
