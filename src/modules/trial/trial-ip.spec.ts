import type { Request } from 'express';
import { clientIp } from './trial-ip';

function request(partial: Partial<Request> & { headers?: Record<string, string> }): Request {
  return partial as Request;
}

describe('trial client ip', () => {
  it('uses the public socket address and ignores a spoofed hint', () => {
    expect(clientIp(request({
      ip: '203.0.113.8',
      socket: { remoteAddress: '203.0.113.8' } as Request['socket'],
      headers: { 'x-venueflow-client-ip': '198.51.100.2' },
    }))).toBe('203.0.113.8');
  });

  it('trusts the dashboard hint when the caller is on a private network', () => {
    expect(clientIp(request({
      ip: '172.18.0.4',
      socket: { remoteAddress: '172.18.0.4' } as Request['socket'],
      headers: { 'x-venueflow-client-ip': '203.0.113.9' },
    }))).toBe('203.0.113.9');
  });
});
