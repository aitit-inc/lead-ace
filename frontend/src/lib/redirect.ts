// Allow only same-origin paths in `?next=...` query parameters to prevent
// open-redirect abuse. Reject protocol-relative `//evil.com`, backslash
// variants, and any absolute URLs.
export function isSafeRelativePath(p: string): boolean {
  if (!p.startsWith('/')) return false;
  if (p.startsWith('//')) return false;
  if (p.startsWith('/\\')) return false;
  return true;
}
