/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Demo content for the student API, mirroring edtech-lms-api's seed of the same
 * name: identical fixture IDs, so the two databases end up looking as they would
 * after a successful cloud-to-classroom sync.
 *
 * Usage: npm run seed:content
 *
 * Why both databases need seeding: the tablet reads lessons from THIS api
 * (EXPO_PUBLIC_BASE_URL), not from the central LMS (EXPO_PUBLIC_SYNC_URL).
 * Content authored centrally reaches here over /sync/* in production. This
 * script short-circuits that for development only. It is not a substitute for
 * the sync, and the sync remains the only real content path.
 *
 * Scope matches the central seed:
 *
 * - Development and test fixture, NOT pilot content.
 * - Question images are real: they are generated into edtech-expo/public/media,
 *   which Metro serves, so no bucket is needed locally. Point
 *   EXPO_PUBLIC_RESOURCE_URL at the Metro origin and EXPO_PUBLIC_RESOURCE_PATH
 *   at 'media'.
 * - Lesson VIDEO is still absent: lessonlearnings reference documents rows whose
 *   .mp4 files exist nowhere, so a lesson opens but the player stays empty.
 * - Questions cover only the 15 template ids the tablet renders (1-8, 18-24).
 *   Ids 9-17 have no client renderer. See the central repo's seed for detail.
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

// Identical to edtech-lms-api/scripts/seed-demo-content.js. Keep them in step.
const ID = {
  country: "b0000000-0000-4000-8000-000000000001",
  school: "b0000000-0000-4000-8000-000000000002",
  standard: "b0000000-0000-4000-8000-000000000003",
  subject: "b0000000-0000-4000-8000-000000000004",
  curriculum: "b0000000-0000-4000-8000-000000000005",
  grade: "b0000000-0000-4000-8000-000000000007",
  level: "b0000000-0000-4000-8000-000000000008",
  lesson1: "b0000000-0000-4000-8000-000000000009",
  lesson2: "b0000000-0000-4000-8000-00000000000a",
  doc1: "b0000000-0000-4000-8000-00000000000b",
  doc2: "b0000000-0000-4000-8000-00000000000c",
  learning1: "b0000000-0000-4000-8000-00000000000d",
  learning2: "b0000000-0000-4000-8000-00000000000e",
  practice1: "b0000000-0000-4000-8000-00000000000f",
  practice2: "b0000000-0000-4000-8000-000000000010",
  quiz1: "b0000000-0000-4000-8000-000000000011",
  quiz2: "b0000000-0000-4000-8000-000000000012",
  teacherUser: "b0000000-0000-4000-8000-000000000013",
  teacher: "b0000000-0000-4000-8000-000000000014",
};

const STUDENTS = [
  { su: "b0000000-0000-4000-8000-000000000020", id: "b0000000-0000-4000-8000-000000000021", username: "demo.sophea", first: "Sophea", last: "Chan", gender: 2 },
  { su: "b0000000-0000-4000-8000-000000000022", id: "b0000000-0000-4000-8000-000000000023", username: "demo.dara", first: "Dara", last: "Sok", gender: 1 },
  { su: "b0000000-0000-4000-8000-000000000024", id: "b0000000-0000-4000-8000-000000000025", username: "demo.bopha", first: "Bopha", last: "Neang", gender: 2 },
];

// questionoptionid is assigned per question in the insert loop below: it must be
// unique across questions, because MatchingDropArea keys its drop targets on it.
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

// Image options: MCQImageItem reads option.questionoptionfile.filename and builds
// `${EXPO_PUBLIC_RESOURCE_URL}/${EXPO_PUBLIC_RESOURCE_PATH}/<filename>`. The files
// live in edtech-expo/public/media, which Metro serves, so no bucket is needed for
// local development. In a real deployment these are objects in the media store.
const imgOpt = (i, filename, correct) =>
  opt(i, filename.replace(/\.png$/, ""), correct, {
    questionoptionistext: false,
    questionoptionfile: { filename },
  });

const ALL_QUESTIONS = [
  { t: 1,  ident: "DEMO-T01-mcq-single-text",   text: "Which number is larger?",                      options: [opt(1, "7", false), opt(2, "12", true), opt(3, "3", false)] },
  { t: 2,  ident: "DEMO-T02-mcq-single-image",  text: "Tap the triangle.", options: [imgOpt(1, "triangle.png", true), imgOpt(2, "square.png", false)] },
  { t: 3,  ident: "DEMO-T03-mcq-multi-text",    text: "Select every even number.",                    options: [opt(1, "2", true), opt(2, "5", false), opt(3, "8", true)] },
  { t: 4,  ident: "DEMO-T04-mcq-multi-image",   text: "Select every shape with four sides.", options: [imgOpt(1, "square.png", true), imgOpt(2, "circle.png", false), imgOpt(3, "rectangle.png", true)] },
  { t: 5,  ident: "DEMO-T05-order-text",        text: "Put these words in order to make a sentence.",  options: [opt(1, "The", true), opt(2, "dog", true), opt(3, "runs", true)] },
  { t: 6,  ident: "DEMO-T06-order-image",       text: "Put the pictures in the order the story happens.", options: [imgOpt(1, "story-1.png", true), imgOpt(2, "story-2.png", true), imgOpt(3, "story-3.png", true)] },
  // The draggable piece is questionassociate.questionassociatetext (see
  // components/practices/DragItem.tsx). It is not a {key,value} pair.
  { t: 7,  ident: "DEMO-T07-associate",         text: "Match each word to the word it rhymes with.", options: [opt(1, "cat", true, { questionassociate: { questionassociatetext: "hat", questionassociatefile: null } }), opt(2, "dog", true, { questionassociate: { questionassociatetext: "log", questionassociatefile: null } })] },
  { t: 8,  ident: "DEMO-T08-fill-blank",        text: "The cat sat on the ___.",                                  options: [opt(1, "mat", true)] },
  { t: 18, ident: "DEMO-T18-doption1",          text: "Prototype: picture options, variant 1.", options: [imgOpt(1, "triangle.png", true), imgOpt(2, "circle.png", false)] },
  { t: 19, ident: "DEMO-T19-doption3",          text: "Prototype: picture options, variant 3.", options: [imgOpt(1, "square.png", true), imgOpt(2, "circle.png", false)] },
  { t: 20, ident: "DEMO-T20-doption4",          text: "Prototype: picture options, variant 4.", options: [imgOpt(1, "circle.png", true), imgOpt(2, "triangle.png", false)] },
  { t: 21, ident: "DEMO-T21-foption1",          text: "Prototype: typed answer, variant 1.",          options: [opt(1, "4", true)], correctvalue: 4 },
  { t: 22, ident: "DEMO-T22-foption2",          text: "Prototype: typed answer, variant 2.",          options: [opt(1, "6", true)], correctvalue: 6 },
  { t: 23, ident: "DEMO-T23-foption4",          text: "Prototype: typed answer, variant 4.",          options: [opt(1, "9", true)], correctvalue: 9 },
  { t: 24, ident: "DEMO-T24-fraction",          text: "Shade one half.",                              options: [opt(1, "1/2", true, { questionoptionisfraction: true, questionoptionnumeratorvalue: "1", questionoptiondenominatorvalue: "2" })] },
];

// Seed only the eight SUPPORTED template types (1–8). The prototypes (18–24)
// are un-vetted and have undocumented data contracts — e.g. DOption3 (19) is a
// drag-to-count interaction, not picture MCQ, so the MCQ-shaped fixture above
// renders as an empty box plus stray option text. Keep their definitions here
// but don't seed them; drop this filter to re-enable one once it's evaluated
// (ROADMAP Track C — "evaluate the seven prototypes; decide if each earns a
// curriculum slot").
const PROTOTYPE_TEMPLATE_IDS = new Set([18, 19, 20, 21, 22, 23, 24]);
const QUESTIONS = ALL_QUESTIONS.filter((qq) => !PROTOTYPE_TEMPLATE_IDS.has(qq.t));

const qid = (i) => `b0000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`;

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to run: NODE_ENV=production. This seeds demo content.");
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
    await q(`INSERT IGNORE INTO schools (schoolid, schoolname, countryid, curriculums, isdeleted) VALUES (?,?,?,?,0)`,
      [ID.school, "Demo Primary School", ID.country, JSON.stringify([ID.curriculum])]);
    await q(`INSERT IGNORE INTO standards (standardid, standardname, schoolname, schoolid, isdeleted) VALUES (?,?,?,?,0)`,
      [ID.standard, "Class 4A", "Demo Primary School", ID.school]);
    await q(`INSERT IGNORE INTO subjects (subjectid, subjectname, subjectstatus, subjectdescription, isdeleted) VALUES (?,?,1,?,0)`,
      [ID.subject, "Foundational Skills", "Demo subject"]);
    await q(`INSERT IGNORE INTO curriculums (curriculumid, curriculumname, curriculumstatus, curriculumdescription, isdeleted, subjectid) VALUES (?,?,1,?,0,?)`,
      [ID.curriculum, "Demo Curriculum", "Seeded by npm run seed:content", ID.subject]);
    await q(`INSERT IGNORE INTO grades (gradeid, curriculumid, gradestatus, gradename, gradedescription, gradeorder, isdeleted, passing_points, points) VALUES (?,?,1,?,?,1,0,80,100)`,
      [ID.grade, ID.curriculum, "Grade 1", "Demo grade"]);
    await q(`INSERT IGNORE INTO levels (levelid, gradeid, levelname, leveldescription, isdeleted, levelstatus, levelorder, passing_points, quiz_points, points) VALUES (?,?,?,?,0,1,1,80,20,100)`,
      [ID.level, ID.grade, "Level 1", "Demo level"]);

    const lessons = [
      { id: ID.lesson1, name: "Counting to ten", order: 1, doc: ID.doc1, learning: ID.learning1, practice: ID.practice1, quiz: ID.quiz1 },
      { id: ID.lesson2, name: "Reading simple words", order: 2, doc: ID.doc2, learning: ID.learning2, practice: ID.practice2, quiz: ID.quiz2 },
    ];

    for (const l of lessons) {
      await q(`INSERT IGNORE INTO lessons (lessonid, levelid, lessonname, lessondescription, practicecount, quizcount, lessonpasspercentage, lessonorder, lessonstatus, isdeleted, total_points, passing_points, learning_points, quizzes_points, practices_points)
               VALUES (?,?,?,?,1,1,80,?,1,0,100,80,20,40,40)`,
        [l.id, ID.level, l.name, "Demo lesson", l.order]);
      await q(`INSERT IGNORE INTO documents (documentid, documenttypeid, documentname, documents3meta, isdeleted, documenttags) VALUES (?,2,?,?,0,?)`,
        [l.doc, `demo/${l.name.toLowerCase().replace(/ /g, "-")}.mp4`, JSON.stringify({ seeded: true, media: "absent" }), JSON.stringify(["demo"])]);
      await q(`INSERT IGNORE INTO lessonlearnings (lessonlearningid, lessonlearningname, lessonlearningdescription, lessonlearningstatus, lessonid, documentid, lessonlearningorder, points) VALUES (?,?,?,1,?,?,1,20)`,
        [l.learning, `${l.name} video`, "Demo learning video", l.id, l.doc]);
      await q(`INSERT IGNORE INTO lessonpractices (lessonpracticeid, lessonid, lessonpracticeorder, lessonpracticestatus, lessonpracticename, lessonpracticedescription, points) VALUES (?,?,1,1,?,?,40)`,
        [l.practice, l.id, `${l.name} practice`, "Demo practice set"]);
      await q(`INSERT IGNORE INTO lessonquizzes (lessonquizid, lessonid, lessonquizorder, lessonquizname, lessonquizstatus, lessonquizdescription, points) VALUES (?,?,1,?,1,?,40)`,
        [l.quiz, l.id, `${l.name} quiz`, "Demo quiz"]);
    }

    for (let i = 0; i < QUESTIONS.length; i++) {
      const Q = QUESTIONS[i];
      const id = qid(i);

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
               VALUES (?,?,?,?,?,?,?,0,1,?,?,?)`,
        [id, JSON.stringify({ headingtext: Q.text, headingfile: null }), JSON.stringify(options), Q.text,
         JSON.stringify([]), null, Q.t, Q.ident, JSON.stringify(["demo"]), Q.correctvalue ?? null]);
      const l = i < Math.ceil(QUESTIONS.length / 2) ? lessons[0] : lessons[1];
      await q(`INSERT IGNORE INTO lessonpracticequestions (lessonpracticequestionid, lessonpracticeid, lessonpracticequestionstatus, questionid, lessonpracticequestionorder) VALUES (?,?,1,?,?)`,
        [`${id}-p`.slice(0, 36), l.practice, id, i + 1]);
      await q(`INSERT IGNORE INTO lessonquizquestions (lessonquizquestionid, lessonquizid, questionid, lessonquizquestionstatus, lessonquizquestionorder) VALUES (?,?,?,1,?)`,
        [`${id}-q`.slice(0, 36), l.quiz, id, i + 1]);
    }

    /**
     * curriculumids (plural) is what the app actually filters on, and it is easy
     * to miss because curriculumid (singular) is the NOT NULL column that looks
     * authoritative. GET /curriculum/subjects builds
     *   where curriculumid IN (user.curriculumids ?? [])
     * from the token, so a student whose curriculumids is null matches nothing
     * and the Subjects screen renders empty with no error. Set both.
     */
    const CURRICULUM_IDS = JSON.stringify([ID.curriculum]);

    // schooluserrole: 3 = teacher, 4 = student (matches seed-demo-users.sql).
    await q(`INSERT IGNORE INTO schoolusers (schooluserid, schoolusername, schooluserpasswordhash, schooluserrole, schooluserstatus, schoolname, isdisabled) VALUES (?,?,?,3,1,?,0)`,
      [ID.teacherUser, "demo.numeracy.teacher", PASSWORD_HASH, "Demo Primary School"]);
    await q(`INSERT IGNORE INTO students (studentid, studentfirstname, studentlastname, genderid, city, country, state, curriculumid, curriculumids, isactive, schooluserid, gradeid, startinglevelid, studentcurrentlevelid, studentcurrentlessonid, standard, schoolname, is_teacher_acc)
             VALUES (?,?,?,1,?,?,?,?,?,1,?,?,?,?,?,?,?,1)`,
      [ID.teacher, "Demo", "Teacher", "Phnom Penh", "Cambodia", "Phnom Penh", ID.curriculum, CURRICULUM_IDS, ID.teacherUser, ID.grade, ID.level, ID.level, ID.lesson1, ID.standard, "Demo Primary School"]);

    for (const s of STUDENTS) {
      await q(`INSERT IGNORE INTO schoolusers (schooluserid, schoolusername, schooluserpasswordhash, schooluserrole, schooluserstatus, schoolname, isdisabled) VALUES (?,?,?,4,1,?,0)`,
        [s.su, s.username, PASSWORD_HASH, "Demo Primary School"]);
      await q(`INSERT IGNORE INTO students (studentid, studentfirstname, studentlastname, genderid, city, country, state, curriculumid, curriculumids, isactive, schooluserid, gradeid, startinglevelid, studentcurrentlevelid, studentcurrentlessonid, standard, schoolname, is_teacher_acc)
               VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,0)`,
        [s.id, s.first, s.last, s.gender, "Phnom Penh", "Cambodia", "Phnom Penh", ID.curriculum, CURRICULUM_IDS, s.su, ID.grade, ID.level, ID.level, ID.lesson1, ID.standard, "Demo Primary School"]);
    }

    /**
     * seed-demo-users.sql creates demo.student and demo.teacher against its own
     * placeholder curriculum, which has no lessons. The Expo login screen
     * pre-fills demo.student, so without this they log in and see nothing.
     * Point them at the seeded curriculum and its first lesson.
     */
    const [res] = await conn.execute(
      `UPDATE students s
          JOIN schoolusers su ON su.schooluserid = s.schooluserid
         SET s.curriculumid = ?, s.curriculumids = ?, s.gradeid = ?, s.startinglevelid = ?,
             s.studentcurrentlevelid = ?, s.studentcurrentlessonid = ?
       WHERE su.schoolusername IN ('demo.student', 'demo.teacher')`,
      [ID.curriculum, CURRICULUM_IDS, ID.grade, ID.level, ID.level, ID.lesson1]
    );

    const [[c]] = await conn.query(`
      SELECT (SELECT COUNT(*) FROM lessons)   AS lessons,
             (SELECT COUNT(*) FROM questions) AS questions,
             (SELECT COUNT(*) FROM students)  AS students`);

    console.log("Demo content seeded into the student API database.");
    console.log(`  lessons ${c.lessons} | questions ${c.questions} | students ${c.students}`);
    console.log(`  repointed ${res.affectedRows} existing demo user(s) at the seeded curriculum`);
    console.log(`  logins (password ${DEMO_PASSWORD}): demo.student, ${STUDENTS.map((s) => s.username).join(", ")}`);
    console.log("  Lesson videos will not play: no media is seeded.");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
