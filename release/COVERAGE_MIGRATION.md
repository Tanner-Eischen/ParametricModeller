# Coverage reporter migration

The release keeps Vitest and `@vitest/coverage-v8` 5.0.5 with Vite 8.3.5. It does
not restore an older test-tool lock to recover higher-looking percentages.

The old configuration required 78% branches, 74% functions, and 49% lines and
statements under Vitest 3.2.6. These remain the historical reporter profile, not
claims about the current reporter. All 1,120 tests passed in both isolated runs
below, using the exact same source commit
`10bb20c77e11b6295b0f3a7b1ade70d0172fff70`.

| Same-source metric | Original 3.2.6 / Vite 8.1.4 | 5.0.5 / Vite 8.3.5 | Current no-regression floor |
| --- | ---: | ---: | ---: |
| Branches | 78.19% | 51.82% | 51.8% |
| Functions | 87.33% | 63.54% | 63.5% |
| Statements | 66.53% | 62.50% | 62.5% |
| Lines | 66.53% | 63.65% | 63.6% |

The current floors are the observed same-source values rounded down to one
decimal place. This permits less than 0.1 percentage point (at most 0.099 at
three-decimal precision) of rounding slack. It does not exclude uncovered files
or assert improved code coverage. The configured inclusion remains
`src/**/*.ts`; the existing exclusions remain `src/main.ts`, `src/**/index.ts`
and `src/types/**`.

Vitest's [3.2 announcement](https://v3.vitest.dev/blog/vitest-3-2) describes
AST-aware V8 remapping as opt-in. The [4.0 migration guide](https://v4.vitest.dev/guide/migration.html)
makes that remapping the supported default and warns that coverage changes.
The comparison here measures the actual complete toolchain migration rather
than attributing every difference solely to Vitest. The
[baseline JSON](coverage-migration-baseline.json) retains exact covered/total
counts, source/archive identity, package-lock identity and private run-log hashes.
All 346 source, test and configuration files in the new-toolchain baseline were
checked against the original Git archive.

This change makes an existing gap visible: `src/App.ts` had zero Node unit-test
coverage in the initial 5.0.5 report, including 3,084 branches and 864 functions.
It remains in the report. The focused browser frame regression verifies actual
user behavior separately; it does not add those interactions to the Node
coverage percentage or certify every CAD tool.

The prepared frame and export tests initially raised the new reporter's results
to 52.10% branches and 63.85% functions. Later UI changes need their own final
coverage run and browser acceptance. Passing the floors means no measured
regression against this declared baseline, not closure of the legacy coverage
debt or a universal application-quality threshold.

An isolated trial of patched Vitest 3.2.7 also passed the historical percentages,
but its installed lock still had critical Tinypool findings and other advisories.
The [Tinypool advisory](https://github.com/advisories/GHSA-85c8-ppgw-ccpr) and
[mocker advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-qxg6-89mg-rqv8)
document those dependencies' affected ranges. At the initial audit, the prepared
5.0.5 lock had no high or critical findings, with ten moderate development-tool
findings remaining. These are dated observations, not a promise that later audit
results will stay unchanged or evidence of an exposed production browser API.
