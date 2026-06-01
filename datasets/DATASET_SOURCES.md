# DATASET_SOURCES.md — candidate sources to ADD to `datasets/`

**Task:** find high-quality, openly-licensed material to make the resident coding AIs
(Server A `qwen2.5-coder`, the tiny-LLM, and the API ensemble) better **programmers and
server admins**. This file is research output only — **nothing here was cloned or
downloaded**, and no other repo files were touched.

**Scope rule (inherited from `README.md` license posture):** only permissively-licensed /
public material. No commercial books (O'Reilly/Manning/Packt). For a corpus that an AI
*trains on* and whose briefs may be reused, **NonCommercial (CC BY-NC*) and copyleft-code
(GPL) licenses are treated as reference-only**, not clone-and-train — see the License
posture note at the end.

All licenses below were verified against the live LICENSE file / GitHub license API on
2026-06-01. Nothing here duplicates what's already staged (cookbooks anthropic/openai/
langchain, security-corpus OWASP/MITRE, crypto-books, crypto-protocols, ml-libs,
ml-courses, hive-devportal, chain-libs).

---

## 1. Code cookbooks / patterns / system design

| Name | Source | Teaches | License | Fits subfolder | Clone? |
|---|---|---|---|---|---|
| **The System Design Primer** | github.com/donnemartin/system-design-primer | How to design large-scale systems: caching, load balancing, sharding, CAP, queues, CDN; worked design problems w/ diagrams + Python OOD solutions | **CC BY 4.0** (confirmed in LICENSE.txt) | `cookbooks/system-design/` (new) | ✅ Safe |
| **Awesome Scalability** | github.com/binhnguyennus/awesome-scalability | Curated, annotated reading list of the patterns of scalable/reliable/performant systems — links + short explanations, the canonical scalability index | **MIT** | `cookbooks/system-design/` (new) | ✅ Safe |
| **python-patterns** | github.com/faif/python-patterns | Design patterns + idioms in Python (creational/structural/behavioral) as runnable code, plus anti-patterns | **License unclear** — no LICENSE/COPYING file in repo root, README states none | (would be `cookbooks/patterns/`) | ⚠️ Reference-only — do not clone until license clarified |
| **every-programmer-should-know** | github.com/mtdvio/every-programmer-should-know | Curated list of foundational technical knowledge every dev should have (algorithms, data, networking, security, distributed systems) | **CC BY 4.0** | `cookbooks/system-design/` (new) | ✅ Safe |

> Note on a popular near-miss: **kamranahmedse/developer-roadmap** is widely cited but its
> license (`NOASSERTION`) explicitly forbids reusing the *content* outside the repo without
> consent. **Reference-only — do not clone.**

---

## 2. Server / DevOps / Linux admin

| Name | Source | Teaches | License | Fits subfolder | Clone? |
|---|---|---|---|---|---|
| **The Art of Command Line** | github.com/jlevy/the-art-of-command-line | Single-page mastery of the Unix/Linux command line — pipelines, job control, text processing, one-liners, gotchas | **CC BY-SA 4.0** (confirmed in README) | `devops/` (new) | ✅ Safe (ShareAlike — keep attribution) |
| **The Book of Secret Knowledge** | github.com/trimstray/the-book-of-secret-knowledge | Huge curated index of sysadmin/netadmin/devops manuals, cheatsheets, CLI/web tools, one-liners | **MIT** | `devops/` (new) | ✅ Safe |
| **The Practical Linux Hardening Guide** | github.com/trimstray/the-practical-linux-hardening-guide | Step-by-step secure Linux production-system build; OpenSCAP, CIS/STIG, kernel/ssh/network hardening | **MIT** (confirmed in LICENSE.md) | `security-corpus/linux-hardening/` (fits existing security-corpus) | ✅ Safe |
| **iptables Essentials** | github.com/trimstray/iptables-essentials | Common firewall rules & commands reference | GPL-3.0 (per repo) | `devops/` (new) | ⚠️ Reference-only (copyleft; small, link instead) |
| **Awesome Sysadmin** | github.com/awesome-foss/awesome-sysadmin | Curated index of open-source sysadmin tooling by category (monitoring, backup, config-mgmt, DNS, mail, etc.) | **CC BY-SA 4.0** (confirmed in LICENSE.txt) | `devops/` (new) | ✅ Safe |
| **Ops School Curriculum** | github.com/opsschool/curriculum | Structured operations-engineer curriculum: sysadmin 101/201, init systems, package mgmt, networking, security, monitoring | **CC BY 3.0** (confirmed in LICENSE) | `devops/` (new) | ✅ Safe |
| **DevOps Exercises** | github.com/bregman-arie/devops-exercises | ~2600 Q&A across Linux, Docker, K8s, Ansible, Terraform, AWS/GCP/Azure, networking, SQL/NoSQL, SRE | **CC BY-NC 3.0** (NonCommercial — confirmed: LICENSE grants no commercial use, no Adaptation rights) | (would be `devops/`) | ⚠️ Reference-only — NonCommercial, do not put in a training corpus |
| **Docker docs** | github.com/docker/docs | Official Docker/Compose/Engine documentation source (Markdown) | **Apache-2.0** | `devops/docker/` (new) | ✅ Safe |
| **Kubernetes website/docs** | github.com/kubernetes/website | Official K8s concepts/tasks/reference docs (Markdown) — large | **CC BY 4.0** | `devops/kubernetes/` (new) | ✅ Safe (consider a docs-only subset; repo is big) |
| **Prometheus docs** | github.com/prometheus/docs | Monitoring/alerting concepts, PromQL, exporters — relevant to the watcher/alerting stack | **Apache-2.0** | `devops/` (new) | ✅ Safe |

> Note on Ansible: **ansible/ansible** is **GPL-3.0** (copyleft, and mostly source code
> rather than prose). For Ansible learning material prefer the CC-licensed curricula above
> (Ops School, DevOps Exercises) rather than cloning the Ansible source tree.

---

## 3. Language / runtime references (useful for this repo: Node.js, Python, bash)

| Name | Source | Teaches | License | Fits subfolder | Clone? |
|---|---|---|---|---|---|
| **Node.js Best Practices** | github.com/goldbergyoni/nodebestpractices | ~80 curated Node.js best practices: project structure, error handling, security, performance, testing, production — **directly applicable, this repo is Node.js** | **CC BY-SA 4.0** (confirmed in LICENSE) | `cookbooks/node-best-practices/` (new) | ✅ Safe (ShareAlike — keep attribution) |
| **Pure Bash Bible** | github.com/dylanaraps/pure-bash-bible | Pure-bash alternatives to external processes — string/array/file ops without forking; tightens the shell scripts this repo and Server A rely on | **MIT** | `devops/` (new) | ✅ Safe |
| **github/gitignore** | github.com/github/gitignore | Canonical `.gitignore` templates per language/tool — minor but useful reference for repo hygiene | **CC0-1.0** (public domain) | `devops/` (new) | ✅ Safe (optional/low-priority) |

> Python: the strongest openly-licensed Python *patterns* repo (faif/python-patterns) has an
> unclear license (see §1). The existing `cookbooks/openai` + `ml-libs` already carry a lot of
> practical Python. If a clean Python-idioms source is wanted, prefer the prose in
> **every-programmer-should-know** (CC BY 4.0) over cloning faif until its license is resolved.

---

## License posture (why some permissive-looking items are reference-only)

- **CC BY / CC BY-SA / MIT / Apache-2.0 / CC0** → safe to clone into the corpus. ShareAlike
  (BY-SA) items just require keeping attribution; that's already this repo's practice.
- **CC BY-NC\*** (NonCommercial — e.g. DevOps Exercises) → **reference-only.** The AIs'
  output (briefs, an eventual fine-tuned model) is part of a project that has a commercial
  blockchain dimension; a NonCommercial source is a license-hygiene risk in a training set.
- **GPL-3.0** (e.g. ansible/ansible, iptables-essentials) → reference-only. Copyleft on
  source code; not worth pulling a code tree into a prose corpus.
- **NOASSERTION / no LICENSE file** (developer-roadmap, faif/python-patterns) →
  reference-only until clarified. developer-roadmap *explicitly* restricts content reuse.

This mirrors the existing `README.md` rule ("Everything fetched ... is openly licensed
(MIT or Apache 2.0) and attributable") and extends it to handle the CC-NC and copyleft
cases this sweep surfaced.

---

## Prioritized fetch list (safe-to-clone only, highest value first)

1. **Node.js Best Practices** (CC BY-SA 4.0) → `cookbooks/node-best-practices/` —
   *this repo is Node.js; most directly actionable.*
2. **The Practical Linux Hardening Guide** (MIT) → `security-corpus/linux-hardening/` —
   *Server A / Bot host hardening; complements existing security-corpus.*
3. **The Art of Command Line** (CC BY-SA 4.0) → `devops/` — *baseline CLI competence.*
4. **The System Design Primer** (CC BY 4.0) → `cookbooks/system-design/` —
   *architecture vocabulary for the multi-server, multi-AI design.*
5. **Ops School Curriculum** (CC BY 3.0) → `devops/` — *structured server-admin spine.*
6. **The Book of Secret Knowledge** (MIT) → `devops/` — *broad sysadmin/devops index.*
7. **Pure Bash Bible** (MIT) → `devops/` — *hardens the repo's shell scripts.*
8. **Awesome Sysadmin** (CC BY-SA 4.0) → `devops/` — *tooling index by category.*
9. **Awesome Scalability** (MIT) → `cookbooks/system-design/` — *scalability reading index.*
10. **Docker docs** (Apache-2.0) → `devops/docker/` — *containerization reference.*
11. **every-programmer-should-know** (CC BY 4.0) → `cookbooks/system-design/` — *foundations index.*
12. **Prometheus docs** (Apache-2.0) → `devops/` — *monitoring/alerting; ties to the watcher.*
13. **Kubernetes docs** (CC BY 4.0) → `devops/kubernetes/` — *large; fetch a docs-only subset.*
14. **github/gitignore** (CC0) → `devops/` — *optional, low priority.*

**Reference-only (do NOT clone):** developer-roadmap (NOASSERTION, content-restricted);
DevOps Exercises (CC BY-NC 3.0); faif/python-patterns (no license file); ansible/ansible
and iptables-essentials (GPL-3.0).

---

*Suggested new subfolders if this list is acted on:* `cookbooks/system-design/`,
`cookbooks/node-best-practices/`, `devops/` (with `devops/docker/`, `devops/kubernetes/`),
and `security-corpus/linux-hardening/`. Standard intake stays the same as `README.md`:
`git clone --depth 1` + rsync filter to `.md`/`.mdx`/`.rst`, then re-index.
