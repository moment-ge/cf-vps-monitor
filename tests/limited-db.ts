// Miniflare does not enforce the production Free plan query budget.
export function limitedDatabase(db: D1Database) {
  let count = 0;
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  function charge(amount: number) {
    count += amount;
    if (count > 50) throw new Error(`Free D1 query budget exceeded: ${count}`);
  }
  function wrap(statement: D1PreparedStatement): D1PreparedStatement {
    const wrapped = new Proxy(statement, {
      get(target, property) {
        if (property === "bind")
          return (...args: unknown[]) => wrap(target.bind(...args));
        const value = Reflect.get(target, property);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          charge(1);
          return value.apply(target, args);
        };
      },
    });
    originals.set(wrapped, statement);
    return wrapped;
  }
  return {
    count: () => count,
    db: new Proxy(db, {
      get(target, property) {
        if (property === "prepare")
          return (sql: string) => wrap(target.prepare(sql));
        if (property === "batch")
          return (statements: D1PreparedStatement[]) => {
            charge(statements.length);
            return target.batch(statements.map((s) => originals.get(s) ?? s));
          };
        return Reflect.get(target, property);
      },
    }),
  };
}
