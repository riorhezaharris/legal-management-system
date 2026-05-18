import { KybStatus } from '@prisma/client';
import { evaluateKyb, KybError, VendorSnapshot } from '../services/kyb-policy';

const vendor = (kybStatus: KybStatus, id = 'vendor-1'): VendorSnapshot => ({ id, kybStatus });

const vendorActor = (id = 'vendor-1') => ({ id, supabaseId: 'sb-' + id, email: id + '@example.com', role: 'VENDOR' as const, isActive: true, profileCompleted: true });
const legalActor = (id = 'legal-1') => ({ id, supabaseId: 'sb-' + id, email: id + '@example.com', role: 'LEGAL_TEAM' as const, isActive: true, profileCompleted: true });
const adminActor = (id = 'admin-1') => ({ id, supabaseId: 'sb-' + id, email: id + '@example.com', role: 'IT_ADMIN' as const, isActive: true, profileCompleted: true });
const requestorActor = () => ({ id: 'req-1', supabaseId: 'sb-req-1', email: 'req-1@example.com', role: 'REQUESTOR' as const, isActive: true, profileCompleted: true });

// ─────────────────────────────────────────────────────────────────
// SUBMIT
// ─────────────────────────────────────────────────────────────────

describe('evaluateKyb SUBMIT', () => {
  it('INVITED → SUBMITTED', () => {
    expect(evaluateKyb('SUBMIT', vendorActor(), vendor(KybStatus.INVITED))).toEqual({ toStatus: KybStatus.SUBMITTED });
  });

  it('REVISION → SUBMITTED', () => {
    expect(evaluateKyb('SUBMIT', vendorActor(), vendor(KybStatus.REVISION))).toEqual({ toStatus: KybStatus.SUBMITTED });
  });

  it('APPROVED → SUBMITTED', () => {
    expect(evaluateKyb('SUBMIT', vendorActor(), vendor(KybStatus.APPROVED))).toEqual({ toStatus: KybStatus.SUBMITTED });
  });

  it('SUBMITTED → SUBMITTED throws (invalid transition)', () => {
    expect(() => evaluateKyb('SUBMIT', vendorActor(), vendor(KybStatus.SUBMITTED))).toThrow(KybError);
    expect(() => evaluateKyb('SUBMIT', vendorActor(), vendor(KybStatus.SUBMITTED))).toThrow(/SUBMITTED/);
  });

  it('throws Forbidden when vendor submits for another vendor', () => {
    const err = (() => { try { evaluateKyb('SUBMIT', vendorActor('vendor-2'), vendor(KybStatus.INVITED, 'vendor-1')); } catch (e) { return e; } })() as KybError;
    expect(err).toBeInstanceOf(KybError);
    expect(err.statusCode).toBe(403);
  });

  it('throws 403 for LEGAL_TEAM role', () => {
    const err = (() => { try { evaluateKyb('SUBMIT', legalActor(), vendor(KybStatus.INVITED)); } catch (e) { return e; } })() as KybError;
    expect(err).toBeInstanceOf(KybError);
    expect(err.statusCode).toBe(403);
  });

  it('throws 403 for IT_ADMIN role', () => {
    const err = (() => { try { evaluateKyb('SUBMIT', adminActor(), vendor(KybStatus.INVITED)); } catch (e) { return e; } })() as KybError;
    expect(err).toBeInstanceOf(KybError);
    expect(err.statusCode).toBe(403);
  });

  it('throws 403 for REQUESTOR role', () => {
    const err = (() => { try { evaluateKyb('SUBMIT', requestorActor(), vendor(KybStatus.INVITED)); } catch (e) { return e; } })() as KybError;
    expect(err).toBeInstanceOf(KybError);
    expect(err.statusCode).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────
// REQUEST_REVISION
// ─────────────────────────────────────────────────────────────────

describe('evaluateKyb REQUEST_REVISION', () => {
  it('SUBMITTED → REVISION', () => {
    expect(
      evaluateKyb('REQUEST_REVISION', legalActor(), vendor(KybStatus.SUBMITTED), { remarks: 'Please fix KTP' })
    ).toEqual({ toStatus: KybStatus.REVISION });
  });

  it('throws when remarks is missing', () => {
    expect(() =>
      evaluateKyb('REQUEST_REVISION', legalActor(), vendor(KybStatus.SUBMITTED))
    ).toThrow(/remarks/i);
  });

  it('throws when remarks is blank', () => {
    expect(() =>
      evaluateKyb('REQUEST_REVISION', legalActor(), vendor(KybStatus.SUBMITTED), { remarks: '   ' })
    ).toThrow(/remarks/i);
  });

  it('INVITED → REVISION throws (invalid transition)', () => {
    expect(() =>
      evaluateKyb('REQUEST_REVISION', legalActor(), vendor(KybStatus.INVITED), { remarks: 'r' })
    ).toThrow(/INVITED/);
  });

  it('REVISION → REVISION throws (invalid transition)', () => {
    expect(() =>
      evaluateKyb('REQUEST_REVISION', legalActor(), vendor(KybStatus.REVISION), { remarks: 'r' })
    ).toThrow(/REVISION/);
  });

  it('APPROVED → REVISION throws (invalid transition)', () => {
    expect(() =>
      evaluateKyb('REQUEST_REVISION', legalActor(), vendor(KybStatus.APPROVED), { remarks: 'r' })
    ).toThrow(/APPROVED/);
  });

  it('throws 403 for VENDOR role', () => {
    const err = (() => { try { evaluateKyb('REQUEST_REVISION', vendorActor(), vendor(KybStatus.SUBMITTED), { remarks: 'r' }); } catch (e) { return e; } })() as KybError;
    expect(err).toBeInstanceOf(KybError);
    expect(err.statusCode).toBe(403);
  });

  it('throws 403 for IT_ADMIN role', () => {
    const err = (() => { try { evaluateKyb('REQUEST_REVISION', adminActor(), vendor(KybStatus.SUBMITTED), { remarks: 'r' }); } catch (e) { return e; } })() as KybError;
    expect(err).toBeInstanceOf(KybError);
    expect(err.statusCode).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────
// APPROVE
// ─────────────────────────────────────────────────────────────────

describe('evaluateKyb APPROVE', () => {
  it('SUBMITTED → APPROVED', () => {
    expect(evaluateKyb('APPROVE', legalActor(), vendor(KybStatus.SUBMITTED))).toEqual({ toStatus: KybStatus.APPROVED });
  });

  it('INVITED → APPROVED throws (invalid transition)', () => {
    expect(() => evaluateKyb('APPROVE', legalActor(), vendor(KybStatus.INVITED))).toThrow(/INVITED/);
  });

  it('REVISION → APPROVED throws (invalid transition)', () => {
    expect(() => evaluateKyb('APPROVE', legalActor(), vendor(KybStatus.REVISION))).toThrow(/REVISION/);
  });

  it('APPROVED → APPROVED throws (invalid transition)', () => {
    expect(() => evaluateKyb('APPROVE', legalActor(), vendor(KybStatus.APPROVED))).toThrow(/APPROVED/);
  });

  it('throws 403 for VENDOR role', () => {
    const err = (() => { try { evaluateKyb('APPROVE', vendorActor(), vendor(KybStatus.SUBMITTED)); } catch (e) { return e; } })() as KybError;
    expect(err).toBeInstanceOf(KybError);
    expect(err.statusCode).toBe(403);
  });

  it('throws 403 for IT_ADMIN role', () => {
    const err = (() => { try { evaluateKyb('APPROVE', adminActor(), vendor(KybStatus.SUBMITTED)); } catch (e) { return e; } })() as KybError;
    expect(err).toBeInstanceOf(KybError);
    expect(err.statusCode).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────
// RESET
// ─────────────────────────────────────────────────────────────────

describe('evaluateKyb RESET', () => {
  it('SUBMITTED → INVITED', () => {
    expect(evaluateKyb('RESET', adminActor(), vendor(KybStatus.SUBMITTED))).toEqual({ toStatus: KybStatus.INVITED });
  });

  it('APPROVED → INVITED', () => {
    expect(evaluateKyb('RESET', adminActor(), vendor(KybStatus.APPROVED))).toEqual({ toStatus: KybStatus.INVITED });
  });

  it('REVISION → INVITED', () => {
    expect(evaluateKyb('RESET', adminActor(), vendor(KybStatus.REVISION))).toEqual({ toStatus: KybStatus.INVITED });
  });

  it('INVITED → INVITED (no-op, allowed per policy)', () => {
    expect(evaluateKyb('RESET', adminActor(), vendor(KybStatus.INVITED))).toEqual({ toStatus: KybStatus.INVITED });
  });

  it('throws 403 for LEGAL_TEAM role', () => {
    const err = (() => { try { evaluateKyb('RESET', legalActor(), vendor(KybStatus.SUBMITTED)); } catch (e) { return e; } })() as KybError;
    expect(err).toBeInstanceOf(KybError);
    expect(err.statusCode).toBe(403);
  });

  it('throws 403 for VENDOR role', () => {
    const err = (() => { try { evaluateKyb('RESET', vendorActor(), vendor(KybStatus.SUBMITTED)); } catch (e) { return e; } })() as KybError;
    expect(err).toBeInstanceOf(KybError);
    expect(err.statusCode).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────
// Unknown action
// ─────────────────────────────────────────────────────────────────

describe('evaluateKyb unknown action', () => {
  it('throws KybError for unknown action', () => {
    expect(() =>
      evaluateKyb('NONEXISTENT' as any, adminActor(), vendor(KybStatus.SUBMITTED))
    ).toThrow(KybError);
  });
});
