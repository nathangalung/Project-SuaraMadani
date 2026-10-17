import { type ClassValue, clsx } from "clsx"

// No merging, see class-conflicts.test
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs)
}
