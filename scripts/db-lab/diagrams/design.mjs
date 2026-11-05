import { AMBER, FAINT, GREEN, MUTED } from "../canvas.mjs";

const post = {
  slug: "db-system-design",
  diagrams: {
    "post-tweet-v1": {
      alt: "The simplest design for posting a tweet. The client sends an HTTP POST to a server, which inserts a row in the database and replies.",
      draw(c) {
        c.size(720, 200).title("Start with the simplest thing that works");
        const client = c.box(20, 70, 130, 64, "client", { tone: "plain", lines: "POST /tweet" });
        const server = c.box(290, 70, 130, 64, "server", { tone: "raised", lines: "any language" });
        const db = c.box(560, 70, 130, 64, "database", { tone: "cream", lines: "tweets table" });
        c.arrow(client.right, server.left, { label: "HTTP", both: true });
        c.arrow(server.right, db.left, { label: "SQL", both: true });
        c.flow("client", "server", "HTTP", "request");
        c.flow("server", "database", "SQL", "data");
        c.flow("database", "server", "SQL", "metadata");
        c.flow("server", "client", "HTTP", "metadata");
      },
    },

    "post-tweet-v2": {
      alt: "The design after asking what can fail. A load balancer spreads clients over servers, which hold pools of ready database connections. A queue between the servers and the database absorbs spikes and retries failed writes. Workers drain the queue into the database.",
      draw(c) {
        c.size(720, 300).title("After asking what fails");
        const client = c.box(20, 110, 96, 60, "clients", { tone: "plain" });
        const lb = c.box(150, 110, 110, 60, "load balancer", { tone: "amber", lines: "L4 or L7" });
        c.box(300, 60, 110, 56, "server 1", { tone: "raised", lines: "conn pool" });
        c.box(300, 164, 110, 56, "server 2", { tone: "raised", lines: "conn pool" });
        const q = c.box(450, 110, 110, 60, "queue", { tone: "cream", lines: "absorbs spikes" });
        const db = c.box(600, 110, 100, 60, "database", { tone: "green" });
        c.arrow(client.right, lb.left);
        c.arrow([260, 126], [298, 92]);
        c.arrow([260, 154], [298, 188]);
        c.arrow([410, 92], [448, 126]);
        c.arrow([410, 188], [448, 154]);
        c.arrow(q.right, db.left);
        c.para(20, 256, "Workers drain the queue into the database. Each box is there because of a failure mode, and each adds something new to run.", { width: 680, fill: MUTED });
        c.flow("clients", "load balancer", "", "request");
        c.flow("load balancer", "server 1", "", "request");
        c.flow("server 1", "queue", "", "data");
        c.flow("queue", "database", "", "data");
      },
    },

    "l4-vs-l7": {
      alt: "Two kinds of load balancer. A layer 4 balancer forwards TCP connections without reading them, so one client connection maps to one backend connection. A layer 7 balancer terminates the connection, reads HTTP, and can route each request separately, but it holds the TLS keys and two connections per request.",
      draw(c) {
        c.size(720, 250).title("Load balancing at layer 4 or layer 7");
        c.text(20, 58, "Layer 4: forwards packets", { size: 12.5, weight: 700 });
        const a = c.box(20, 70, 90, 44, "client", { tone: "plain", size: 11.5 });
        const b = c.box(150, 70, 110, 44, "L4", { tone: "amber", lines: "can't read it", size: 11.5, small: 9.5 });
        const d = c.box(300, 70, 60, 44, "server", { tone: "raised", size: 10.5 });
        c.arrow(a.right, b.left);
        c.arrow(b.right, d.left);
        c.para(20, 140, "One TLS session, end to end. All requests on a connection go to one server.", { width: 340 });
        c.text(380, 58, "Layer 7: reads HTTP", { size: 12.5, weight: 700 });
        const e = c.box(380, 70, 90, 44, "client", { tone: "plain", size: 11.5 });
        const f = c.box(506, 70, 100, 44, "L7", { tone: "amber", lines: "reads it", size: 11.5, small: 9.5 });
        const g = c.box(640, 70, 60, 44, "server", { tone: "raised", size: 10.5 });
        c.arrow(e.right, f.left);
        c.arrow(f.right, g.left);
        c.para(380, 140, "Two connections. Can route by URL, cache and retry. It terminates TLS, so it holds the keys.", { width: 320 });
        c.line([368, 44], [368, 220], { color: FAINT, dash: "3 4" });
      },
    },

    "url-scaled": {
      alt: "The URL shortener at scale. A reverse proxy sends POST requests to a writer connected to the primary, and GET requests to readers connected to read replicas, which are placed near users. Reads far outnumber writes, so most traffic never touches the primary.",
      draw(c) {
        c.size(720, 300).title("Reads and writes take different paths");
        const client = c.box(20, 118, 100, 60, "clients", { tone: "plain" });
        const proxy = c.box(170, 118, 120, 60, "reverse proxy", { tone: "amber", lines: "splits by method" });
        const w = c.box(350, 56, 120, 54, "writer", { tone: "raised", lines: "POST" });
        const r = c.box(350, 186, 120, 54, "readers", { tone: "raised", lines: "GET" });
        const p = c.box(540, 56, 150, 54, "primary", { tone: "green" });
        const rep = c.box(540, 186, 150, 54, "read replicas", { tone: "cream", lines: "near users" });
        c.arrow(client.right, proxy.left);
        c.arrow([290, 134], [348, 92], { color: AMBER });
        c.arrow([290, 162], [348, 204], { color: GREEN });
        c.arrow(w.right, p.left, { color: AMBER });
        c.arrow(r.right, rep.left, { color: GREEN });
        c.arrow(p.bottom, rep.top, { label: "replication", labelDy: 4, labelDx: 42, color: MUTED });
        c.flow("clients", "reverse proxy", "", "request");
        c.flow("reverse proxy", "readers", "", "request");
        c.flow("readers", "read replicas", "", "data");
        c.flow("primary", "read replicas", "replication", "metadata");
      },
    },

    "fan-out": {
      alt: "Two ways to build a home timeline. Pull: on each read, look up everyone you follow and merge their latest tweets, so reads are expensive and writes are cheap. Push: on each tweet, copy it into every follower's timeline, so reads are cheap and a celebrity's tweet means millions of writes.",
      draw(c) {
        c.size(720, 260).title("A home timeline: pay at read time or write time");
        c.text(20, 56, "Pull (fan-out on read)", { size: 12.5, weight: 700 });
        c.box(20, 70, 100, 50, "reader", { tone: "plain", size: 11.5 });
        [0, 1, 2].forEach((i) => {
          const b = c.box(210, 66 + i * 42, 120, 34, `followee ${i + 1}`, { tone: "cream", size: 10.5 });
          c.arrow([120, 95], b.left, { color: AMBER, width: 1.2 });
        });
        c.para(20, 208, "Cheap to tweet. Each read costs one lookup per account you follow.", { width: 320 });
        c.text(380, 56, "Push (fan-out on write)", { size: 12.5, weight: 700 });
        c.box(380, 70, 100, 50, "tweet", { tone: "plain", size: 11.5 });
        [0, 1, 2].forEach((i) => {
          const b = c.box(570, 66 + i * 42, 130, 34, `timeline ${i + 1}`, { tone: "green", size: 10.5 });
          c.arrow([480, 95], b.left, { color: GREEN, width: 1.2 });
        });
        c.para(380, 208, "Cheap to read. A celebrity's tweet is millions of writes.", { width: 320 });
      },
    },

    "summary-map": {
      alt: "A map of this post in three columns. Method: start simple, ask what fails, add a box only for a reason. Twitter: post, follow, and the timeline trade-off. URL shortener: generated ids or hashes, split reads from writes.",
      draw(c) {
        c.size(720, 260).title("The post on one page");
        const cols = [
          ["The method", "cream", ["Start with the simple version", "Ask what fails, then fix that", "Every box has a cost"]],
          ["Twitter", "amber", ["Queues absorb write spikes", "A follows row is cheap", "Timelines: pull or push"]],
          ["URL shortener", "green", ["Ids are simple and guessable", "Hashes clash at short lengths", "Reads go to replicas"]],
        ];
        cols.forEach(([name, tone, items], i) => {
          const x = 20 + i * 230;
          c.box(x, 56, 220, 44, name, { tone, size: 13.5 });
          items.forEach((t, j) => c.box(x, 108 + j * 42, 220, 36, "", { tone: "plain", lines: t, small: 11 }));
        });
      },
    },
  },
};

export default post;
