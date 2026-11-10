import { gt, isNull, or, type SQL } from "drizzle-orm";
import { files } from "../db/schema";

// A file with no expiresAt stays readable. A timestamp equal to now is already expired.
export function notExpired(now: Date = new Date()): SQL {
  const condition = or(isNull(files.expiresAt), gt(files.expiresAt, now));
  if (condition === undefined) {
    throw new Error("Failed to build expiry condition");
  }
  return condition;
}
