-- Demo Pi API users for local development (database: edtech_lms_rpi).
-- Guarantees: demo.student, demo.teacher accounts in 'Demo Primary School' (schoolid b0000000-0000-4000-8000-000000000002).
-- Password for both accounts: demo
-- Hash is MD5("demo") using crypto-js, matching SchoolUserBusiness / AuthBusiness.
--
-- Expo login (POST http://localhost:3001/auth/login):
--   Student: studentusername=demo.student, studentpassword=demo
--   Teacher: studentusername=demo.teacher, studentpassword=demo
--
-- Idempotent: uses INSERT IGNORE (safe to run more than once).

SET NAMES utf8mb4;

INSERT IGNORE INTO `curriculums` (`curriculumid`, `curriculumname`, `curriculumstatus`, `curriculumdescription`, `isdeleted`, `subjectid`)
VALUES ('a1111111-1111-4111-8111-111111111111', 'Demo curriculum', 1, 'Local dev seed', 0, NULL);

INSERT IGNORE INTO `schools` (`schoolid`, `schoolname`, `countryid`, `curriculums`, `isdeleted`, `uitheme`)
VALUES ('b0000000-0000-4000-8000-000000000002', 'Demo Primary School', NULL, '[]', 0, 'kids');

INSERT IGNORE INTO `schoolusers` (`schooluserid`, `schoolusername`, `schooluserpasswordhash`, `schooluserrole`, `schooluserstatus`, `schoolname`, `isdisabled`)
VALUES
  ('a2222222-2222-4222-8222-222222222222', 'demo.student', 'fe01ce2a7fbac8fafaed7c982a04e229', 4, 1, 'Demo Primary School', 0),
  ('a3333333-3333-4333-8333-333333333333', 'demo.teacher', 'fe01ce2a7fbac8fafaed7c982a04e229', 3, 1, 'Demo Primary School', 0);

INSERT IGNORE INTO `students` (`studentid`, `studentfirstname`, `studentlastname`, `genderid`, `city`, `country`, `state`, `curriculumid`, `isactive`, `schooluserid`, `is_teacher_acc`, `schoolname`)
VALUES
  ('a4444444-4444-4444-8444-444444444444', 'Demo', 'Student', 1, 'Local', 'Local', 'Local', 'a1111111-1111-4111-8111-111111111111', 1, 'a2222222-2222-4222-8222-222222222222', 0, 'Demo Primary School'),
  ('a5555555-5555-4555-8555-555555555555', 'Demo', 'Teacher', 1, 'Local', 'Local', 'Local', 'a1111111-1111-4111-8111-111111111111', 1, 'a3333333-3333-4333-8333-333333333333', 1, 'Demo Primary School');

-- INSERT IGNORE is a no-op on a re-run against rows that already exist (e.g.
-- from before `schoolname` was added to this seed), so backfill it
-- explicitly to keep the script idempotent and self-healing.
UPDATE `students` SET `schoolname` = 'Demo Primary School'
WHERE `studentid` IN ('a4444444-4444-4444-8444-444444444444', 'a5555555-5555-4555-8555-555555555555')
  AND (`schoolname` IS NULL OR `schoolname` = '' OR `schoolname` = 'Demo School');

-- Also update schoolusers for self-healing from old to new name.
UPDATE `schoolusers` SET `schoolname` = 'Demo Primary School'
WHERE `schoolusername` IN ('demo.student', 'demo.teacher')
  AND `schoolname` = 'Demo School';
