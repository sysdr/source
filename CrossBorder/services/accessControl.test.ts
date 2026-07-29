import { describe, expect, it } from 'vitest';
import {
  claimWriterSession,
  heartbeatWriterSession,
  isWriterSessionActive,
  releaseWriterSession,
  WRITER_HEARTBEAT_TTL_MS,
} from './sessionWriter';
import {
  ACCOUNTANT_INVITE_TTL_MS,
  activateAccountantInvite,
  createAccountantInvite,
  validateAccountantInvite,
} from './accountantInvite';

describe('sessionWriter (REQ-070 / T-032)', () => {
  it('claims a free writer lock', () => {
    const result = claimWriterSession(null, 'sess-a', { nowMs: 1_000_000 });
    expect(result.status).toBe('claimed');
    expect(result.writer?.sessionId).toBe('sess-a');
  });

  it('detects concurrent session conflict', () => {
    const first = claimWriterSession(null, 'sess-a', { nowMs: 1_000_000 });
    const second = claimWriterSession(first.writer, 'sess-b', { nowMs: 1_000_000 + 60_000 });
    expect(second.status).toBe('conflict');
    expect(second.warning).toMatch(/Concurrent session/i);
  });

  it('allows reclaim after TTL expiry', () => {
    const first = claimWriterSession(null, 'sess-a', { nowMs: 1_000_000 });
    const later = claimWriterSession(first.writer, 'sess-b', {
      nowMs: 1_000_000 + WRITER_HEARTBEAT_TTL_MS + 1,
    });
    expect(later.status).toBe('claimed');
    expect(later.writer?.sessionId).toBe('sess-b');
  });

  it('renews heartbeat for same session', () => {
    const claimed = claimWriterSession(null, 'sess-a', { nowMs: 1_000_000 });
    const beat = heartbeatWriterSession(claimed.writer, 'sess-a', { nowMs: 1_060_000 });
    expect(beat.status).toBe('renewed');
    expect(isWriterSessionActive(beat.writer, 1_060_000)).toBe(true);
  });

  it('releases writer session', () => {
    const claimed = claimWriterSession(null, 'sess-a');
    const released = releaseWriterSession(claimed.writer, 'sess-a');
    expect(released.writer).toBeNull();
  });
});

describe('accountantInvite (REQ-073 / T-033)', () => {
  it('creates invite with 72h expiry', () => {
    const invite = createAccountantInvite({
      id: 'i1',
      token: 'tok',
      orgId: 'org',
      email: 'ca@firm.com',
      nowMs: 1_000_000,
    });
    expect(new Date(invite.expiresAt).getTime() - 1_000_000).toBe(ACCOUNTANT_INVITE_TTL_MS);
    expect(invite.status).toBe('pending');
  });

  it('rejects expired invite', () => {
    const invite = createAccountantInvite({
      id: 'i1', token: 'tok', orgId: 'org', email: 'ca@firm.com', nowMs: 1_000_000,
    });
    const v = validateAccountantInvite(invite, 1_000_000 + ACCOUNTANT_INVITE_TTL_MS + 1);
    expect(v.ok).toBe(false);
    if (v.ok === false) expect(v.status).toBe('expired');
  });

  it('activates valid invite', () => {
    const invite = createAccountantInvite({
      id: 'i1', token: 'tok', orgId: 'org', email: 'ca@firm.com', nowMs: 1_000_000,
    });
    const active = activateAccountantInvite(invite, 1_100_000);
    expect(active.status).toBe('active');
    expect(validateAccountantInvite(active, 1_100_000).ok).toBe(true);
  });
});
