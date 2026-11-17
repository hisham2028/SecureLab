# ADR 0003: Judge0 CE behind an execution adapter

- Status: Accepted (pending review on target hosting)
- Date: 2026-11-17

## Context

Student code is untrusted and must never run inside the API process or on a host with
production credentials. The roadmap asks for an execution spike covering compile errors, wrong
answers, infinite loops, memory exhaustion, filesystem access and network access before
committing to a provider.

## Decision

- Self-host Judge0 CE 1.13.1 in its own containers, with its own Postgres and Redis, on a
  separate network from SecureLab's data stores.
- The API only talks to Judge0 through `ExecutionProvider` (`apps/api/src/execution`), so a
  custom worker design can replace it later without touching grading code.
- Network is disabled by default and cannot be enabled per request (`ALLOW_ENABLE_NETWORK=false`).
- Pinned runtimes: C and C++ on GCC 9.2.0 (ids 50, 54), Python 3.8.1 (id 71). These ids must be
  stored with each exam from Phase 2 so re-evaluation is reproducible.

## Spike results (2026-11-17, `infra/judge-spike`)

9/9 cases behaved as expected with cpu 2s, wall 5s, memory 128 MB:

| Case                   | Result                                                                    |
| ---------------------- | ------------------------------------------------------------------------- |
| C correct answer       | Accepted                                                                  |
| C++ wrong answer       | Wrong Answer                                                              |
| C compile error        | Compilation Error                                                         |
| Python infinite loop   | Time Limit Exceeded at about 2.1s                                         |
| C++ memory bomb        | Killed at 128000 KB, classified as Memory Limit Exceeded                  |
| C fork bomb            | Time Limit Exceeded, process cap held                                     |
| Python reading secrets | No Judge0 or host secrets visible; `/proc/1/environ` absent; env is clean |
| Python network access  | Connection blocked                                                        |
| C unbounded output     | Killed by file-size limit                                                 |

## Consequences and follow-ups

- Judge0 1.13 needs privileged containers and cgroup v1. Many current hosts default to cgroup v2,
  so the production host must be chosen with this in mind (or the kernel booted with
  `systemd.unified_cgroup_hierarchy=0`). This is the largest operational risk of this choice.
- The sandbox can read the Judge0 image's own read-only system files (e.g. `/etc/passwd`). That
  is expected and harmless, but nothing sensitive may ever be placed on the Judge0 image or host.
- Judge0 reports memory kills as runtime errors; we classify a runtime error at 95% or more of the
  memory limit as MLE.
- Python 3.8 is end-of-life. Before the pilot, either build a custom Judge0 image with a current
  Python or accept 3.8 for the pilot explicitly.
- Hidden-test submissions (Phase 4) will use a queue and polling/callbacks instead of `wait=true`.
