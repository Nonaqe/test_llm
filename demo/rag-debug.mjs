/** Трассировка retrieval: оба плеча вручную по тем же SQL, что RetrievalService. */
import pg from "pg";

const DIM = 1536;

// Точная копия fake-эмбеддинга из packages/core
function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function tokenize(text) {
  return text.toLowerCase().split(/[^a-zа-яё0-9]+/iu).filter((t) => t.length > 1);
}
function fakeEmbedding(text) {
  const vec = new Array(DIM).fill(0);
  for (const token of tokenize(text)) vec[hashString(token) % DIM] += 1;
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}
const toVecLiteral = (v) => `[${v.join(",")}]`;

const q = process.argv[2] ?? "план реализации фазы";
const vec = fakeEmbedding(q);

const c = new pg.Client({ connectionString: "postgres://postgres:postgres@127.0.0.1:54329/postgres" });
await c.connect();

// Проект резолвится по имени (последний созданный seed'ом) — захардкоженный
// uuid умирал после любого пересида (аудит IR-059)
const projectName = process.argv[3] ?? "Nova Shop";
const proj = await c.query("select id from projects where name = $1 order by created_at desc limit 1", [projectName]);
if (proj.rows.length === 0) {
  console.error(`Проект «${projectName}» не найден. Запустите demo/seed.mjs.`);
  process.exit(1);
}
const PROJECT = proj.rows[0].id;
console.log(`project: ${PROJECT} (${projectName})`);

const vectorLeg = await c.query(
  `select id, left(content, 60) as content, (1 - (embedding <=> $2::vector))::float8 as cosine
   from chunks where project_id = $1
   order by embedding <=> $2::vector limit 6`,
  [PROJECT, toVecLiteral(vec)],
);
console.log("== VECTOR LEG ==");
for (const r of vectorLeg.rows) console.log(r.cosine.toFixed(4), "|", r.content.replace(/\n/g, " "));

const ftsLeg = await c.query(
  `select id, left(content, 60) as content, ts_rank(tsv, q)::float8 as rank
   from chunks, websearch_to_tsquery('simple', $2) q
   where project_id = $1 and tsv @@ q
   order by ts_rank(tsv, q) desc limit 6`,
  [PROJECT, q],
);
console.log("== FTS LEG =", ftsLeg.rows.length, "rows");
for (const r of ftsLeg.rows) console.log(r.rank.toFixed(4), "|", r.content.replace(/\n/g, " "));

await c.end();
