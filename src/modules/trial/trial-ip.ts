import type { Request } from 'express';

function normalize(value: string) {
  return value.trim().replace(/^::ffff:/, '').slice(0, 64);
}

function isPrivate(ip: string) {
  const host = normalize(ip);
  return (
    host === '::1' ||
    host === '127.0.0.1' ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  );
}

export function clientIp(request: Request) {
  const socket = normalize(request.socket?.remoteAddress ?? request.ip ?? '');
  const hinted = normalize(String(request.headers['x-venueflow-client-ip'] ?? ''));
  if (socket && isPrivate(socket) && hinted) return hinted;
  const forwarded = String(request.headers['x-forwarded-for'] ?? '')
    .split(',')
    .map((part) => normalize(part))
    .filter(Boolean);
  if (socket && isPrivate(socket) && forwarded.length) return forwarded[forwarded.length - 1];
  return socket || 'unknown';
}
