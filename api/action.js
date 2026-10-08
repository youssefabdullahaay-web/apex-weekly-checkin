/**
 * APEX — Weekly Client Check-in backend
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
  // Short enough to keep the client link compact, still random enough that
  // guessing another client's token isn't realistic at this app's scale.
  return Math.random().toString(36).slice(2, 10);
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
  const rows = await sql`SELECT name, drive_link AS "driveLink" FROM clients WHERE token = ${token}`;
  if (!rows.length) return { ok: false, error: 'invalid_token' };
  // A client only sees the first-check-in (assessment) form when they have
  // NEVER submitted anything at all — neither an assessment nor a weekly
  // check-in. This matters for clients who already existed before this
  // feature shipped: they have check-in history but no assessment row, and
  // must keep going straight to the normal weekly form, not get sent back
  // to a "first check-in" they never actually had.
  const asRows = await sql`SELECT id FROM assessments WHERE token = ${token} LIMIT 1`;
  const ckRows = await sql`SELECT id FROM checkins WHERE token = ${token} LIMIT 1`;
  return {
    ok: true,
    name: rows[0].name,
    driveLink: rows[0].driveLink || '',
    hasAssessment: asRows.length > 0 || ckRows.length > 0,
  };
}

async function addClient(pw, name, driveLink) {
  if (!checkPassword(pw)) return { ok: false, error: 'unauthorized' };
  const clean = (name || '').toString().trim();
  if (!clean) return { ok: false, error: 'invalid_name' };
  const link = (driveLink || '').toString().trim();
  const token = genToken();
  await sql`INSERT INTO clients (token, name, drive_link) VALUES (${token}, ${clean}, ${link || null})`;
  return { ok: true, token };
}

async function updateClientDriveLink(pw, token, driveLink) {
  if (!checkPassword(pw)) return { ok: false, error: 'unauthorized' };
  if (!token) return { ok: false, error: 'invalid_token' };
  const link = (driveLink || '').toString().trim();
  const rows = await sql`SELECT id FROM clients WHERE token = ${token}`;
  if (!rows.length) return { ok: false, error: 'not_found' };
  await sql`UPDATE clients SET drive_link = ${link || null} WHERE token = ${token}`;
  return { ok: true, driveLink: link };
}

async function listClients(pw) {
  if (!checkPassword(pw)) return { ok: false, error: 'unauthorized' };
  const rows = await sql`
    SELECT token, name, drive_link AS "driveLink", created_at AS "createdAt"
    FROM clients
    ORDER BY created_at DESC
  `;
  return { ok: true, clients: rows };
}

async function submitAssessment(body) {
  const client = await getClient(body.token);
  if (!client.ok) return { ok: false, error: 'invalid_token' };
  const required = [
    'fullName', 'job', 'age', 'heightCm', 'weightKg', 'medicalHistory', 'goal',
    'trainingDays', 'supplements', 'favoriteFoods', 'dislikedFoods', 'stepsPerDay',
    'mealsPerDay', 'sleepHours', 'trainedBefore',
  ];
  for (const f of required) {
    if (body[f] === undefined || body[f] === null || body[f] === '') {
      return { ok: false, error: 'missing_fields' };
    }
  }
  await sql`
    INSERT INTO assessments
      (token, full_name, job, age, height_cm, weight_kg, medical_history,
       goal, training_days, supplements, favorite_foods, disliked_foods,
       steps_per_day, meals_per_day, sleep_hours, trained_before, submitted_at)
    VALUES
      (${body.token}, ${body.fullName}, ${body.job || ''}, ${body.age},
       ${body.heightCm}, ${body.weightKg}, ${body.medicalHistory}, ${body.goal},
       ${body.trainingDays}, ${body.supplements}, ${body.favoriteFoods},
       ${body.dislikedFoods}, ${body.stepsPerDay ?? null}, ${body.mealsPerDay},
       ${body.sleepHours}, ${body.trainedBefore}, now())
  `;
  return { ok: true };
}

async function getClientAssessment(pw, token) {
  if (!checkPassword(pw)) return { ok: false, error: 'unauthorized' };
  if (!token) return { ok: false, error: 'invalid_token' };
  const rows = await sql`
    SELECT full_name AS "fullName", job, age, height_cm AS "heightCm",
           weight_kg AS "weightKg", medical_history AS "medicalHistory",
           goal, training_days AS "trainingDays", supplements,
           favorite_foods AS "favoriteFoods", disliked_foods AS "dislikedFoods",
           steps_per_day AS "stepsPerDay", meals_per_day AS "mealsPerDay",
           sleep_hours AS "sleepHours", trained_before AS "trainedBefore",
           submitted_at AS "submittedAt"
    FROM assessments WHERE token = ${token}
    ORDER BY submitted_at DESC LIMIT 1
  `;
  if (!rows.length) return { ok: true, exists: false };
  return Object.assign({ ok: true, exists: true }, rows[0]);
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
  // Every submission is a brand-new row — like a Google Form response —
  // never an update of a previous one, so the client's full history stays
  // intact from their very first check-in to their latest.
  const weekId = isoWeek(new Date());
  await sql`
    INSERT INTO checkins
      (token, week_id, checkin_date, weight, sleep_hours, energy, diet,
       steps, problems, notes, week_rating, submitted_at)
    VALUES
      (${body.token}, ${weekId}, now(), ${body.weight}, ${body.sleepHours},
       ${body.energy}, ${body.diet}, ${body.steps ?? null},
       ${body.problems || ''}, ${body.notes || ''}, ${body.weekRating ?? null}, now())
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

async function deleteClient(pw, token) {
  if (!checkPassword(pw)) return { ok: false, error: 'unauthorized' };
  if (!token) return { ok: false, error: 'invalid_token' };
  await sql`DELETE FROM checkins WHERE token = ${token}`;
  await sql`DELETE FROM clients WHERE token = ${token}`;
  return { ok: true };
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
        out = await addClient(body.password, body.name, body.driveLink);
        break;
      case 'updateClientDriveLink':
        out = await updateClientDriveLink(body.password, body.token, body.driveLink);
        break;
      case 'submitAssessment':
        out = await submitAssessment(body);
        break;
      case 'getClientAssessment':
        out = await getClientAssessment(body.password, body.token);
        break;
      case 'deleteClient':
        out = await deleteClient(body.password, body.token);
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
