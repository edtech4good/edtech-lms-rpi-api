# Where this project came from

This file is the same in every [edtech4good](https://github.com/edtech4good)
repository.

edtech4good is an open-source learning platform for classrooms that have
tablets but no reliable internet. It did not start as software. It started
as two university students from Sydney who thought forty thousand dollars
would build a school.

In 2005, Clary Castrission and Karyn Avery visited India and came home to
found the 40K Foundation. Five years and ten times the money later, the
Banyan School opened outside Bangalore. It worked, and it taught them that
building schools does not scale. So the foundation tried after-school
learning centres in villages, and found that the villages had no English
teachers. In 2015 it put the English curriculum on tablets instead. That
product was called 40K Plus.

The design has barely changed since. Low-cost Android tablets. A Raspberry
Pi on a router in the classroom, serving lessons over a local network with
no internet at all. Content carried in on a tablet and synced when a
connection appears. A local facilitator whose job is to keep learners
motivated, not to teach English. In 2017 MIT Solve selected 40K Plus as a
Solver in its Youth, Skills, and the Workforce of the Future challenge, and
it received the Atlassian Foundation and Australian DFAT prizes offered
through Solve. In 2018 it came to Cambodia as a pilot in government
schools, and in 2019 the foundation signed a memorandum of understanding
with the Ministry of Education, Youth and Sport. COVID interrupted it. In
2022 the foundation rebranded as Plus Education.

That year the Cambodian platform passed to a new steward, Glean Asia, a
Phnom Penh technology venture that built learning platforms for aid
programmes. The software was rebuilt from the ground up around the same
idea: a cloud console for curriculum, accounts and reporting, a small
classroom server for the school network, and a learner app in Khmer and
English that runs on Android, iOS and the web from one codebase.
Disability data was built into enrolment and every question type was given
audio. In October 2025 the whole platform was published on GitHub under the
MIT licence.

Glean Asia closed in 2026 and the platform is now owned and maintained by
Jesse Orndorff, who led its Cambodian team. Since then the work has been
what an inheritance needs: closing security gaps, making every service
start from an empty database, standing up a test environment, auditing the
code for public release, and keeping the dependencies current.

The reason it exists has not changed in twenty years. Some of the children
who most need to learn are in places where the internet is not, in a
language most software ignores, and some of them have disabilities that
most software never asks about. This platform was built for those
classrooms first. It is free to run, free to change, and open to anyone who
wants to help.
