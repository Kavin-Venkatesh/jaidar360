// In-process serial queue: events for the same key (tenant + agent phone) run one at a time, in order.
// Swap for Redis/BullMQ when running more than one server instance.
const chains = new Map();

function run(key, task) {
  const previous = chains.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  chains.set(key, next);
  const cleanup = () => {
    if (chains.get(key) === next) chains.delete(key);
  };
  next.then(cleanup, cleanup);
  return next;
}

// Resolves once every queued task has settled (used by tests and graceful shutdown).
async function idle() {
  while (chains.size) await Promise.allSettled([...chains.values()]);
}

module.exports = { run, idle };
