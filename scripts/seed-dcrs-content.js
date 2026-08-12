/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * DCRS demo content for the student API, mirroring edtech-lms-api's seed of the
 * same name: identical fixture IDs, so the two databases end up looking as they
 * would after a successful cloud-to-classroom sync.
 *
 * Usage: npm run seed:dcrs (requires ALLOW_DEMO_SEED=true)
 *
 * What this is: a real client deck — Mekong Inclusive Ventures' (MIV)
 * "Disabilities Capital Readiness" programme, Cohort II, "Module 1: Business
 * Vision & Goals" — loaded as a curriculum under a new corporate-themed school,
 * so a demo login can click through actual client content end to end. This is
 * separate from seed-demo-content.js (which stays generic/synthetic); the two
 * are independent and safe to run in either order or together.
 *
 * Why both databases need seeding: the tablet reads lessons from THIS api
 * (EXPO_PUBLIC_BASE_URL), not from the central LMS (EXPO_PUBLIC_SYNC_URL).
 * Content authored centrally reaches here over /sync/* in production. This
 * script short-circuits that for development only. It is not a substitute for
 * the sync, and the sync remains the only real content path.
 *
 * Fixture ID namespace: c0000000-0000-4000-8000-0000000000XX, distinct from
 * seed-demo-content.js's b-namespace so the two seeds never collide. The one
 * exception is `countries`: this script reuses seed-demo-content.js's Cambodia
 * row verbatim (same id, same values, INSERT IGNORE) so either seed can run
 * first and the other still finds it.
 *
 * Lesson VIDEO is still absent: lessonlearnings reference documents rows whose
 * .mp4 files exist nowhere, so a lesson opens but the player stays empty —
 * same accepted state as seed-demo-content.js.
 *
 * Idempotent: fixed UUIDs plus INSERT IGNORE.
 */
const path = require("path");
const crypto = require("crypto");
const dotenv = require("dotenv");
const mysql = require("mysql2/promise");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const DEMO_PASSWORD = "demo";
const PASSWORD_HASH = md5(DEMO_PASSWORD);

// Identical to edtech-lms-api/scripts/seed-dcrs-content.js. Keep them in step.
// Numbering is shared across both scripts even where a given id has no use in
// this database (e.g. 04/curriculumcountry, which only edtech-lms-api writes)
// so that ids which exist in both stay numerically aligned.
const ID = {
  country: "b0000000-0000-4000-8000-000000000001", // reused verbatim from seed-demo-content.js
  standard: "c0000000-0000-4000-8000-000000000001",
  subject: "c0000000-0000-4000-8000-000000000002",
  curriculum: "c0000000-0000-4000-8000-000000000003",
  // 04 reserved for curriculumcountry (edtech-lms-api only)
  grade: "c0000000-0000-4000-8000-000000000005",
  level: "c0000000-0000-4000-8000-000000000006",
  school: "c0000000-0000-4000-8000-000000000007",
  lesson1: "c0000000-0000-4000-8000-000000000008",
  lesson2: "c0000000-0000-4000-8000-000000000009",
  lesson3: "c0000000-0000-4000-8000-00000000000a",
  lesson4: "c0000000-0000-4000-8000-00000000000b",
  doc1: "c0000000-0000-4000-8000-00000000000c",
  doc2: "c0000000-0000-4000-8000-00000000000d",
  doc3: "c0000000-0000-4000-8000-00000000000e",
  doc4: "c0000000-0000-4000-8000-00000000000f",
  learning1: "c0000000-0000-4000-8000-000000000010",
  learning2: "c0000000-0000-4000-8000-000000000011",
  learning3: "c0000000-0000-4000-8000-000000000012",
  learning4: "c0000000-0000-4000-8000-000000000013",
  practice1: "c0000000-0000-4000-8000-000000000014",
  practice2: "c0000000-0000-4000-8000-000000000015",
  practice3: "c0000000-0000-4000-8000-000000000016",
  practice4: "c0000000-0000-4000-8000-000000000017",
  quiz1: "c0000000-0000-4000-8000-000000000018",
  quiz2: "c0000000-0000-4000-8000-000000000019",
  quiz3: "c0000000-0000-4000-8000-00000000001a",
  quiz4: "c0000000-0000-4000-8000-00000000001b",
  studentUser: "c0000000-0000-4000-8000-00000000001c", // miv.demo schoolusers row
  student: "c0000000-0000-4000-8000-00000000001d", // miv.demo students row
  facilitatorUser: "c0000000-0000-4000-8000-00000000001e", // miv.facilitator schoolusers row
  facilitator: "c0000000-0000-4000-8000-00000000001f", // miv.facilitator students row
  q1: "c0000000-0000-4000-8000-000000000020",
  q2: "c0000000-0000-4000-8000-000000000021",
  q3: "c0000000-0000-4000-8000-000000000022",
  q4: "c0000000-0000-4000-8000-000000000023",
  q5: "c0000000-0000-4000-8000-000000000024",
  q6: "c0000000-0000-4000-8000-000000000025",
  q7: "c0000000-0000-4000-8000-000000000026",
  // lessonpracticequestions join rows — own ids, never derived by suffixing a
  // question id (that truncates to 36 chars and silently collides).
  pqLesson1: "c0000000-0000-4000-8000-000000000027",
  pqLesson2: "c0000000-0000-4000-8000-000000000028",
  pqLesson3: "c0000000-0000-4000-8000-000000000029",
  pqLesson4: "c0000000-0000-4000-8000-00000000002a",
  // lessonquizquestions join rows — same reasoning.
  qqLesson1: "c0000000-0000-4000-8000-00000000002b",
  qqLesson2Q2: "c0000000-0000-4000-8000-00000000002c",
  qqLesson2Q3: "c0000000-0000-4000-8000-00000000002d",
  qqLesson3Q4: "c0000000-0000-4000-8000-00000000002e",
  qqLesson3Q5: "c0000000-0000-4000-8000-00000000002f",
  qqLesson3Q6: "c0000000-0000-4000-8000-000000000030",
  qqLesson4: "c0000000-0000-4000-8000-000000000031",
};

// Identical helper to seed-demo-content.js: per-option questionoptioniscorrect,
// questioncorrectvalue stays null, option ids `${questionid}-opt-N`.
const opt = (i, text, correct, extra = {}) => ({
  questionoptionid: null,
  questionoptiontext: text,
  questionoptionvalue: text,
  questionoptioniscorrect: correct,
  questionoptionsequence: i,
  questionoptionistext: true,
  questionoptionisfraction: false,
  questionoptionisstaticfile: false,
  questionoptionfile: null,
  questionassociate: null,
  questionoptionnumeratorisstatic: false,
  questionoptionnumeratorvalue: "",
  questionoptiondenominatorisstatic: false,
  questionoptiondenominatorvalue: "",
  ...extra,
});

// Content verbatim from the client deck ("Module 1: Business Vision & Goals"),
// except Q1 — see note below. All templatetypeid 1 (MCQ single, text).
const QUESTIONS = [
  {
    key: "q1",
    ident: "DCRS-M1-no-plan-sign",
    // Derived, not verbatim: composed from phrases on deck slide 3 ("no
    // plan" symptoms), not a direct quote of a single line.
    text: "Which of these is a sign of running a business with no plan?",
    options: [
      opt(1, "Putting out fires all day", true),
      opt(2, "Family and staff pull the same way", false),
      opt(3, "You know what is worth buying", false),
    ],
  },
  {
    key: "q2",
    ident: "DCRS-M1-which-is-vision",
    text: "Which one is a vision?",
    options: [
      opt(1, "We ran out of ice this morning.", false),
      opt(2, "To be the cleanest, most reliable vegetable stall in my district.", true),
      opt(3, "A customer complained about the price today.", false),
    ],
  },
  {
    key: "q3",
    ident: "DCRS-M1-vision-not-number",
    text: "A vision is a number you check every week.",
    options: [opt(1, "True", false), opt(2, "False", true)],
  },
  {
    key: "q4",
    ident: "DCRS-M1-which-goal-smart",
    text: "Which goal is SMART?",
    options: [
      opt(1, "Sell more vegetables.", false),
      opt(2, "Increase daily sales by 15% within 3 months.", true),
      opt(3, "Be the best shop in Battambang.", false),
      opt(4, "Get more customers soon.", false),
    ],
  },
  {
    key: "q5",
    ident: "DCRS-M1-missing-letter",
    text: 'This goal is missing one letter: “Increase daily sales by 15%.” Which?',
    options: [
      opt(1, "S — Specific", false),
      opt(2, "M — Measurable", false),
      opt(3, "A — Achievable", false),
      opt(4, "R — Relevant", false),
      opt(5, "T — Time-bound", true),
    ],
  },
  {
    key: "q6",
    ident: "DCRS-M1-hire-packer-smart",
    text: '“Hire 1 packer next month” is a SMART goal.',
    options: [opt(1, "True", true), opt(2, "False", false)],
  },
  {
    key: "q7",
    ident: "DCRS-M1-goal-needs-numbers",
    text: "You can set a real sales goal without knowing today's sales.",
    options: [opt(1, "True", false), opt(2, "False", true)],
  },
];

async function main() {
  if (process.env.ALLOW_DEMO_SEED !== "true") {
    console.error("Refusing to run: set ALLOW_DEMO_SEED=true to seed demo data. This replaces the old NODE_ENV check so UAT re-seeds are explicit and prod can never be seeded by accident.");
    process.exit(1);
  }
  const user = process.env.RPI_DB_USER;
  const password = process.env.RPI_DB_PASSWORD;
  if (!user || password === undefined) {
    console.error("Missing RPI_DB_USER or RPI_DB_PASSWORD in edtech-lms-rpi-api/.env");
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: process.env.RPI_DB_HOST || "127.0.0.1",
    port: parseInt(String(process.env.RPI_DB_PORT || "3306"), 10),
    user,
    password,
    database: process.env.RPI_DB_NAME || "edtech_lms_rpi",
  });

  const q = (sql, params = []) => conn.execute(sql, params);

  try {
    await q(`INSERT IGNORE INTO countries (countryid, countryname, isdeleted) VALUES (?,?,0)`,
      [ID.country, "Cambodia"]);

    await q(`INSERT IGNORE INTO standards (standardid, standardname, schoolname, schoolid, isdeleted) VALUES (?,?,?,?,0)`,
      [ID.standard, "MSME", "Mekong Inclusive Ventures", ID.school]);

    await q(`INSERT IGNORE INTO subjects (subjectid, subjectname, subjectstatus, subjectdescription, isdeleted) VALUES (?,?,1,?,0)`,
      [ID.subject, "Business Foundations", "DCRS subject"]);

    await q(`INSERT IGNORE INTO curriculums (curriculumid, curriculumname, curriculumstatus, curriculumdescription, isdeleted, subjectid) VALUES (?,?,1,?,0,?)`,
      [ID.curriculum, "DCRS — Capital Readiness (Cohort II)", "Seeded by npm run seed:dcrs", ID.subject]);

    await q(`INSERT IGNORE INTO grades (gradeid, curriculumid, gradestatus, gradename, gradedescription, gradeorder, isdeleted, passing_points, points) VALUES (?,?,1,?,?,1,0,80,100)`,
      [ID.grade, ID.curriculum, "Cohort II", "DCRS grade"]);

    await q(`INSERT IGNORE INTO levels (levelid, gradeid, levelname, leveldescription, isdeleted, levelstatus, levelorder, passing_points, quiz_points, points) VALUES (?,?,?,?,0,1,1,80,20,100)`,
      [ID.level, ID.grade, "Module 1: Business Vision & Goals", "DCRS level"]);

    // uitheme 'corporate' distinguishes this school's client UI from the
    // 'kids' default the demo school uses. brandingconfig stays NULL.
    await q(`INSERT IGNORE INTO schools (schoolid, schoolname, countryid, curriculums, isdeleted, uitheme) VALUES (?,?,?,?,0,?)`,
      [ID.school, "Mekong Inclusive Ventures", ID.country, JSON.stringify([ID.curriculum]), "corporate"]);

    const lessons = [
      { id: ID.lesson1, name: "Why direction matters", order: 1, doc: ID.doc1, learning: ID.learning1, learningName: "Animation: No plan vs clear vision", learningDesc: "Shows the difference between running a business with no plan and one guided by a clear vision.", practice: ID.practice1, quiz: ID.quiz1, desc: "Why having a clear plan matters more than reacting to daily fires." },
      { id: ID.lesson2, name: "Your business vision", order: 2, doc: ID.doc2, learning: ID.learning2, learningName: "Animation: Your business vision", learningDesc: "Introduces what a business vision is and why it matters.", practice: ID.practice2, quiz: ID.quiz2, desc: "Defining a vision for your business beyond today's tasks." },
      { id: ID.lesson3, name: "Goals: the stepping stones (SMART)", order: 3, doc: ID.doc3, learning: ID.learning3, learningName: "Animation: Vague to SMART", learningDesc: "Walks through turning a vague goal into a SMART goal.", practice: ID.practice3, quiz: ID.quiz3, desc: "Turning vague hopes into SMART goals — Specific, Measurable, Achievable, Relevant, Time-bound." },
      { id: ID.lesson4, name: "Find your goals", order: 4, doc: ID.doc4, learning: ID.learning4, learningName: "Animation: Listen, dream, measure", learningDesc: "Guides listening to customers, dreaming about the future, and measuring progress toward a goal.", practice: ID.practice4, quiz: ID.quiz4, desc: "Setting your own SMART goal for your business." },
    ];

    for (const l of lessons) {
      await q(`INSERT IGNORE INTO lessons (lessonid, levelid, lessonname, lessondescription, practicecount, quizcount, lessonpasspercentage, lessonorder, lessonstatus, isdeleted, total_points, passing_points, learning_points, quizzes_points, practices_points)
               VALUES (?,?,?,?,1,1,80,?,1,0,100,80,20,40,40)`,
        [l.id, ID.level, l.name, l.desc, l.order]);

      // documenttypeid 2 = VIDEO. No file of this name exists in any bucket;
      // matches seed-demo-content.js's accepted empty-player state.
      await q(`INSERT IGNORE INTO documents (documentid, documenttypeid, documentname, documents3meta, isdeleted, documenttags) VALUES (?,2,?,?,0,?)`,
        [l.doc, `dcrs-m1-l${l.order}.mp4`, JSON.stringify({ seeded: true, media: "absent" }), JSON.stringify(["dcrs"])]);

      await q(`INSERT IGNORE INTO lessonlearnings (lessonlearningid, lessonlearningname, lessonlearningdescription, lessonlearningstatus, lessonid, documentid, lessonlearningorder, points) VALUES (?,?,?,1,?,?,1,20)`,
        [l.learning, l.learningName, l.learningDesc, l.id, l.doc]);

      await q(`INSERT IGNORE INTO lessonpractices (lessonpracticeid, lessonid, lessonpracticeorder, lessonpracticestatus, lessonpracticename, lessonpracticedescription, points) VALUES (?,?,1,1,?,?,40)`,
        [l.practice, l.id, `${l.name} practice`, "DCRS practice set"]);

      await q(`INSERT IGNORE INTO lessonquizzes (lessonquizid, lessonid, lessonquizorder, lessonquizname, lessonquizstatus, lessonquizdescription, points) VALUES (?,?,1,?,1,?,40)`,
        [l.quiz, l.id, `${l.name} quiz`, "DCRS quiz"]);
    }

    for (const Q of QUESTIONS) {
      const id = ID[Q.key];

      // Give every option an id unique to its question, and point each
      // associate at the option it belongs to (QuestionAssociate.questionoptionid).
      const options = Q.options.map((o, j) => {
        const questionoptionid = `${id}-opt-${j + 1}`;
        return {
          ...o,
          questionoptionid,
          questionassociate: o.questionassociate
            ? { ...o.questionassociate, questionoptionid }
            : null,
        };
      });

      await q(`INSERT IGNORE INTO questions (questionid, questionheading, questionoptions, questiontext, questiondistractors, questionfile, templatetypeid, isdeleted, questionstatus, questionidentifier, questiontags, questioncorrectvalue)
               VALUES (?,?,?,?,?,?,1,0,1,?,?,?)`,
        [id, JSON.stringify({ headingtext: Q.text, headingfile: null }), JSON.stringify(options), Q.text,
         JSON.stringify([]), null, Q.ident, JSON.stringify(["demo", "dcrs"]), null]);
    }

    // Practice/quiz mapping (own join-row ids; order restarts at 1 per lesson).
    const PRACTICE_MAP = [
      { practice: ID.practice1, joinId: ID.pqLesson1, questions: [ID.q1] },
      { practice: ID.practice2, joinId: ID.pqLesson2, questions: [ID.q2] },
      { practice: ID.practice3, joinId: ID.pqLesson3, questions: [ID.q4] },
      { practice: ID.practice4, joinId: ID.pqLesson4, questions: [ID.q7] },
    ];
    for (const m of PRACTICE_MAP) {
      let order = 1;
      for (const questionid of m.questions) {
        await q(`INSERT IGNORE INTO lessonpracticequestions (lessonpracticequestionid, lessonpracticeid, lessonpracticequestionstatus, questionid, lessonpracticequestionorder) VALUES (?,?,1,?,?)`,
          [m.joinId, m.practice, questionid, order++]);
      }
    }

    const QUIZ_MAP = [
      { quiz: ID.quiz1, entries: [{ joinId: ID.qqLesson1, questionid: ID.q1 }] },
      { quiz: ID.quiz2, entries: [{ joinId: ID.qqLesson2Q2, questionid: ID.q2 }, { joinId: ID.qqLesson2Q3, questionid: ID.q3 }] },
      { quiz: ID.quiz3, entries: [{ joinId: ID.qqLesson3Q4, questionid: ID.q4 }, { joinId: ID.qqLesson3Q5, questionid: ID.q5 }, { joinId: ID.qqLesson3Q6, questionid: ID.q6 }] },
      { quiz: ID.quiz4, entries: [{ joinId: ID.qqLesson4, questionid: ID.q7 }] },
    ];
    for (const m of QUIZ_MAP) {
      let order = 1;
      for (const e of m.entries) {
        await q(`INSERT IGNORE INTO lessonquizquestions (lessonquizquestionid, lessonquizid, questionid, lessonquizquestionstatus, lessonquizquestionorder) VALUES (?,?,?,1,?)`,
          [e.joinId, m.quiz, e.questionid, order++]);
      }
    }

    // curriculumids (plural) is what the app actually filters on — see the
    // comment in seed-demo-content.js. Set it on both DCRS logins.
    const CURRICULUM_IDS = JSON.stringify([ID.curriculum]);

    // schooluserrole: 3 = teacher, 4 = student (matches seed-demo-users.sql).
    await q(`INSERT IGNORE INTO schoolusers (schooluserid, schoolusername, schooluserpasswordhash, schooluserrole, schooluserstatus, schoolname, isdisabled) VALUES (?,?,?,4,1,?,0)`,
      [ID.studentUser, "miv.demo", PASSWORD_HASH, "Mekong Inclusive Ventures"]);
    await q(`INSERT IGNORE INTO students (studentid, studentfirstname, studentlastname, genderid, city, country, state, curriculumid, curriculumids, isactive, schooluserid, gradeid, startinglevelid, studentcurrentlevelid, studentcurrentlessonid, standard, schoolname, is_teacher_acc)
             VALUES (?,?,?,2,?,?,?,?,?,1,?,?,?,?,?,?,?,0)`,
      [ID.student, "Sreymom", "Prak", "Battambang", "Cambodia", "Battambang", ID.curriculum, CURRICULUM_IDS, ID.studentUser, ID.grade, ID.level, ID.level, ID.lesson1, ID.standard, "Mekong Inclusive Ventures"]);

    await q(`INSERT IGNORE INTO schoolusers (schooluserid, schoolusername, schooluserpasswordhash, schooluserrole, schooluserstatus, schoolname, isdisabled) VALUES (?,?,?,3,1,?,0)`,
      [ID.facilitatorUser, "miv.facilitator", PASSWORD_HASH, "Mekong Inclusive Ventures"]);
    await q(`INSERT IGNORE INTO students (studentid, studentfirstname, studentlastname, genderid, city, country, state, curriculumid, curriculumids, isactive, schooluserid, gradeid, startinglevelid, studentcurrentlevelid, studentcurrentlessonid, standard, schoolname, is_teacher_acc)
             VALUES (?,?,?,1,?,?,?,?,?,1,?,?,?,?,?,?,?,1)`,
      [ID.facilitator, "MIV", "Facilitator", "Battambang", "Cambodia", "Battambang", ID.curriculum, CURRICULUM_IDS, ID.facilitatorUser, ID.grade, ID.level, ID.level, ID.lesson1, ID.standard, "Mekong Inclusive Ventures"]);

    const [[c]] = await conn.query(`
      SELECT (SELECT COUNT(*) FROM lessons WHERE levelid = ?)   AS lessons,
             (SELECT COUNT(*) FROM questions WHERE questionidentifier LIKE 'DCRS-%') AS questions,
             (SELECT COUNT(*) FROM students WHERE schoolname = 'Mekong Inclusive Ventures') AS students`,
      [ID.level]);

    console.log("DCRS content seeded into the student API database.");
    console.log(`  lessons ${c.lessons} | questions ${c.questions} | students ${c.students}`);
    console.log(`  logins (password ${DEMO_PASSWORD}): miv.demo, miv.facilitator`);
    console.log("  Lesson videos will not play: no media is seeded.");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
