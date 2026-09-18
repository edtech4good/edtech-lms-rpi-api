# Contributing

Thank you for your interest in contributing. This document explains the workflow and what to verify before opening a pull request.

How to get the code and run it locally

See the README. It covers installation, configuration, database setup and how to run the dev server.

Branch and pull request workflow

Branch from main with a descriptive name. Make your changes in that branch. When ready, push to your fork and open a pull request. The PR will be squash merged into main.

What to verify before opening a PR

Run the linter and formatter:

```bash
npm run lint
npm run format
```

If you made database changes, test the migration:

```bash
npm run db:migrate
```

Test data and one access token per user

If you add test data, include Khmer text. The product is taught in Khmer. Note that each user gets one access token at a time, so logging in from a second place ends the first session. Coordinate if you run multiple test suites.

Proving a new test can fail

If you add a test or assertion, break the thing it watches once and confirm it goes red before submitting the PR. A test that passes without the code it watches is decorative and reduces confidence in the suite.

This repo and edtech-lms-api share code by copy. If you fix something here, check whether the central API has the same bug.

License

By contributing to this project, you agree that your contributions will be licensed under the MIT License.
