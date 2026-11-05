// Post 1: transactions, ACID and isolation.
import { commitTradeoff, crashRecovery } from "../crash.mjs";

const accounts = [
  "CREATE TABLE accounts (id int PRIMARY KEY, owner text, balance int NOT NULL CHECK (balance >= 0))",
  "INSERT INTO accounts VALUES (1, 'Ana', 500), (2, 'Ben', 100)",
];
const sales = [
  "CREATE TABLE sales (id serial PRIMARY KEY, product text, quantity int, price int)",
  "INSERT INTO sales (product, quantity, price) VALUES ('Phone', 2, 100), ('Case', 3, 10), ('Phone', 1, 100)",
];
const doctors = [
  "CREATE TABLE doctors (name text PRIMARY KEY, on_call boolean NOT NULL)",
  "INSERT INTO doctors VALUES ('Adam', true), ('Bob', true)",
];

const REPORT_TOTAL = "SELECT sum(quantity * price) AS revenue FROM sales";
const levels = (title) => [
  { label: "Read committed", vars: { level: "READ COMMITTED" } },
  { label: "Repeatable read", vars: { level: "REPEATABLE READ" } },
  { label: "Serializable", vars: { level: "SERIALIZABLE" } },
].map((v) => ({ ...v, label: title ? `${title}: ${v.label}` : v.label }));

const spec = {
  theaters: {
    atomicity: {
      title: "A transfer that dies halfway",
      alt: "A recorded run on PostgreSQL. Session A starts a transfer and takes 100 from Ana, then the second update fails a check constraint. The transaction is aborted, and a rollback leaves both balances as they began. A third connection sees 500 and 100 at every step.",
      sessions: ["A"],
      tableName: "accounts",
      setup: accounts,
      observe: "SELECT id, owner, balance FROM accounts ORDER BY id",
      steps: [
        ["A", "BEGIN", "The transaction opens. Nothing has changed yet."],
        ["A", "UPDATE accounts SET balance = balance - 100 WHERE id = 1", "Ana's balance drops by 100 inside this transaction. A third connection still sees 500, because nothing is committed."],
        ["A", "UPDATE accounts SET balance = balance - 200 WHERE id = 2", "This update would take Ben below zero. The CHECK constraint rejects it, so the statement fails."],
        ["A", "SELECT balance FROM accounts WHERE id = 1", "Postgres won't run anything else now. After one failure the whole transaction is aborted, so the only useful command left is ROLLBACK."],
        ["A", "COMMIT", "Even COMMIT can't save it: Postgres answers ROLLBACK. Ana's 100 comes back and the row was never visibly changed. That's atomicity working."],
      ],
    },

    exit: {
      title: "Walking away from an open transaction",
      alt: "A recorded run on PostgreSQL. Session one begins a transaction, takes 10 phones out of inventory and sees 90, then disconnects without committing. A new connection reads the inventory and finds 100, because the unfinished transaction was rolled back.",
      sessions: ["A", "A, reconnected"],
      tableName: "products",
      setup: [
        "CREATE TABLE products (pid serial PRIMARY KEY, name text, price float, inventory int)",
        "INSERT INTO products (name, price, inventory) VALUES ('Phone', 999.99, 100)",
      ],
      observe: "SELECT name, inventory FROM products",
      steps: [
        ["A", "BEGIN", "The transaction starts."],
        ["A", "UPDATE products SET inventory = inventory - 10", "Ten phones leave the inventory."],
        ["A", "SELECT name, inventory FROM products", "Inside the transaction the change is real: 90."],
        ["A", "\\q", "The client quits without COMMIT. To the server, an open transaction on a closed connection is an abandoned one."],
        ["A, reconnected", "SELECT name, inventory FROM products", "A new connection finds 100. The unfinished work is gone, which is atomicity doing its job."],
      ],
    },

    dirty: {
      title: "Can a report see uncommitted work?",
      alt: "A recorded run on PostgreSQL at read uncommitted. Session A changes a quantity without committing. Session B, asking for read uncommitted, still reads the old committed total, because PostgreSQL treats that level as read committed.",
      sessions: ["A", "B"],
      tableName: "sales",
      setup: sales,
      observe: "SELECT id, product, quantity, price FROM sales ORDER BY id",
      steps: [
        ["B", "BEGIN TRANSACTION ISOLATION LEVEL READ UNCOMMITTED", "Session B asks for the weakest level the SQL standard defines."],
        ["B", REPORT_TOTAL, "The real total."],
        ["A", "BEGIN", "Session A starts a change."],
        ["A", "UPDATE sales SET quantity = 5 WHERE id = 1", "Session A raises a quantity but hasn't committed. A dirty read would now show B a total that may never be real."],
        ["B", REPORT_TOTAL, "B still gets the committed total. Postgres accepts READ UNCOMMITTED but runs it as READ COMMITTED, so a dirty read can't happen here at all."],
        ["A", "ROLLBACK", "Session A changes its mind. Any reader that had seen its number would now be holding a value that never existed."],
        ["B", "COMMIT", "Done."],
      ],
    },

    "dirty-mysql": {
      engine: "mysql",
      title: "The same run on MySQL",
      alt: "A recorded run on MySQL at read uncommitted. Session A changes a quantity without committing, session B's total rises to the uncommitted value, then session A rolls back and B's next total drops again. B saw a dirty read of a value that never existed.",
      sessions: ["A", "B"],
      tableName: "sales",
      setup: [
        "CREATE TABLE sales (id int AUTO_INCREMENT PRIMARY KEY, product text, quantity int, price int)",
        "INSERT INTO sales (product, quantity, price) VALUES ('Phone', 2, 100), ('Case', 3, 10), ('Phone', 1, 100)",
      ],
      steps: [
        ["B", "SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED", "MySQL really implements this level."],
        ["B", "START TRANSACTION", "Session B opens a transaction."],
        ["B", REPORT_TOTAL, "The real total."],
        ["A", "START TRANSACTION", "Session A starts a change."],
        ["A", "UPDATE sales SET quantity = 5 WHERE id = 1", "Session A raises a quantity but hasn't committed."],
        ["B", REPORT_TOTAL, "Here is the dirty read: B's total includes a change nobody has committed."],
        ["A", "ROLLBACK", "Session A rolls back. The number B just read never existed."],
        ["B", REPORT_TOTAL, "B's total falls back. If B had printed the earlier figure on a report, the report would be wrong for good."],
        ["B", "COMMIT", "Done."],
      ],
    },

    "non-repeatable": {
      title: "Two reads inside one transaction",
      alt: "A recorded run on PostgreSQL with one tab per isolation level. Session B reads a total, session A commits a change, and B reads again. At read committed the second read differs from the first. At repeatable read and serializable it matches.",
      sessions: ["A", "B"],
      tableName: "sales",
      setup: sales,
      observe: "SELECT id, product, quantity, price FROM sales ORDER BY id",
      variants: levels().map((v) => ({
        ...v,
        summary:
          v.label === "Read committed"
            ? "The report's two reads disagree: each statement got its own fresh snapshot."
            : "Both reads agree, because the whole transaction reads from one snapshot.",
      })),
      steps: [
        ["B", "BEGIN TRANSACTION ISOLATION LEVEL {level}", "Session B starts a report at {level}."],
        ["B", "SELECT product, sum(quantity * price) AS revenue FROM sales GROUP BY product ORDER BY product", "The first read: revenue per product, which adds up to 330."],
        ["A", "UPDATE sales SET quantity = quantity + 5 WHERE id = 1", "Session A commits a change between B's two reads. Outside a transaction block, a statement commits at once."],
        ["B", REPORT_TOTAL, "The second read, in the same transaction, for the report footer. Does it still add up to 330?"],
        ["B", "COMMIT", "The report ends."],
      ],
    },

    phantom: {
      title: "A new row appears mid-report",
      alt: "A recorded run on PostgreSQL with one tab per isolation level. Session B counts phone sales, session A inserts and commits a new one, and B counts again. At read committed the count rises from 2 to 3. At repeatable read and serializable it stays at 2.",
      sessions: ["A", "B"],
      tableName: "sales",
      setup: sales,
      observe: "SELECT id, product, quantity, price FROM sales ORDER BY id",
      variants: levels().map((v) => ({
        ...v,
        summary:
          v.label === "Read committed"
            ? "The second count includes a row that didn't exist for the first: a phantom."
            : "No phantom. The SQL standard allows one at repeatable read, but Postgres goes further because the level is a snapshot.",
      })),
      steps: [
        ["B", "BEGIN TRANSACTION ISOLATION LEVEL {level}", "Session B starts counting at {level}."],
        ["B", "SELECT count(*) FROM sales WHERE product = 'Phone'", "Two phone sales."],
        ["A", "INSERT INTO sales (product, quantity, price) VALUES ('Phone', 1, 100)", "Session A inserts a matching row and commits it. No existing row changed, so locks on the rows B read wouldn't have stopped this."],
        ["B", "SELECT count(*) FROM sales WHERE product = 'Phone'", "Session B counts again."],
        ["B", "COMMIT", "Done."],
      ],
    },

    "phantom-mysql": {
      engine: "mysql",
      title: "The phantom on MySQL",
      alt: "A recorded run on MySQL at repeatable read. Session B counts two phone sales, session A inserts a third and commits. B's plain count stays at two, but a locking read in the same transaction sees three, because locking reads look at the latest committed rows.",
      sessions: ["A", "B"],
      tableName: "sales",
      setup: [
        "CREATE TABLE sales (id int AUTO_INCREMENT PRIMARY KEY, product varchar(20), quantity int, price int, KEY (product))",
        "INSERT INTO sales (product, quantity, price) VALUES ('Phone', 2, 100), ('Case', 3, 10), ('Phone', 1, 100)",
      ],
      steps: [
        ["B", "START TRANSACTION", "MySQL's default is REPEATABLE READ."],
        ["B", "SELECT count(*) AS phones FROM sales WHERE product = 'Phone'", "Two phone sales, read from a snapshot."],
        ["A", "INSERT INTO sales (product, quantity, price) VALUES ('Phone', 1, 100)", "Session A inserts and commits a third."],
        ["B", "SELECT count(*) AS phones FROM sales WHERE product = 'Phone'", "A plain read still says two: it uses the same snapshot, so there's no phantom."],
        ["B", "SELECT count(*) AS phones FROM sales WHERE product = 'Phone' FOR SHARE", "A locking read isn't a snapshot read. It looks at the latest committed rows, and the third phone appears inside the same transaction."],
        ["B", "UPDATE sales SET price = 90 WHERE product = 'Phone'", "An UPDATE works on the latest rows too. It reports three rows changed, one of which this transaction's snapshot says doesn't exist."],
        ["B", "SELECT count(*) AS phones FROM sales WHERE product = 'Phone'", "Now the plain read says three: a transaction always sees its own changes, so the updated phantom joins the snapshot."],
        ["B", "COMMIT", "Done. This is the behaviour behind the claim that MySQL's repeatable read isn't the same as Postgres's."],
      ],
    },

    "lost-update": {
      title: "Two people update the same stock count",
      alt: "A recorded run on PostgreSQL with tabs for read committed and repeatable read. Both sessions read 10 phones in stock and each wants to sell some. At read committed the second write waits, then overwrites, and one sale is lost. At repeatable read the second write fails with a serialization error and has to retry.",
      sessions: ["A", "B"],
      tableName: "stock",
      setup: ["CREATE TABLE stock (item text PRIMARY KEY, units int)", "INSERT INTO stock VALUES ('Phone', 10)"],
      observe: "SELECT item, units FROM stock",
      variants: [
        { label: "Read committed", vars: { level: "READ COMMITTED" }, summary: "Two sales of 3 and 2 should leave 5 units. The table says 8, so session A's sale vanished without an error. That's a lost update." },
        {
          label: "Repeatable read",
          vars: { level: "REPEATABLE READ" },
          summary: "Session B can't overwrite a row that changed after its snapshot. It gets an error, retries from a fresh read, and the count comes out right.",
          extra: [
            ["B", "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ", "The application retries the whole transaction, as the error asks it to."],
            ["B", "SELECT units FROM stock WHERE item = 'Phone'", "This time B reads 7 and works out 7 - 2 = 5."],
            ["B", "UPDATE stock SET units = 5 WHERE item = 'Phone'", "No conflict now."],
            ["B", "COMMIT", "Both sales counted."],
          ],
        },
        {
          label: "Read committed, relative update",
          vars: { level: "READ COMMITTED" },
          summary: "No error and no lost sale, at the weakest level. Letting the database do the arithmetic means the waiting UPDATE recomputes from the row A committed.",
          steps: [
            ["A", "BEGIN", "Session A starts a sale of 3."],
            ["B", "BEGIN", "Session B starts a sale of 2."],
            ["A", "UPDATE stock SET units = units - 3 WHERE item = 'Phone'", "A lets the database do the arithmetic, instead of writing a value it computed."],
            ["B", "UPDATE stock SET units = units - 2 WHERE item = 'Phone'", "B waits for A's row lock."],
            ["A", "COMMIT", "A commits. Postgres re-reads the row for B's waiting UPDATE and subtracts from 7, not from 10."],
            ["B", "COMMIT", "5 units left, the right answer."],
          ],
        },
      ],
      steps: [
        ["A", "BEGIN TRANSACTION ISOLATION LEVEL {level}", "Session A starts a sale of 3."],
        ["B", "BEGIN TRANSACTION ISOLATION LEVEL {level}", "Session B starts a sale of 2."],
        ["A", "SELECT units FROM stock WHERE item = 'Phone'", "A reads 10 and works out 10 - 3 = 7 in the application."],
        ["B", "SELECT units FROM stock WHERE item = 'Phone'", "B reads 10 too and works out 10 - 2 = 8."],
        ["A", "UPDATE stock SET units = 7 WHERE item = 'Phone'", "A writes the value it computed. It now holds the row lock."],
        ["B", "UPDATE stock SET units = 8 WHERE item = 'Phone'", "B wants the same row and has to wait for A to finish."],
        ["A", "COMMIT", "A commits, which releases the lock, and B's statement returns."],
        ["B", "COMMIT", "B commits whatever state it's in."],
      ],
    },

    "write-skew": {
      title: "Two doctors go off call at once",
      alt: "A recorded run on PostgreSQL with tabs for repeatable read and serializable. Two doctors are on call and the rule says at least one must stay. Each session sees two on call and takes its own doctor off. At repeatable read both commit and nobody is on call. At serializable the second commit fails with a serialization error.",
      sessions: ["Adam", "Bob"],
      tableName: "doctors",
      setup: doctors,
      observe: "SELECT name, on_call FROM doctors ORDER BY name",
      variants: [
        { label: "Repeatable read", vars: { level: "REPEATABLE READ" }, summary: "Both transactions committed and nobody is on call. They touched different rows, so no row conflict was ever visible." },
        {
          label: "Serializable",
          vars: { level: "SERIALIZABLE" },
          summary: "Postgres saw that the two transactions couldn't have run in any serial order and failed one. Nothing blocked: the loser retried, saw one doctor left and stayed on call.",
          extra: [
            ["Bob", "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE", "The application retries Bob's transaction."],
            ["Bob", "SELECT count(*) AS on_call FROM doctors WHERE on_call", "Now Bob sees one doctor on call, himself, so he can't leave."],
            ["Bob", "ROLLBACK", "Bob stays on call and the rule holds."],
          ],
        },
      ],
      steps: [
        ["Adam", "BEGIN TRANSACTION ISOLATION LEVEL {level}", "Adam wants to go off call, at {level}."],
        ["Bob", "BEGIN TRANSACTION ISOLATION LEVEL {level}", "So does Bob."],
        ["Adam", "SELECT count(*) AS on_call FROM doctors WHERE on_call", "The rule is that at least one doctor stays on call. Adam sees two, so leaving looks safe."],
        ["Bob", "SELECT count(*) AS on_call FROM doctors WHERE on_call", "Bob sees two as well."],
        ["Adam", "UPDATE doctors SET on_call = false WHERE name = 'Adam'", "Adam updates his own row."],
        ["Bob", "UPDATE doctors SET on_call = false WHERE name = 'Bob'", "Bob updates his own row. It's a different row, so there's no lock to wait for."],
        ["Adam", "COMMIT", "Adam commits."],
        ["Bob", "COMMIT", "Bob commits, if the database lets him."],
      ],
    },

    "write-skew-lock": {
      title: "The same doctors with a lock",
      alt: "A recorded run on PostgreSQL at read committed. Each doctor's session locks the on-call rows with SELECT FOR UPDATE. Bob's lock waits for Adam to commit, then sees only one doctor on call, so Bob stays. No error and no retry, but Bob had to wait.",
      sessions: ["Adam", "Bob"],
      tableName: "doctors",
      setup: doctors,
      observe: "SELECT name, on_call FROM doctors ORDER BY name",
      steps: [
        ["Adam", "BEGIN", "This time at plain READ COMMITTED."],
        ["Bob", "BEGIN", "Same for Bob."],
        ["Adam", "SELECT name FROM doctors WHERE on_call FOR UPDATE", "Adam locks every row he based the decision on, not only his own."],
        ["Bob", "SELECT name FROM doctors WHERE on_call FOR UPDATE", "Bob asks for the same locks and waits."],
        ["Adam", "UPDATE doctors SET on_call = false WHERE name = 'Adam'", "Two were on call, so Adam leaves."],
        ["Adam", "COMMIT", "The locks are released and Bob's query returns. It rechecks the rows, so it lists only Bob."],
        ["Bob", "ROLLBACK", "Bob sees one doctor left and stays. The rule holds, with no error to handle."],
      ],
    },

    "write-skew-mysql": {
      engine: "mysql",
      title: "Serializable on MySQL is built from locks",
      alt: "A recorded run on MySQL at serializable. Each doctor's read takes a shared lock. Adam's update then has to wait for Bob's shared lock, and Bob's update waits for Adam's, which is a deadlock. MySQL rolls Bob back with a deadlock error, Adam's update goes through, and the rule holds.",
      sessions: ["Adam", "Bob"],
      tableName: "doctors",
      setup: [
        "CREATE TABLE doctors (name varchar(20) PRIMARY KEY, on_call boolean NOT NULL)",
        "INSERT INTO doctors VALUES ('Adam', true), ('Bob', true)",
      ],
      steps: [
        ["Adam", "SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE", "Adam's connection asks for MySQL's strictest level."],
        ["Bob", "SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE", "Bob's too."],
        ["Adam", "START TRANSACTION", "Adam begins."],
        ["Bob", "START TRANSACTION", "Bob begins."],
        ["Adam", "SELECT count(*) AS on_call FROM doctors WHERE on_call", "At this level InnoDB turns a plain SELECT into a locking read, so Adam now holds shared locks on the rows."],
        ["Bob", "SELECT count(*) AS on_call FROM doctors WHERE on_call", "Shared locks don't conflict, so Bob reads and holds them too."],
        ["Adam", "UPDATE doctors SET on_call = false WHERE name = 'Adam'", "Adam needs an exclusive lock on his row, and Bob's shared lock is in the way, so he waits. This is the blocking my notes described."],
        ["Bob", "UPDATE doctors SET on_call = false WHERE name = 'Bob'", "Now Bob needs a row Adam has locked. Each waits for the other: a deadlock. MySQL picks a victim straight away."],
        ["Adam", "COMMIT", "The survivor commits."],
        ["Adam", "SELECT name, on_call FROM doctors ORDER BY name", "One doctor stays on call. The rule held, and the price was a wait and an error instead of a clean retry signal."],
      ],
    },

    "rr-mysql": {
      engine: "mysql",
      title: "Lost update at MySQL's repeatable read",
      alt: "A recorded run on MySQL at repeatable read. Both sessions read 10 units and write values computed in the application. The second write waits for the first, then succeeds and overwrites, so MySQL's default level allows the lost update that PostgreSQL's level rejects.",
      sessions: ["A", "B"],
      tableName: "stock",
      setup: ["CREATE TABLE stock (item varchar(20) PRIMARY KEY, units int)", "INSERT INTO stock VALUES ('Phone', 10)"],
      steps: [
        ["A", "START TRANSACTION", "Both sessions run at MySQL's default, REPEATABLE READ."],
        ["B", "START TRANSACTION", "Session B begins."],
        ["A", "SELECT units FROM stock WHERE item = 'Phone'", "A reads 10."],
        ["B", "SELECT units FROM stock WHERE item = 'Phone'", "B reads 10."],
        ["A", "UPDATE stock SET units = 7 WHERE item = 'Phone'", "A writes its result."],
        ["B", "UPDATE stock SET units = 8 WHERE item = 'Phone'", "B waits for A's row lock."],
        ["A", "COMMIT", "A commits. B's update returns successfully, with no error."],
        ["B", "COMMIT", "B commits."],
        ["A", "SELECT units FROM stock WHERE item = 'Phone'", "8 units. A's sale is lost at the same level name that protected it on Postgres."],
      ],
    },
  },

  runs: {
    crash: crashRecovery,
    "commit-tradeoff": commitTradeoff,
  },

  playgrounds: {
    transfer: {
      title: "Commit and rollback",
      hint: "Run the transfer, then try the presets. Each run starts from whatever the last one left, and Reset puts the balances back.",
      setup: `CREATE TABLE accounts (id int PRIMARY KEY, owner text, balance int NOT NULL CHECK (balance >= 0));
INSERT INTO accounts VALUES (1, 'Ana', 500), (2, 'Ben', 100);`,
      query: `BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;

SELECT * FROM accounts ORDER BY id;`,
      presets: [
        {
          label: "Change your mind",
          sql: `BEGIN;
UPDATE accounts SET balance = 0 WHERE id = 1;
SELECT * FROM accounts ORDER BY id;   -- inside: Ana has 0
ROLLBACK;
SELECT * FROM accounts ORDER BY id;   -- after: back as it was`,
        },
        {
          label: "See the transaction id",
          sql: `BEGIN;
SELECT txid_current() AS my_transaction;
UPDATE accounts SET balance = balance + 1 WHERE id = 1;
SELECT id, balance, xmin, xmax, ctid FROM accounts ORDER BY id;
COMMIT;`,
        },
      ],
    },
    "rule-break": {
      title: "Ask the database to break its own rule",
      hint: "The CHECK constraint is a consistency rule you defined. This run fails on purpose: read the error, then add a smaller amount.",
      mayFail: true,
      setup: `CREATE TABLE accounts (id int PRIMARY KEY, owner text, balance int NOT NULL CHECK (balance >= 0));
INSERT INTO accounts VALUES (1, 'Ana', 500), (2, 'Ben', 100);`,
      query: `UPDATE accounts SET balance = balance - 700 WHERE id = 1;`,
      presets: [
        { label: "What's in the table now?", sql: "SELECT * FROM accounts ORDER BY id;" },
        { label: "A foreign key rule", sql: `CREATE TABLE IF NOT EXISTS payments (account_id int REFERENCES accounts(id), amount int);
INSERT INTO payments VALUES (99, 10);` },
      ],
    },
  },
};

export default spec;
