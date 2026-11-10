import { MAX_EXPIRY_HOURS } from "@transfile/shared";

const HOUR_MS = 60 * 60 * 1000;

export function addHours(from: Date, hours: number): Date {
  return new Date(from.getTime() + hours * HOUR_MS);
}

export function hardCap(createdAt: Date): Date {
  return addHours(createdAt, MAX_EXPIRY_HOURS);
}

export function cappedExpiry(createdAt: Date, requested: Date): Date {
  const cap = hardCap(createdAt);
  return requested.getTime() > cap.getTime() ? cap : requested;
}
