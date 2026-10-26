// AISO and Niches share an account namespace, but never a Worker hostname.
export function validateBrowserTarget(base, write = false) {
  const target = new URL(base);
  const local = ['localhost', '127.0.0.1'].includes(target.hostname);
  const niches = /^niches\.[a-z0-9][a-z0-9-]*\.workers\.dev$/.test(target.hostname);
  if ((!local && !niches) || (!local && target.protocol !== 'https:') || target.username || target.password || target.pathname !== '/' || target.search || target.hash) {
    throw new Error('Only localhost or a dedicated Niches Worker origin is allowed. AISO targets are forbidden.');
  }
  if (write && !local) throw new Error('Disposable browser content writes are restricted to localhost.');
  return { target, local };
}
