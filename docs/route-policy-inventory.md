# Route policy inventory

<!-- GENERATED FILE. Do not edit by hand. -->

**Generated file.** It lists every route the application registers and the
organisation policy each one declares with `@OrgPolicy`
(`src/decorators/orgPolicy.decorator.ts`). Regenerate it with:

```
npm run routes:policy -- --write
```

`src/route-policy/route-inventory.spec.ts` fails when this file is out of
date, and when a route has no policy.

## Proved and pending

A policy is a requirement on the routes that declare it. A route counts as
proved (`yes`) only when it names, with `@OrgPolicy(policy, { enforcedBy })`, a
spec file that exists and has the route's `METHOD /path` in the title of a test
that runs and calls `expect(` (the **Proved by** column); `public` routes show
`n/a`, because there is nothing to prove. That is a signpost: it shows that a
test naming the route exists and asserts something; whether its assertions are
sufficient is shown by mutation, not by the inventory. The pending routes are
pinned in `src/route-policy/pending-enforcement.snapshot.txt`.

Pending refers only to the organisation boundary; every route keeps the authentication and role guards shown in the Guards column.

Of **83** routes, **78** are proved by a spec, **5** are not applicable (public) and **0** are pending.

| Policy | Routes | Proved | Not applicable | Pending |
|---|---|---|---|---|
| public | 5 | 0 | 5 | 0 |
| learner | 42 | 42 | 0 | 0 |
| teacher | 32 | 32 | 0 | 0 |
| server | 3 | 3 | 0 | 0 |
| pi-import | 1 | 1 | 0 | 0 |
| **all** | **83** | **78** | **5** | **0** |

## Policies

Each policy states what a route that declares it must satisfy.

- `public`: Has no AccessGuard; reachable without authentication (rate limiting is not authentication). Returns nothing organisation-owned except what the request itself proves or what is deliberately published before sign-in (school branding).
- `learner`: Needs a signed-in school login. Acts only on the caller's own rows and on content in the learner's current enrolments that the token's organisation owns; other content answers as absent (404) and a submission writes nothing. A staff token that reaches the route is held to the school's curriculum list instead.
- `teacher`: Needs a school staff token (teacher, admin or super admin). Returns only learners of the token's school and content in that school's curriculum list that the token's organisation owns. A route that central also calls with the server sync key is marked as such and is scoped by the organisation header central sends; the header `platform` is the unscoped view and no header is refused.
- `server`: Authenticated only by central's server sync key. Carries no user; the organisation comes from the payload header, and a payload for another organisation's rows is refused.
- `pi-import`: The content import: central's server sync key online, and on a classroom Pi also a staff token. The organisation is the one in the payload header; on a Pi it must match the token's, and a token with no organisation is refused. Only one organisation's content (format 3) is accepted.

A route used by both a user token and the server key is classified by its user path; the key path is recorded separately.

## Columns

- **Proved**: `yes` when the route names a spec that proves it; `n/a` for `public` routes; `pending` otherwise.
- **Proved by**: for a route that is proved, the spec file named by `enforcedBy`.
- **Server key**: `yes` when every authentication guard on the route lets central's server sync key through, so a caller with no user gets in.
- **Staff only**: `yes` when an authentication guard lists school roles (teacher, admin, super admin), so a learner's token is refused.

Routes admitting the server key: 21.

## Routes

| Method | Path | Handler | Policy | Proved | Proved by | Server key | Staff only | Guards | Note |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/access` | AccessController.getStudentsOfflineOnline | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS) | A learner gets their own usage rows; staff get those of their school's learners. |
| POST | `/access` | AccessController.access | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS) | Records the caller's own usage; no other login's row is read or written. |
| GET | `/` | AppController.getbase | public | n/a |  |  |  | none |  |
| GET | `/version` | AppController.getversion | public | n/a |  |  |  | none |  |
| POST | `/auth/login` | AuthController.login | public | n/a |  |  |  | ThrottlerGuard | Refuses (401) a login whose school or organisation cannot be resolved or is suspended, except on a classroom Pi whose school has no organisation yet. |
| POST | `/auth/logout` | AuthController.logout | public | n/a |  |  |  | none | Reads the bearer token in the handler and ends only that token's own session. |
| GET | `/curriculum` | CurriculumController.getall | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS) |  |
| GET | `/curriculum/:curriculumbaselineid/getstudentresult` | CurriculumController.getStudentBaselineEndlineResults | teacher | yes | `src/modules/org-boundary.leak.spec.ts` | yes | yes | AccessOrServerSyncGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER), ReportScopeGuard | Central calls it with the server key; scoped by the organisation header, and by the school for a token. |
| GET | `/curriculum/:curriculumid` | CurriculumController.get | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(curriculum:curriculumid) |  |
| GET | `/curriculum/:curriculumid/map` | CurriculumController.getmap | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(curriculum:curriculumid) |  |
| GET | `/curriculum/all` | CurriculumController.getAllCurriculums | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS) | Learner, school and organisation come from the token; the query can only narrow inside them. |
| POST | `/curriculum/baseline/:curriculumid/:schoolname/:studentid` | CurriculumController.getCurriculumBaseline | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(curriculum:curriculumid) | The school and learner in the path are not read: the token's are. |
| GET | `/curriculum/subjects` | CurriculumController.getAllCurriculumsWithSubjects | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS) |  |
| GET | `/export/log` | ExportController.exportlog | teacher | yes | `src/modules/export-scope.leak.spec.ts` |  | yes | AccessGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER), ReportScopeGuard | log.ini holds only the caller's school's learners and logins; the server's own log files are added only on a classroom Pi. |
| GET | `/export/report-data` | ExportController.getReportData | teacher | yes | `src/modules/export-scope.leak.spec.ts` |  | yes | AccessGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER), ReportScopeGuard | A token gets its own school's rows; the server key is not admitted. The scope also resolves an organisation id or platform, which no caller can reach here. Same zip and file name, only the rows differ. |
| GET | `/export/system-log/files` | ExportController.exportfiles | teacher | yes | `src/modules/export-scope.leak.spec.ts` |  | yes | AccessGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER), ReportScopeGuard | The server's own log files are served only on a classroom Pi; elsewhere the answer is the one for a role that is not allowed. |
| GET | `/grade/all` | GradeController.getAllGrades | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), AccessGuard(ACCESS) | The curriculum, class and school in the query can only narrow inside the token's scope. |
| GET | `/grade/curriculum/:curriculumid` | GradeController.getgradesbycurriculumid | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(curriculum:curriculumid) |  |
| GET | `/grade/progress/curriculum/:curriculumid` | GradeController.getuesrgradesprogess | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(curriculum:curriculumid) |  |
| GET | `/grade/totalgradeprogress/:gradeid` | GradeController.totalgradeprogress | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(grade:gradeid) |  |
| PUT | `/import/master` | ImportController.completesync | pi-import | yes | `src/modules/org-boundary.leak.spec.ts` | yes | yes | ServerSyncGuard(Role.ADMIN, Role.SUPERADMIN, Role.TEACHER) | Payload header names the organisation; on a Pi it must match the token's claim, and a token with no claim is refused (the payload's rows are proved in src/modules/import). |
| PUT | `/import/ownership` | ImportController.ownership | server | yes | `src/modules/import/import.ownership.spec.ts` | yes |  | ServerSyncGuard() | Central's ownership push. |
| PUT | `/import/students` | ImportController.studentsimport | server | yes | `src/modules/import/import.roster.school.spec.ts` | yes |  | ServerSyncGuard() | Roster for one school; refuses rows of any other school (5c). |
| PUT | `/import/teachers` | ImportController.teachersimport | server | yes | `src/modules/import/import.roster.school.spec.ts` | yes |  | ServerSyncGuard() | Roster for one school; refuses rows of any other school (5c). |
| GET | `/Lesson/:lessonid/activities/progress` | LessonController.getlessonactivitiesprogress | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(lesson:lessonid) |  |
| GET | `/Lesson/:lessonid/progress` | LessonController.getuserlessonprogress | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(lesson:lessonid) |  |
| GET | `/Lesson/all` | LessonController.getAllLessons | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), AccessGuard(ACCESS) |  |
| GET | `/Lesson/level/:levelid` | LessonController.getlessonbylevelid | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(level:levelid) |  |
| GET | `/Lesson/level/:levelid/steps` | LessonController.getlevelactivitiesprogress | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(level:levelid) |  |
| GET | `/Lesson/progress/level/:levelid` | LessonController.getuserlessonsprogress | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(level:levelid) |  |
| GET | `/lesson/:lessonid/learning` | LessonLearningController.getlessonbricks | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(lesson:lessonid) |  |
| GET | `/lesson/:lessonid/learning/progress` | LessonLearningController.getalllearningprogress | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(lesson:lessonid) |  |
| GET | `/lesson/learning/:lessonlearningid` | LessonLearningController.getlearning | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(lessonlearning:lessonlearningid) |  |
| GET | `/lesson/learning/:lessonlearningid/progress` | LessonLearningController.getlearningprogress | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(lessonlearning:lessonlearningid) |  |
| POST | `/lesson/learning/:lessonlearningid/progress` | LessonLearningController.savelearningprogress | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(lessonlearning:lessonlearningid) |  |
| GET | `/lesson/plan/:lessonplanid` | LessonLearningController.getplan | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(lessonplan:lessonplanid) |  |
| GET | `/level/all` | LevelController.getAllLevels | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), AccessGuard(ACCESS) |  |
| GET | `/level/grade/:gradeid` | LevelController.getlevelsbygradeid | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(grade:gradeid) |  |
| GET | `/level/library` | LevelController.getlibrary | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), AccessGuard(ACCESS) |  |
| GET | `/level/progress/grade/:gradeid` | LevelController.getuserlevelsprogress | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(grade:gradeid) |  |
| GET | `/question/baseline/:curriculumbaselineid` | QuestionController.getbaselinequestion | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(baseline:curriculumbaselineid) |  |
| GET | `/question/lesson/:lessonid` | QuestionController.getlessonquestion | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(lesson:lessonid) |  |
| GET | `/question/level/:levelid` | QuestionController.getlevelquestion | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(level:levelid) |  |
| GET | `/question/level/:levelid/answers` | QuestionController.getlevelquestionanswers | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(level:levelid) |  |
| GET | `/question/practice/:lessonpracticeid` | QuestionController.getpracticequestion | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(lessonpractice:lessonpracticeid) |  |
| GET | `/question/quiz/:lessonquizid` | QuestionController.getquizquestion | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(lessonquiz:lessonquizid) |  |
| GET | `/report/offlineonline` | ReportController.getStudentsOfflineOnline | teacher | yes | `src/modules/org-boundary.leak.spec.ts` |  | yes | AccessGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER), ReportScopeGuard |  |
| POST | `/report/student-grade-progress` | ReportController.getStudentGradeProgress | teacher | yes | `src/modules/org-boundary.leak.spec.ts` | yes | yes | AccessOrServerSyncGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER), ReportScopeGuard | Central calls it with the server key and X-Organisation-Id; a token's scope is its school. |
| POST | `/report/student-lesson-progress` | ReportController.getStudentLessonProgress | teacher | yes | `src/modules/org-boundary.leak.spec.ts` | yes | yes | AccessOrServerSyncGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER), ReportScopeGuard | Central calls it with the server key and X-Organisation-Id; a token's scope is its school. |
| POST | `/report/student-level-progress` | ReportController.getStudentLevelProgress | teacher | yes | `src/modules/org-boundary.leak.spec.ts` | yes | yes | AccessOrServerSyncGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER), ReportScopeGuard | Central calls it with the server key and X-Organisation-Id; a token's scope is its school. |
| POST | `/report/studentlastcompletedquiz` | ReportController.getStudentsLastProgress | teacher | yes | `src/modules/org-boundary.leak.spec.ts` | yes | yes | AccessOrServerSyncGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER), ReportScopeGuard | Central calls it with the server key and X-Organisation-Id; a token's scope is its school. |
| POST | `/report/studentlastcompletedquiz/download` | ReportController.downloadOfflineCurrentLevel | teacher | yes | `src/modules/org-boundary.leak.spec.ts` | yes | yes | AccessOrServerSyncGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER), ReportScopeGuard | Central calls it with the server key and X-Organisation-Id; a token's scope is its school. |
| POST | `/report/studentlevelquiz` | ReportController.getLevelQuiz | teacher | yes | `src/modules/org-boundary.leak.spec.ts` | yes | yes | AccessOrServerSyncGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER), ReportScopeGuard | Central calls it with the server key and X-Organisation-Id; a token's scope is its school. |
| POST | `/report/studentlevelquiz/class` | ReportController.getClassLevelQuiz | teacher | yes | `src/modules/org-boundary.leak.spec.ts` | yes | yes | AccessOrServerSyncGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER), ReportScopeGuard | Central calls it with the server key and X-Organisation-Id; a token's scope is its school. |
| POST | `/report/studentlevelquiz/class/download` | ReportController.getClassLevelQuizzes | teacher | yes | `src/modules/org-boundary.leak.spec.ts` | yes | yes | AccessOrServerSyncGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER), ReportScopeGuard | Central calls it with the server key and X-Organisation-Id; a token's scope is its school. |
| POST | `/report/studentlevelquiz/download` | ReportController.getStudentsLevelQuizzes | teacher | yes | `src/modules/org-boundary.leak.spec.ts` | yes | yes | AccessOrServerSyncGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER), ReportScopeGuard | Central calls it with the server key and X-Organisation-Id; a token's scope is its school. |
| POST | `/report/studentprogress` | ReportController.getStudentsProgress | teacher | yes | `src/modules/org-boundary.leak.spec.ts` | yes | yes | AccessOrServerSyncGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER), ReportScopeGuard | Central calls it with the server key and X-Organisation-Id; a token's scope is its school. |
| POST | `/report/studentprogress/class` | ReportController.getClassProgress | teacher | yes | `src/modules/org-boundary.leak.spec.ts` | yes | yes | AccessOrServerSyncGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER), ReportScopeGuard | Central calls it with the server key and X-Organisation-Id; a token's scope is its school. |
| POST | `/report/studentprogress/class/download` | ReportController.getClassActivity | teacher | yes | `src/modules/org-boundary.leak.spec.ts` | yes | yes | AccessOrServerSyncGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER), ReportScopeGuard | Central calls it with the server key and X-Organisation-Id; a token's scope is its school. |
| POST | `/report/studentprogress/download` | ReportController.getStudentsQuizzes | teacher | yes | `src/modules/org-boundary.leak.spec.ts` | yes | yes | AccessOrServerSyncGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER), ReportScopeGuard | Central calls it with the server key and X-Organisation-Id; a token's scope is its school. |
| POST | `/report/studentstatus` | ReportController.getStudentStatus | teacher | yes | `src/modules/org-boundary.leak.spec.ts` | yes | yes | AccessOrServerSyncGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER), ReportScopeGuard | Central calls it with the server key and X-Organisation-Id; a token's scope is its school. |
| POST | `/report/studentstatus/download` | ReportController.getStudentsActivity | teacher | yes | `src/modules/org-boundary.leak.spec.ts` | yes | yes | AccessOrServerSyncGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER), ReportScopeGuard | Central calls it with the server key and X-Organisation-Id; a token's scope is its school. |
| POST | `/result/baseline/question/:curriculumbaselineid` | ResultController.savebaselineresult | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(baseline:curriculumbaselineid) | A submission for content outside the caller's scope writes nothing. |
| POST | `/result/lesson/practice/:lessonpracticeid` | ResultController.savelessonpracticeresult | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(lessonpractice:lessonpracticeid) | A submission for content outside the caller's scope writes nothing. |
| POST | `/result/lesson/quiz/:lessonquizid` | ResultController.savelessonquizresult | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(lessonquiz:lessonquizid) | A submission for content outside the caller's scope writes nothing. |
| POST | `/result/level/quiz/:levelid` | ResultController.savelevelquizresult | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS), ContentAccessGuard(level:levelid) | A submission for content outside the caller's scope writes nothing. |
| GET | `/school/branding` | SchoolController.getBranding | public | n/a |  |  |  | none | Resolves by school id: the school's own setting, else its organisation's, else the default. |
| GET | `/student/all` | StudentController.getAllCurriculums | teacher | yes | `src/modules/org-boundary.leak.spec.ts` |  | yes | AccessGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN) | The learners are the token's school's; a school in the query can only narrow that. |
| POST | `/student/logintime` | StudentController.getlogintime | learner | yes | `src/modules/org-boundary.leak.spec.ts` | yes |  | AccessOrServerSyncGuard(ACCESS), ReportScopeGuard | Central calls it with the server key; a learner token gets its own login only. |
| POST | `/student/profile` | StudentController.updatestudentprofile | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS) | Updates only the token's own learner record. |
| GET | `/student/progress` | StudentController.getStudentProgress | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS) |  |
| GET | `/student/progress/summary` | StudentController.getStudentProgressSummary | learner | yes | `src/modules/org-boundary.leak.spec.ts` |  |  | AccessGuard(ACCESS) |  |
| GET | `/teacher/profile` | TeacherController.getteacherprofile | teacher | yes | `src/modules/org-boundary.leak.spec.ts` |  | yes | AccessGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER) |  |
| GET | `/teacher/standard/all` | TeacherController.getAllLessons | teacher | yes | `src/modules/org-boundary.leak.spec.ts` |  | yes | AccessGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER), AccessGuard(ACCESS) |  |
| GET | `/teacher/standards` | TeacherController.getallstandards | teacher | yes | `src/modules/org-boundary.leak.spec.ts` |  | yes | AccessGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER) |  |
| GET | `/teacher/stats` | TeacherController.getallstats | teacher | yes | `src/modules/org-boundary.leak.spec.ts` |  | yes | AccessGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER) |  |
| GET | `/teacher/stats/student/:studentid` | TeacherController.getstudentstats | teacher | yes | `src/modules/org-boundary.leak.spec.ts` |  | yes | AccessGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER) |  |
| GET | `/teacher/stats/student/:studentid/level` | TeacherController.getstudentlevelstats | teacher | yes | `src/modules/org-boundary.leak.spec.ts` |  | yes | AccessGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER) |  |
| GET | `/teacher/stats/student/:studentid/practice` | TeacherController.getstudentpracticestats | teacher | yes | `src/modules/org-boundary.leak.spec.ts` |  | yes | AccessGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER) |  |
| GET | `/teacher/stats/student/:studentid/quiz` | TeacherController.getstudentquizstats | teacher | yes | `src/modules/org-boundary.leak.spec.ts` |  | yes | AccessGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER) |  |
| GET | `/teacher/studentinfo` | TeacherController.getStudentInfo | teacher | yes | `src/modules/org-boundary.leak.spec.ts` |  | yes | AccessGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER), AccessGuard(ACCESS) |  |
| POST | `/teacher/studentprogress` | TeacherController.getStudentsProgress | teacher | yes | `src/modules/org-boundary.leak.spec.ts` |  | yes | AccessGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER) |  |
| GET | `/teacher/students` | TeacherController.getallstudents | teacher | yes | `src/modules/org-boundary.leak.spec.ts` |  | yes | AccessGuard(ACCESS, Role.ADMIN, Role.SUPERADMIN, Role.TEACHER) |  |
