import { RequestType } from '@prisma/client';

const VENDOR_REQUIRED_TYPES = new Set<RequestType>([RequestType.PERJANJIAN_BARU, RequestType.ADENDUM]);

export function vendorRequired(type: RequestType): boolean {
  return VENDOR_REQUIRED_TYPES.has(type);
}
