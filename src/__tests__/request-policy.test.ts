import { RequestType } from '@prisma/client';
import { vendorRequired } from '../services/request-policy';

describe('vendorRequired', () => {
  it('returns true for PERJANJIAN_BARU', () => {
    expect(vendorRequired(RequestType.PERJANJIAN_BARU)).toBe(true);
  });

  it('returns true for ADENDUM', () => {
    expect(vendorRequired(RequestType.ADENDUM)).toBe(true);
  });

  it('returns false for SURAT', () => {
    expect(vendorRequired(RequestType.SURAT)).toBe(false);
  });

  it('returns false for PERMINTAAN_DOKUMEN', () => {
    expect(vendorRequired(RequestType.PERMINTAAN_DOKUMEN)).toBe(false);
  });
});
