/**
 * PEX — Weekly Client Check-in backend
 * Single serverless function handling every API action, backed by a real
 * Postgres database (Neon, connected through Vercel's Storage integration).
 * Deployed automatically by Vercel because this file lives under /api — no
 * extra config needed.
 *
 * SETUP (do this once, in the Vercel dashboard, after the project deploys):
 * 1) Project > Storage tab > Create Database > pick "Neon" (Postgres) from
 *    the marketplace > Connect to project. Vercel wires up a DATABASE_URL
 *    environment variable for you — nothing to copy/paste.
 * 2) Still in Storage > your database > "SQL Editor" (or "Query") tab: paste
 *    the contents of schema.sql (in this same folder) and run it once, to
 *    create the two tables this file expects (clients, checkins).
 * 3) Coach dashboard password is the ADMIN_PASSWORD constant right below —
 *    change it any time by editing this line on GitHub and committing;
 *    Vercel redeploys automatically.
 */

const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

const ADMIN_PASSWORD = 'Apex';

function checkPassword(pw) {
  return !!ADMIN_PASSWORD && pw === ADMIN_PASSWORD;
}

function genToken() {
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 6)
  );
}

// Monday-based ISO week id, e.g. "2026-W38"
function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return date.getUTCFullYear() + '-W' + (weekNo < 10 ? '0' + weekNo : weekNo);
}

async function getClient(token) {
  if (!token) return { ok: false, error: 'invalid_token' };
  const rows = await sql`SELECT name FROM clients WHERE token = ${token}`;
  if (!rows.length) return { ok: false, error: 'invalid_token' };
  return { ok: true, name: rows[0].name };
}

async function addClient(pw, name) {
  if (!checkPassword(pw)) return { ok: false, error: 'unauthorized' };
  const clean = (name || '').toString().trim();
  if (!clean) return { ok: false, error: 'invalid_name' };
  const token = genToken();
  await sql`INSERT INTO clients (token, name) VALUES (${token}, ${clean})`;
  return { ok: true, token };
}

async function listClients(pw) {
  if (!checkPassword(pw)) return { ok: false, error: 'unauthorized' };
  const rows = await sql`
    SELECT token, name, created_at AS "createdAt"
    FROM clients
    ORDER BY created_at DESC
  `;
  return { ok: true, clients: rows };
}

async function submitCheckin(body) {
  const client = await getClient(body.token);
  if (!client.ok) return { ok: false, error: 'invalid_token' };
  if (
    body.weight == null || body.sleepHours == null ||
    body.energy == null || body.diet == null
  ) {
    return { ok: false, error: 'missing_fields' };
  }
  const weekId = isoWeek(new Date());
  await sql`
    INSERT INTO checkins
      (token, week_id, checkin_date, weight, sleep_hours, energy, diet,
       steps, problems, notes, week_rating, submitted_at)
    VALUES
      (${body.token}, ${weekId}, now(), ${body.weight}, ${body.sleepHours},
       ${body.energy}, ${body.diet}, ${body.steps ?? null},
       ${body.problems || ''}, ${body.notes || ''}, ${body.weekRating ?? null}, now())
    ON CONFLICT (token, week_id) DO UPDATE SET
      checkin_date = now(),
      weight = EXCLUDED.weight,
      sleep_hours = EXCLUDED.sleep_hours,
      energy = EXCLUDED.energy,
      diet = EXCLUDED.diet,
      steps = EXCLUDED.steps,
      problems = EXCLUDED.problems,
      notes = EXCLUDED.notes,
      week_rating = EXCLUDED.week_rating,
      submitted_at = now()
  `;
  return { ok: true, weekId };
}

async function getMyCheckin(token) {
  const client = await getClient(token);
  if (!client.ok) return { ok: false, error: 'invalid_token' };
  const weekId = isoWeek(new Date());
  const rows = await sql`
    SELECT weight, sleep_hours AS "sleepHours", energy, diet, steps,
           problems, notes, week_rating AS "weekRating"
    FROM checkins
    WHERE token = ${token} AND week_id = ${weekId}
  `;
  if (!rows.length) return { ok: true, exists: false, weekId };
  return Object.assign({ ok: true, exists: true, weekId }, rows[0]);
}

async function listCheckins(pw) {
  if (!checkPassword(pw)) return { ok: false, error: 'unauthorized' };
  const rows = await sql`
    SELECT c.token, cl.name, c.week_id AS "weekId", c.checkin_date AS "date",
           c.weight, c.sleep_hours AS "sleepHours", c.energy, c.diet, c.steps,
           c.problems, c.notes, c.week_rating AS "weekRating",
           c.submitted_at AS "submittedAt"
    FROM checkins c
    JOIN clients cl ON cl.token = c.token
    ORDER BY c.submitted_at DESC
  `;
  return { ok: true, checkins: rows };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }
  const body = req.body || {};
  try {
    let out;
    switch (body.action) {
      case 'getClient':
        out = await getClient(body.token);
        break;
      case 'getMyCheckin':
        out = await getMyCheckin(body.token);
        break;
      case 'submitCheckin':
        out = await submitCheckin(body);
        break;
      case 'adminLogin':
        out = { ok: checkPassword(body.password) };
        break;
      case 'listClients':
        out = await listClients(body.password);
        break;
      case 'addClient':
        out = await addClient(body.password, body.name);
        break;
      case 'listCheckins':
        out = await listCheckins(body.password);
        break;
      default:
        out = { ok: false, error: 'unknown_action' };
    }
    res.status(200).json(out);
  } catch (err) {
    res.status(200).json({ ok: false, error: String((err && err.message) || err) });
  }
};
