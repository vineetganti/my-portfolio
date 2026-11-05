import { AMBER, FAINT, GREEN, INK, MUTED } from "../canvas.mjs";

const post = {
  slug: "db-security",
  diagrams: {
    "startup-flow": {
      alt: "How a Postgres connection starts. The TCP handshake comes first. The client may ask for TLS. Then it sends a startup message with its user and database, the server asks for authentication, they exchange SCRAM messages, and the server sends its settings and says it's ready for queries.",
      draw(c) {
        c.size(720, 300).title("A conversation before the first query");
        c.box(40, 54, 120, 40, "client", { tone: "plain" });
        c.box(560, 54, 120, 40, "server", { tone: "cream" });
        c.line([100, 94], [100, 280], { color: FAINT });
        c.line([620, 94], [620, 280], { color: FAINT });
        const msgs = [
          ["TCP handshake", true, MUTED],
          ["StartupMessage: user, database", true, AMBER],
          ["AuthenticationSASL: use SCRAM", false, AMBER],
          ["SCRAM exchange, no password sent", true, GREEN],
          ["AuthenticationOk, settings", false, GREEN],
          ["ReadyForQuery", false, MUTED],
        ];
        msgs.forEach(([label, right, color], i) => {
          const y = 116 + i * 28;
          c.arrow(right ? [102, y] : [618, y], right ? [618, y] : [102, y], { color, label, labelDy: -4 });
        });
      },
    },

    "least-privilege": {
      alt: "Three pools for three roles. The read route uses a pool logged in as a role that can only select. The create route uses a role that can only insert, and the delete route a role that can only delete. A SQL injection in the read route can't drop or change anything.",
      draw(c) {
        c.size(720, 260).title("One pool per role");
        const routes = [["GET /todos", "dbread", "SELECT", "green"], ["POST /todos", "dbcreate", "INSERT", "cream"], ["DELETE /todos", "dbdelete", "DELETE", "amber"]];
        c.box(570, 90, 130, 80, "todos", { tone: "raised" });
        routes.forEach(([route, role, right, tone], i) => {
          const y = 56 + i * 62;
          const a = c.box(20, y, 150, 48, route, { tone: "plain", size: 11.5 });
          const b = c.box(230, y, 180, 48, role, { tone, lines: `only ${right}`, size: 12 });
          c.arrow(a.right, b.left);
          c.arrow(b.right, [568, 130], { color: MUTED, width: 1.2 });
        });
      },
    },

    "encryption-states": {
      alt: "Data in three states. In transit, TLS protects it on the wire. At rest, disk or file encryption protects it in storage. In use, the database must normally decrypt it to compute, and that's the gap homomorphic encryption tries to close.",
      draw(c) {
        c.size(720, 230).title("Three places data can be exposed");
        const items = [
          ["In transit", "green", "On the wire", "TLS"],
          ["At rest", "green", "On the disk", "Disk or file encryption"],
          ["In use", "red", "While being computed on", "Normally plain, in memory"],
        ];
        items.forEach(([name, tone, where, how], i) => {
          const x = 20 + i * 232;
          c.box(x, 60, 216, 54, name, { tone, lines: where, size: 13.5, small: 11 });
          c.para(x + 4, 140, how, { width: 208, size: 12.5, weight: 700, fill: INK });
        });
        c.para(20, 188, "Homomorphic encryption works on the third row: computing on data that stays encrypted.", { width: 680, size: 12, fill: MUTED });
      },
    },

    "summary-map": {
      alt: "A map of this post in four columns. Encryption: TLS needs a certificate, and hostssl to enforce it. The wire: SCRAM hides the password, but without TLS queries are plain text. Least privilege: separate roles, with sequence and select rights you might miss. Beyond: compute on encrypted data, at a high cost.",
      draw(c) {
        c.size(720, 280).title("The post on one page");
        const cols = [
          ["TLS", "green", ["ssl = on and a key", "hostssl makes it required", "Verify the certificate"]],
          ["The wire", "amber", ["Passwords use SCRAM", "Queries are plain text", "Errors can say too much"]],
          ["Least privilege", "cream", ["A pool per role", "USAGE on the sequence", "DELETE WHERE needs SELECT"]],
          ["Encrypted compute", "raised", ["Add without decrypting", "Works, and it's costly", "Not a database feature yet"]],
        ];
        cols.forEach(([name, tone, items], i) => {
          const x = 20 + i * 172;
          c.box(x, 56, 164, 44, name, { tone, size: 13 });
          items.forEach((t, j) => c.box(x, 108 + j * 40, 164, 34, "", { tone: "plain", lines: t, small: 10.5 }));
        });
      },
    },
  },
};

export default post;
