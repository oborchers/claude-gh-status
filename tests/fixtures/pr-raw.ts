// Raw answers of PR_QUERY (list) and PR_DETAIL_QUERY (detail) for public
// cli/cli pull requests, trimmed to a few checks, plus copies edited by hand
// for states no public pull request shows right now (merge queue, behind,
// running, status contexts...). No private repository content.

export const prGreen = {
  list: {
    data: {
      repository: {
        mergeCommitAllowed: true,
        squashMergeAllowed: true,
        rebaseMergeAllowed: true,
        pullRequests: {
          nodes: [
            {
              id: 'PR_kwDODKw3uc8AAAABGVY_uA',
              number: 14580,
              state: 'OPEN',
              updatedAt: '2026-10-09T19:41:02Z',
              headRepositoryOwner: {
                login: 'cli',
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4948,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
  detail: {
    data: {
      node: {
        id: 'PR_kwDODKw3uc8AAAABGVY_uA',
        number: 14580,
        state: 'OPEN',
        title: '`gh issue artifact` stack 10/12: Add `edit --restore-version`',
        url: 'https://github.com/cli/cli/pull/14580',
        isDraft: false,
        headRefName: 'bagtoad/artifact-restore-version',
        headRefOid: '5f85ec828f6d2fe28d81ba71a61b8a2181edfb6a',
        baseRefName: 'bagtoad/artifact-skill-docs',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        reviewDecision: 'APPROVED',
        isInMergeQueue: false,
        isMergeQueueEnabled: false,
        mergeQueueEntry: null,
        autoMergeRequest: null,
        viewerCanMergeAsAdmin: false,
        reviewRequests: {
          nodes: [
            {
              requestedReviewer: {
                __typename: 'User',
                login: 'babakks',
              },
            },
          ],
        },
        latestReviews: {
          nodes: [],
        },
        reviewThreads: {
          nodes: [],
        },
        comments: {
          totalCount: 1,
          nodes: [
            {
              author: {
                login: 'elopezgomez567-stack',
              },
              createdAt: '2026-10-09T19:28:16Z',
              url: 'https://github.com/cli/cli/pull/14580#issuecomment-6087801801',
            },
          ],
        },
        commits: {
          nodes: [
            {
              commit: {
                oid: '5f85ec828f6d2fe28d81ba71a61b8a2181edfb6a',
                statusCheckRollup: {
                  state: 'SUCCESS',
                  contexts: {
                    nodes: [
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975750353,
                        name: 'build (ubuntu-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:50Z',
                        completedAt: '2026-10-02T18:41:14Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048500399/job/110975750353',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048500399,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975750632,
                        name: 'build (windows-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:51Z',
                        completedAt: '2026-10-02T18:46:20Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048500399/job/110975750632',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048500399,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975750617,
                        name: 'build (macos-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:56Z',
                        completedAt: '2026-10-02T18:43:20Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048500399/job/110975750617',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048500399,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110976263673,
                        name: 'label-external',
                        status: 'COMPLETED',
                        conclusion: 'SKIPPED',
                        startedAt: '2026-10-02T18:37:12Z',
                        completedAt: '2026-10-02T18:37:02Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048637304/job/110976263673',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048637304,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 113994276447,
                        name: 'label-external',
                        status: 'COMPLETED',
                        conclusion: 'SKIPPED',
                        startedAt: '2026-10-09T19:41:16Z',
                        completedAt: '2026-10-09T19:41:07Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37981895366/job/113994276447',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37981895366,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975885942,
                        name: 'CodeQL-Build (go, manual, ./.github/codeql/codeql-config.yml)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:36:14Z',
                        completedAt: '2026-10-02T18:39:08Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048540763/job/110975885942',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048540763,
                            workflow: {
                              name: 'Code Scanning',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975749770,
                        name: 'lint',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:50Z',
                        completedAt: '2026-10-02T18:38:21Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048500199/job/110975749770',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048500199,
                            workflow: {
                              name: 'Lint',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975754383,
                        name: 'label-external / label_issues',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:51Z',
                        completedAt: '2026-10-02T18:35:53Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048501155/job/110975754383',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048501155,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4947,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
}

export const prFailing = {
  list: {
    data: {
      repository: {
        mergeCommitAllowed: true,
        squashMergeAllowed: true,
        rebaseMergeAllowed: true,
        pullRequests: {
          nodes: [
            {
              id: 'PR_kwDODKw3uc8AAAABHmdU4g',
              number: 14640,
              state: 'OPEN',
              updatedAt: '2026-10-09T20:04:39Z',
              headRepositoryOwner: {
                login: 'cli',
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4946,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
  detail: {
    data: {
      node: {
        id: 'PR_kwDODKw3uc8AAAABHmdU4g',
        number: 14640,
        state: 'OPEN',
        title: '`gh issue artifact` stack 11/12: Address review feedback',
        url: 'https://github.com/cli/cli/pull/14640',
        isDraft: false,
        headRefName: 'bagtoad/artifact-review-feedback',
        headRefOid: '6ea10e3fa9998797e9ccea325272b9d9c02e0993',
        baseRefName: 'bagtoad/artifact-restore-version',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'BLOCKED',
        reviewDecision: 'REVIEW_REQUIRED',
        isInMergeQueue: false,
        isMergeQueueEnabled: false,
        mergeQueueEntry: null,
        autoMergeRequest: null,
        viewerCanMergeAsAdmin: false,
        reviewRequests: {
          nodes: [
            {
              requestedReviewer: {
                __typename: 'User',
                login: 'sergiou87',
              },
            },
            {
              requestedReviewer: {
                __typename: 'User',
                login: 'babakks',
              },
            },
          ],
        },
        latestReviews: {
          nodes: [
            {
              author: {
                login: 'copilot-pull-request-reviewer',
              },
              state: 'COMMENTED',
              submittedAt: '2026-10-09T19:45:56Z',
            },
          ],
        },
        reviewThreads: {
          nodes: [],
        },
        comments: {
          totalCount: 0,
          nodes: [],
        },
        commits: {
          nodes: [
            {
              commit: {
                oid: '6ea10e3fa9998797e9ccea325272b9d9c02e0993',
                statusCheckRollup: {
                  state: 'FAILURE',
                  contexts: {
                    nodes: [
                      {
                        __typename: 'CheckRun',
                        databaseId: 113993700595,
                        name: 'build (ubuntu-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-09T19:39:50Z',
                        completedAt: '2026-10-09T19:45:17Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37981740019/job/113993700595',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37981740019,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 113993700428,
                        name: 'build (windows-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-09T19:39:50Z',
                        completedAt: '2026-10-09T19:53:12Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37981740019/job/113993700428',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37981740019,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 113993700229,
                        name: 'build (macos-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-09T19:39:55Z',
                        completedAt: '2026-10-09T19:47:45Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37981740019/job/113993700229',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37981740019,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 113993700082,
                        name: 'govulncheck',
                        status: 'COMPLETED',
                        conclusion: 'FAILURE',
                        startedAt: '2026-10-09T19:39:49Z',
                        completedAt: '2026-10-09T19:40:22Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37981739982/job/113993700082',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37981739982,
                            workflow: {
                              name: 'Lint',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 114003183767,
                        name: 'label-external',
                        status: 'COMPLETED',
                        conclusion: 'SKIPPED',
                        startedAt: '2026-10-09T20:04:53Z',
                        completedAt: '2026-10-09T20:04:44Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37984544492/job/114003183767',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37984544492,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 113993892404,
                        name: 'CodeQL-Build (go, manual, ./.github/codeql/codeql-config.yml)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-09T19:40:19Z',
                        completedAt: '2026-10-09T19:43:10Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37981797308/job/113993892404',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37981797308,
                            workflow: {
                              name: 'Code Scanning',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 113993699722,
                        name: 'lint',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-09T19:39:50Z',
                        completedAt: '2026-10-09T19:42:33Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37981739982/job/113993699722',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37981739982,
                            workflow: {
                              name: 'Lint',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 113993704295,
                        name: 'label-external / label_issues',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-09T19:39:50Z',
                        completedAt: '2026-10-09T19:39:52Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37981740660/job/113993704295',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37981740660,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4945,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
}

export const prConflicting = {
  list: {
    data: {
      repository: {
        mergeCommitAllowed: true,
        squashMergeAllowed: true,
        rebaseMergeAllowed: true,
        pullRequests: {
          nodes: [
            {
              id: 'PR_kwDODKw3uc8AAAABDiVs1A',
              number: 14450,
              state: 'OPEN',
              updatedAt: '2026-10-02T12:59:33Z',
              headRepositoryOwner: {
                login: 'cli',
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4942,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
  detail: {
    data: {
      node: {
        id: 'PR_kwDODKw3uc8AAAABDiVs1A',
        number: 14450,
        state: 'OPEN',
        title: 'Refreshable tokens (1/7): foundation credential model, storage migration, and file lock',
        url: 'https://github.com/cli/cli/pull/14450',
        isDraft: false,
        headRefName: 'babakks/refresh-token-a-foundation',
        headRefOid: 'a6435ab5c852bd86dc2d7d5f5367dc5f65930627',
        baseRefName: 'trunk',
        mergeable: 'CONFLICTING',
        mergeStateStatus: 'DIRTY',
        reviewDecision: 'REVIEW_REQUIRED',
        isInMergeQueue: false,
        isMergeQueueEnabled: false,
        mergeQueueEntry: null,
        autoMergeRequest: null,
        viewerCanMergeAsAdmin: false,
        reviewRequests: {
          nodes: [
            {
              requestedReviewer: {
                __typename: 'User',
                login: 'niik',
              },
            },
          ],
        },
        latestReviews: {
          nodes: [
            {
              author: {
                login: 'williammartin',
              },
              state: 'COMMENTED',
              submittedAt: '2026-10-02T12:54:17Z',
            },
            {
              author: {
                login: 'copilot-pull-request-reviewer',
              },
              state: 'COMMENTED',
              submittedAt: '2026-09-15T01:33:17Z',
            },
          ],
        },
        reviewThreads: {
          nodes: [
            {
              isResolved: false,
              isOutdated: false,
              path: 'api/http_client.go',
              line: 19,
              comments: {
                nodes: [
                  {
                    author: {
                      login: 'williammartin',
                    },
                    createdAt: '2026-10-02T10:58:06Z',
                    url: 'https://github.com/cli/cli/pull/14450#discussion_r4165089565',
                  },
                ],
              },
            },
            {
              isResolved: true,
              isOutdated: false,
              path: 'internal/flock/flock.go',
              line: 32,
              comments: {
                nodes: [
                  {
                    author: {
                      login: 'copilot-pull-request-reviewer',
                    },
                    createdAt: '2026-09-15T01:33:17Z',
                    url: 'https://github.com/cli/cli/pull/14450#discussion_r4011115291',
                  },
                ],
              },
            },
            {
              isResolved: false,
              isOutdated: false,
              path: 'internal/config/config.go',
              line: 270,
              comments: {
                nodes: [
                  {
                    author: {
                      login: 'williammartin',
                    },
                    createdAt: '2026-10-02T12:54:17Z',
                    url: 'https://github.com/cli/cli/pull/14450#discussion_r4165888892',
                  },
                ],
              },
            },
            {
              isResolved: false,
              isOutdated: false,
              path: 'internal/gh/gh.go',
              line: 188,
              comments: {
                nodes: [
                  {
                    author: {
                      login: 'williammartin',
                    },
                    createdAt: '2026-10-02T12:54:17Z',
                    url: 'https://github.com/cli/cli/pull/14450#discussion_r4165888905',
                  },
                ],
              },
            },
            {
              isResolved: false,
              isOutdated: false,
              path: 'internal/gh/gh.go',
              line: 173,
              comments: {
                nodes: [
                  {
                    author: {
                      login: 'williammartin',
                    },
                    createdAt: '2026-10-02T12:54:17Z',
                    url: 'https://github.com/cli/cli/pull/14450#discussion_r4165888915',
                  },
                ],
              },
            },
          ],
        },
        comments: {
          totalCount: 0,
          nodes: [],
        },
        commits: {
          nodes: [
            {
              commit: {
                oid: 'a6435ab5c852bd86dc2d7d5f5367dc5f65930627',
                statusCheckRollup: {
                  state: 'SUCCESS',
                  contexts: {
                    nodes: [
                      {
                        __typename: 'CheckRun',
                        databaseId: 110847452512,
                        name: 'build (ubuntu-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T12:59:43Z',
                        completedAt: '2026-10-02T13:04:47Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37010078502/job/110847452512',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37010078502,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110847452364,
                        name: 'build (windows-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T12:59:43Z',
                        completedAt: '2026-10-02T13:09:33Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37010078502/job/110847452364',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37010078502,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110847452591,
                        name: 'build (macos-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T12:59:49Z',
                        completedAt: '2026-10-02T13:07:39Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37010078502/job/110847452591',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37010078502,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110847452481,
                        name: 'CodeQL-Build (go, manual, ./.github/codeql/codeql-config.yml)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T12:59:43Z',
                        completedAt: '2026-10-02T13:02:44Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37010078495/job/110847452481',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37010078495,
                            workflow: {
                              name: 'Code Scanning',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110847457727,
                        name: 'lint',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T12:59:44Z',
                        completedAt: '2026-10-02T13:01:36Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37010078491/job/110847457727',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37010078491,
                            workflow: {
                              name: 'Lint',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110847452315,
                        name: 'CodeQL-Build (actions, none, security-and-quality)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T12:59:44Z',
                        completedAt: '2026-10-02T13:00:26Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37010078495/job/110847452315',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37010078495,
                            workflow: {
                              name: 'Code Scanning',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110847457479,
                        name: 'govulncheck',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T13:00:20Z',
                        completedAt: '2026-10-02T13:01:11Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37010078491/job/110847457479',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37010078491,
                            workflow: {
                              name: 'Lint',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110847452613,
                        name: 'integration-tests (ubuntu-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T12:59:44Z',
                        completedAt: '2026-10-02T13:01:28Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37010078502/job/110847452613',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37010078502,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4941,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
}

export const prDraft = {
  list: {
    data: {
      repository: {
        mergeCommitAllowed: true,
        squashMergeAllowed: true,
        rebaseMergeAllowed: true,
        pullRequests: {
          nodes: [
            {
              id: 'PR_kwDODKw3uc8AAAABCOVfjg',
              number: 14355,
              state: 'OPEN',
              updatedAt: '2026-09-04T15:50:28Z',
              headRepositoryOwner: {
                login: 'cli',
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4940,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
  detail: {
    data: {
      node: {
        id: 'PR_kwDODKw3uc8AAAABCOVfjg',
        number: 14355,
        state: 'OPEN',
        title: 'Remove obsolete Git test seams',
        url: 'https://github.com/cli/cli/pull/14355',
        isDraft: true,
        headRefName: 'williammartin-clean-git-test-seams',
        headRefOid: '7adb2541716f52964d46143be7877d69c6d9f457',
        baseRefName: 'williammartin-improve-git-tests',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'BLOCKED',
        reviewDecision: 'REVIEW_REQUIRED',
        isInMergeQueue: false,
        isMergeQueueEnabled: false,
        mergeQueueEntry: null,
        autoMergeRequest: null,
        viewerCanMergeAsAdmin: false,
        reviewRequests: {
          nodes: [],
        },
        latestReviews: {
          nodes: [],
        },
        reviewThreads: {
          nodes: [],
        },
        comments: {
          totalCount: 0,
          nodes: [],
        },
        commits: {
          nodes: [
            {
              commit: {
                oid: '7adb2541716f52964d46143be7877d69c6d9f457',
                statusCheckRollup: {
                  state: 'SUCCESS',
                  contexts: {
                    nodes: [
                      {
                        __typename: 'CheckRun',
                        databaseId: 101084938373,
                        name: 'build (ubuntu-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-09-04T15:50:35Z',
                        completedAt: '2026-09-04T15:55:39Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/33891784710/job/101084938373',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 33891784710,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 101084938041,
                        name: 'build (windows-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-09-04T15:50:37Z',
                        completedAt: '2026-09-04T15:59:54Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/33891784710/job/101084938041',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 33891784710,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 101084938495,
                        name: 'build (macos-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-09-04T15:50:36Z',
                        completedAt: '2026-09-04T15:57:15Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/33891784710/job/101084938495',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 33891784710,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 101084938643,
                        name: 'lint',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-09-04T15:50:35Z',
                        completedAt: '2026-09-04T15:52:57Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/33891784819/job/101084938643',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 33891784819,
                            workflow: {
                              name: 'Lint',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 101084940387,
                        name: 'label-external / label_issues',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-09-04T15:50:36Z',
                        completedAt: '2026-09-04T15:50:39Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/33891785341/job/101084940387',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 33891785341,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 101084970599,
                        name: 'close-from-default-branch / close-from-default-branch',
                        status: 'COMPLETED',
                        conclusion: 'SKIPPED',
                        startedAt: '2026-09-04T15:50:38Z',
                        completedAt: '2026-09-04T15:50:32Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/33891785341/job/101084970599',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 33891785341,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 101084938426,
                        name: 'govulncheck',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-09-04T15:50:35Z',
                        completedAt: '2026-09-04T15:51:02Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/33891784819/job/101084938426',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 33891784819,
                            workflow: {
                              name: 'Lint',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 101084938440,
                        name: 'integration-tests (ubuntu-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-09-04T15:50:35Z',
                        completedAt: '2026-09-04T15:52:08Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/33891784710/job/101084938440',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 33891784710,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4998,
        resetAt: '2026-10-12T08:54:43Z',
      },
    },
  },
}

export const prMerged = {
  list: {
    data: {
      repository: {
        mergeCommitAllowed: true,
        squashMergeAllowed: true,
        rebaseMergeAllowed: true,
        pullRequests: {
          nodes: [
            {
              id: 'PR_kwDODKw3uc8AAAABHjEfXg',
              number: 14634,
              state: 'MERGED',
              updatedAt: '2026-10-09T14:47:47Z',
              headRepositoryOwner: {
                login: 'cli',
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4996,
        resetAt: '2026-10-12T08:54:43Z',
      },
    },
  },
  detail: {
    data: {
      node: {
        id: 'PR_kwDODKw3uc8AAAABHjEfXg',
        number: 14634,
        state: 'MERGED',
        title: 'chore(deps): bump github.com/mattn/go-colorable from 0.1.15 to 0.1.16',
        url: 'https://github.com/cli/cli/pull/14634',
        isDraft: false,
        headRefName: 'dependabot/go_modules/github.com/mattn/go-colorable-0.1.16',
        headRefOid: '424f38df651e0b178d752073859af7ee1d3d02c3',
        baseRefName: 'trunk',
        mergeable: 'UNKNOWN',
        mergeStateStatus: 'UNKNOWN',
        reviewDecision: 'APPROVED',
        isInMergeQueue: false,
        isMergeQueueEnabled: false,
        mergeQueueEntry: null,
        autoMergeRequest: null,
        viewerCanMergeAsAdmin: false,
        reviewRequests: {
          nodes: [
            {
              requestedReviewer: {
                __typename: 'User',
                login: 'tidy-dev',
              },
            },
          ],
        },
        latestReviews: {
          nodes: [
            {
              author: {
                login: 'williammartin',
              },
              state: 'APPROVED',
              submittedAt: '2026-10-09T14:33:25Z',
            },
          ],
        },
        reviewThreads: {
          nodes: [],
        },
        comments: {
          totalCount: 0,
          nodes: [],
        },
        commits: {
          nodes: [
            {
              commit: {
                oid: '424f38df651e0b178d752073859af7ee1d3d02c3',
                statusCheckRollup: {
                  state: 'SUCCESS',
                  contexts: {
                    nodes: [
                      {
                        __typename: 'CheckRun',
                        databaseId: 113856283534,
                        name: 'build (ubuntu-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-09T14:03:39Z',
                        completedAt: '2026-10-09T14:08:18Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37941364158/job/113856283534',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37941364158,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 113856283158,
                        name: 'build (windows-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-09T14:03:39Z',
                        completedAt: '2026-10-09T14:12:52Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37941364158/job/113856283158',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37941364158,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 113856283371,
                        name: 'build (macos-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-09T14:03:46Z',
                        completedAt: '2026-10-09T14:10:38Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37941364158/job/113856283371',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37941364158,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 113856298508,
                        name: 'label-external',
                        status: 'COMPLETED',
                        conclusion: 'SKIPPED',
                        startedAt: '2026-10-09T14:03:38Z',
                        completedAt: '2026-10-09T14:03:37Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37941367059/job/113856298508',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37941367059,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 113856301536,
                        name: 'label-external',
                        status: 'COMPLETED',
                        conclusion: 'SKIPPED',
                        startedAt: '2026-10-09T14:03:38Z',
                        completedAt: '2026-10-09T14:03:38Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37941367784/job/113856301536',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37941367784,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 113868978993,
                        name: 'CodeQL-Build (go, manual, ./.github/codeql/codeql-config.yml)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-09T14:33:16Z',
                        completedAt: '2026-10-09T14:36:46Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37941363988/job/113868978993',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37941363988,
                            workflow: {
                              name: 'Code Scanning',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 113856284125,
                        name: 'lint',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-09T14:03:39Z',
                        completedAt: '2026-10-09T14:06:31Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37941364079/job/113856284125',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37941364079,
                            workflow: {
                              name: 'Lint',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 113856278638,
                        name: 'label-external / label_issues',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-09T14:03:39Z',
                        completedAt: '2026-10-09T14:03:43Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37941362174/job/113856278638',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37941362174,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4938,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
}

export const prClosed = {
  list: {
    data: {
      repository: {
        mergeCommitAllowed: true,
        squashMergeAllowed: true,
        rebaseMergeAllowed: true,
        pullRequests: {
          nodes: [
            {
              id: 'PR_kwDODKw3uc8AAAABH0cSjA',
              number: 14646,
              state: 'CLOSED',
              updatedAt: '2026-10-11T23:03:09Z',
              headRepositoryOwner: {
                login: '735yarik',
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4995,
        resetAt: '2026-10-12T08:54:43Z',
      },
    },
  },
  detail: {
    data: {
      node: {
        id: 'PR_kwDODKw3uc8AAAABH0cSjA',
        number: 14646,
        state: 'CLOSED',
        title: 'fix(pr): resolve cross-repo PRs when branch selector tracks a fork remote',
        url: 'https://github.com/cli/cli/pull/14646',
        isDraft: false,
        headRefName: 'fix/pr-view-cross-repo-branch',
        headRefOid: 'd66cf17f11de3f254a290c1e39081e3efc21f39f',
        baseRefName: 'trunk',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'BLOCKED',
        reviewDecision: 'REVIEW_REQUIRED',
        isInMergeQueue: false,
        isMergeQueueEnabled: false,
        mergeQueueEntry: null,
        autoMergeRequest: null,
        viewerCanMergeAsAdmin: false,
        reviewRequests: {
          nodes: [
            {
              requestedReviewer: null,
            },
            {
              requestedReviewer: {
                __typename: 'User',
                login: 'sergiou87',
              },
            },
          ],
        },
        latestReviews: {
          nodes: [],
        },
        reviewThreads: {
          nodes: [],
        },
        comments: {
          totalCount: 1,
          nodes: [
            {
              author: {
                login: 'github-actions',
              },
              createdAt: '2026-10-11T14:19:21Z',
              url: 'https://github.com/cli/cli/pull/14646#issuecomment-6109972773',
            },
          ],
        },
        commits: {
          nodes: [
            {
              commit: {
                oid: 'd66cf17f11de3f254a290c1e39081e3efc21f39f',
                statusCheckRollup: {
                  state: 'SUCCESS',
                  contexts: {
                    nodes: [
                      {
                        __typename: 'CheckRun',
                        databaseId: 114491430542,
                        name: 'label-external / label_issues',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-11T14:19:14Z',
                        completedAt: '2026-10-11T14:19:18Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/38146688640/job/114491430542',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 38146688640,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 114491431657,
                        name: 'close-from-default-branch / close-from-default-branch',
                        status: 'COMPLETED',
                        conclusion: 'SKIPPED',
                        startedAt: '2026-10-11T14:19:12Z',
                        completedAt: '2026-10-11T14:19:11Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/38146688640/job/114491431657',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 38146688640,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 114491430599,
                        name: 'check-requirements / check-requirements',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-11T14:19:14Z',
                        completedAt: '2026-10-11T14:19:23Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/38146688640/job/114491430599',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 38146688640,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 114491431341,
                        name: 'check-requirements / close-unmet-requirements',
                        status: 'COMPLETED',
                        conclusion: 'SKIPPED',
                        startedAt: '2026-10-11T14:19:12Z',
                        completedAt: '2026-10-11T14:19:11Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/38146688640/job/114491431341',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 38146688640,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4937,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
}

export const prForks = {
  list: {
    data: {
      repository: {
        mergeCommitAllowed: true,
        squashMergeAllowed: true,
        rebaseMergeAllowed: true,
        pullRequests: {
          nodes: [
            {
              id: 'PR_kwDODKw3uc8AAAABGOLWpg',
              number: 14575,
              state: 'CLOSED',
              updatedAt: '2026-10-02T05:06:00Z',
              headRepositoryOwner: {
                login: 'gaelreyes0318-netizen',
              },
            },
            {
              id: 'PR_kwDODKw3uc8AAAABFAOUkw',
              number: 14515,
              state: 'CLOSED',
              updatedAt: '2026-09-24T20:34:20Z',
              headRepositoryOwner: {
                login: 'DynamoIVII',
              },
            },
            {
              id: 'PR_kwDODKw3uc8AAAABCgasxg',
              number: 14373,
              state: 'OPEN',
              updatedAt: '2026-09-07T13:43:01Z',
              headRepositoryOwner: {
                login: 'acoulton',
              },
            },
            {
              id: 'PR_kwDODKw3uc5j0ROB',
              number: 8558,
              state: 'CLOSED',
              updatedAt: '2026-09-03T15:20:56Z',
              headRepositoryOwner: {
                login: 'imjasonh',
              },
            },
            {
              id: 'PR_kwDODKw3uc5kt-b8',
              number: 8607,
              state: 'MERGED',
              updatedAt: '2026-09-03T15:20:54Z',
              headRepositoryOwner: {
                login: 'Xeonacid',
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4936,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
  detail: {
    data: {
      node: {
        id: 'PR_kwDODKw3uc8AAAABCgasxg',
        number: 14373,
        state: 'OPEN',
        title: 'docs: Add step to install working version on Ubuntu Pro',
        url: 'https://github.com/cli/cli/pull/14373',
        isDraft: false,
        headRefName: 'patch-1',
        headRefOid: '682398a89f408d305fba87c2be1c25864aab4077',
        baseRefName: 'trunk',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'BLOCKED',
        reviewDecision: 'REVIEW_REQUIRED',
        isInMergeQueue: false,
        isMergeQueueEnabled: false,
        mergeQueueEntry: null,
        autoMergeRequest: null,
        viewerCanMergeAsAdmin: false,
        reviewRequests: {
          nodes: [
            {
              requestedReviewer: null,
            },
            {
              requestedReviewer: {
                __typename: 'User',
                login: 'sergiou87',
              },
            },
            {
              requestedReviewer: {
                __typename: 'User',
                login: 'babakks',
              },
            },
          ],
        },
        latestReviews: {
          nodes: [],
        },
        reviewThreads: {
          nodes: [],
        },
        comments: {
          totalCount: 1,
          nodes: [
            {
              author: {
                login: 'github-actions',
              },
              createdAt: '2026-09-07T10:43:40Z',
              url: 'https://github.com/cli/cli/pull/14373#issuecomment-5569431834',
            },
          ],
        },
        commits: {
          nodes: [
            {
              commit: {
                oid: '682398a89f408d305fba87c2be1c25864aab4077',
                statusCheckRollup: {
                  state: 'SUCCESS',
                  contexts: {
                    nodes: [
                      {
                        __typename: 'CheckRun',
                        databaseId: 101713071007,
                        name: 'label-external / label_issues',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-09-07T10:43:34Z',
                        completedAt: '2026-09-07T10:43:38Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/34112933648/job/101713071007',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 34112933648,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 101713071958,
                        name: 'close-from-default-branch / close-from-default-branch',
                        status: 'COMPLETED',
                        conclusion: 'SKIPPED',
                        startedAt: '2026-09-07T10:43:31Z',
                        completedAt: '2026-09-07T10:43:31Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/34112933648/job/101713071958',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 34112933648,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 101713071105,
                        name: 'check-requirements / check-requirements',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-09-07T10:43:34Z',
                        completedAt: '2026-09-07T10:43:42Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/34112933648/job/101713071105',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 34112933648,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 101713072238,
                        name: 'check-requirements / close-unmet-requirements',
                        status: 'COMPLETED',
                        conclusion: 'SKIPPED',
                        startedAt: '2026-09-07T10:43:31Z',
                        completedAt: '2026-09-07T10:43:31Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/34112933648/job/101713072238',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 34112933648,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4931,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
}

export const prMergeQueue = {
  list: {
    data: {
      repository: {
        mergeCommitAllowed: true,
        squashMergeAllowed: true,
        rebaseMergeAllowed: true,
        pullRequests: {
          nodes: [
            {
              id: 'PR_kwDODKw3uc8AAAABGVY_uA',
              number: 14580,
              state: 'OPEN',
              updatedAt: '2026-10-09T19:41:02Z',
              headRepositoryOwner: {
                login: 'cli',
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4948,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
  detail: {
    data: {
      node: {
        id: 'PR_kwDODKw3uc8AAAABGVY_uA',
        number: 14580,
        state: 'OPEN',
        title: '`gh issue artifact` stack 10/12: Add `edit --restore-version`',
        url: 'https://github.com/cli/cli/pull/14580',
        isDraft: false,
        headRefName: 'bagtoad/artifact-restore-version',
        headRefOid: '5f85ec828f6d2fe28d81ba71a61b8a2181edfb6a',
        baseRefName: 'bagtoad/artifact-skill-docs',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        reviewDecision: 'APPROVED',
        isInMergeQueue: true,
        isMergeQueueEnabled: true,
        mergeQueueEntry: {
          position: 2,
          state: 'AWAITING_CHECKS',
          estimatedTimeToMerge: 540,
        },
        autoMergeRequest: null,
        viewerCanMergeAsAdmin: false,
        reviewRequests: {
          nodes: [
            {
              requestedReviewer: {
                __typename: 'User',
                login: 'babakks',
              },
            },
          ],
        },
        latestReviews: {
          nodes: [],
        },
        reviewThreads: {
          nodes: [],
        },
        comments: {
          totalCount: 1,
          nodes: [
            {
              author: {
                login: 'elopezgomez567-stack',
              },
              createdAt: '2026-10-09T19:28:16Z',
              url: 'https://github.com/cli/cli/pull/14580#issuecomment-6087801801',
            },
          ],
        },
        commits: {
          nodes: [
            {
              commit: {
                oid: '5f85ec828f6d2fe28d81ba71a61b8a2181edfb6a',
                statusCheckRollup: {
                  state: 'SUCCESS',
                  contexts: {
                    nodes: [
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975750353,
                        name: 'build (ubuntu-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:50Z',
                        completedAt: '2026-10-02T18:41:14Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048500399/job/110975750353',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048500399,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975750632,
                        name: 'build (windows-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:51Z',
                        completedAt: '2026-10-02T18:46:20Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048500399/job/110975750632',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048500399,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975750617,
                        name: 'build (macos-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:56Z',
                        completedAt: '2026-10-02T18:43:20Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048500399/job/110975750617',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048500399,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110976263673,
                        name: 'label-external',
                        status: 'COMPLETED',
                        conclusion: 'SKIPPED',
                        startedAt: '2026-10-02T18:37:12Z',
                        completedAt: '2026-10-02T18:37:02Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048637304/job/110976263673',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048637304,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 113994276447,
                        name: 'label-external',
                        status: 'COMPLETED',
                        conclusion: 'SKIPPED',
                        startedAt: '2026-10-09T19:41:16Z',
                        completedAt: '2026-10-09T19:41:07Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37981895366/job/113994276447',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37981895366,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975885942,
                        name: 'CodeQL-Build (go, manual, ./.github/codeql/codeql-config.yml)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:36:14Z',
                        completedAt: '2026-10-02T18:39:08Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048540763/job/110975885942',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048540763,
                            workflow: {
                              name: 'Code Scanning',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975749770,
                        name: 'lint',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:50Z',
                        completedAt: '2026-10-02T18:38:21Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048500199/job/110975749770',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048500199,
                            workflow: {
                              name: 'Lint',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975754383,
                        name: 'label-external / label_issues',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:51Z',
                        completedAt: '2026-10-02T18:35:53Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048501155/job/110975754383',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048501155,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4947,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
}

export const prBehind = {
  list: {
    data: {
      repository: {
        mergeCommitAllowed: true,
        squashMergeAllowed: true,
        rebaseMergeAllowed: true,
        pullRequests: {
          nodes: [
            {
              id: 'PR_kwDODKw3uc8AAAABGVY_uA',
              number: 14580,
              state: 'OPEN',
              updatedAt: '2026-10-09T19:41:02Z',
              headRepositoryOwner: {
                login: 'cli',
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4948,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
  detail: {
    data: {
      node: {
        id: 'PR_kwDODKw3uc8AAAABGVY_uA',
        number: 14580,
        state: 'OPEN',
        title: '`gh issue artifact` stack 10/12: Add `edit --restore-version`',
        url: 'https://github.com/cli/cli/pull/14580',
        isDraft: false,
        headRefName: 'bagtoad/artifact-restore-version',
        headRefOid: '5f85ec828f6d2fe28d81ba71a61b8a2181edfb6a',
        baseRefName: 'bagtoad/artifact-skill-docs',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'BEHIND',
        reviewDecision: 'APPROVED',
        isInMergeQueue: false,
        isMergeQueueEnabled: false,
        mergeQueueEntry: null,
        autoMergeRequest: null,
        viewerCanMergeAsAdmin: false,
        reviewRequests: {
          nodes: [
            {
              requestedReviewer: {
                __typename: 'User',
                login: 'babakks',
              },
            },
          ],
        },
        latestReviews: {
          nodes: [],
        },
        reviewThreads: {
          nodes: [],
        },
        comments: {
          totalCount: 1,
          nodes: [
            {
              author: {
                login: 'elopezgomez567-stack',
              },
              createdAt: '2026-10-09T19:28:16Z',
              url: 'https://github.com/cli/cli/pull/14580#issuecomment-6087801801',
            },
          ],
        },
        commits: {
          nodes: [
            {
              commit: {
                oid: '5f85ec828f6d2fe28d81ba71a61b8a2181edfb6a',
                statusCheckRollup: {
                  state: 'SUCCESS',
                  contexts: {
                    nodes: [
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975750353,
                        name: 'build (ubuntu-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:50Z',
                        completedAt: '2026-10-02T18:41:14Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048500399/job/110975750353',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048500399,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975750632,
                        name: 'build (windows-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:51Z',
                        completedAt: '2026-10-02T18:46:20Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048500399/job/110975750632',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048500399,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975750617,
                        name: 'build (macos-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:56Z',
                        completedAt: '2026-10-02T18:43:20Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048500399/job/110975750617',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048500399,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110976263673,
                        name: 'label-external',
                        status: 'COMPLETED',
                        conclusion: 'SKIPPED',
                        startedAt: '2026-10-02T18:37:12Z',
                        completedAt: '2026-10-02T18:37:02Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048637304/job/110976263673',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048637304,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 113994276447,
                        name: 'label-external',
                        status: 'COMPLETED',
                        conclusion: 'SKIPPED',
                        startedAt: '2026-10-09T19:41:16Z',
                        completedAt: '2026-10-09T19:41:07Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37981895366/job/113994276447',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37981895366,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975885942,
                        name: 'CodeQL-Build (go, manual, ./.github/codeql/codeql-config.yml)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:36:14Z',
                        completedAt: '2026-10-02T18:39:08Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048540763/job/110975885942',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048540763,
                            workflow: {
                              name: 'Code Scanning',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975749770,
                        name: 'lint',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:50Z',
                        completedAt: '2026-10-02T18:38:21Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048500199/job/110975749770',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048500199,
                            workflow: {
                              name: 'Lint',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975754383,
                        name: 'label-external / label_issues',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:51Z',
                        completedAt: '2026-10-02T18:35:53Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048501155/job/110975754383',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048501155,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4947,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
}

export const prAdmin = {
  list: {
    data: {
      repository: {
        mergeCommitAllowed: true,
        squashMergeAllowed: true,
        rebaseMergeAllowed: true,
        pullRequests: {
          nodes: [
            {
              id: 'PR_kwDODKw3uc8AAAABHmdU4g',
              number: 14640,
              state: 'OPEN',
              updatedAt: '2026-10-09T20:04:39Z',
              headRepositoryOwner: {
                login: 'cli',
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4946,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
  detail: {
    data: {
      node: {
        id: 'PR_kwDODKw3uc8AAAABHmdU4g',
        number: 14640,
        state: 'OPEN',
        title: '`gh issue artifact` stack 11/12: Address review feedback',
        url: 'https://github.com/cli/cli/pull/14640',
        isDraft: false,
        headRefName: 'bagtoad/artifact-review-feedback',
        headRefOid: '6ea10e3fa9998797e9ccea325272b9d9c02e0993',
        baseRefName: 'bagtoad/artifact-restore-version',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'BLOCKED',
        reviewDecision: 'REVIEW_REQUIRED',
        isInMergeQueue: false,
        isMergeQueueEnabled: false,
        mergeQueueEntry: null,
        autoMergeRequest: null,
        viewerCanMergeAsAdmin: true,
        reviewRequests: {
          nodes: [
            {
              requestedReviewer: {
                __typename: 'User',
                login: 'sergiou87',
              },
            },
            {
              requestedReviewer: {
                __typename: 'User',
                login: 'babakks',
              },
            },
          ],
        },
        latestReviews: {
          nodes: [
            {
              author: {
                login: 'copilot-pull-request-reviewer',
              },
              state: 'COMMENTED',
              submittedAt: '2026-10-09T19:45:56Z',
            },
          ],
        },
        reviewThreads: {
          nodes: [],
        },
        comments: {
          totalCount: 0,
          nodes: [],
        },
        commits: {
          nodes: [
            {
              commit: {
                oid: '6ea10e3fa9998797e9ccea325272b9d9c02e0993',
                statusCheckRollup: {
                  state: 'FAILURE',
                  contexts: {
                    nodes: [
                      {
                        __typename: 'CheckRun',
                        databaseId: 113993700595,
                        name: 'build (ubuntu-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-09T19:39:50Z',
                        completedAt: '2026-10-09T19:45:17Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37981740019/job/113993700595',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37981740019,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 113993700428,
                        name: 'build (windows-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-09T19:39:50Z',
                        completedAt: '2026-10-09T19:53:12Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37981740019/job/113993700428',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37981740019,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 113993700229,
                        name: 'build (macos-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-09T19:39:55Z',
                        completedAt: '2026-10-09T19:47:45Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37981740019/job/113993700229',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37981740019,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 113993700082,
                        name: 'govulncheck',
                        status: 'COMPLETED',
                        conclusion: 'FAILURE',
                        startedAt: '2026-10-09T19:39:49Z',
                        completedAt: '2026-10-09T19:40:22Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37981739982/job/113993700082',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37981739982,
                            workflow: {
                              name: 'Lint',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 114003183767,
                        name: 'label-external',
                        status: 'COMPLETED',
                        conclusion: 'SKIPPED',
                        startedAt: '2026-10-09T20:04:53Z',
                        completedAt: '2026-10-09T20:04:44Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37984544492/job/114003183767',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37984544492,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 113993892404,
                        name: 'CodeQL-Build (go, manual, ./.github/codeql/codeql-config.yml)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-09T19:40:19Z',
                        completedAt: '2026-10-09T19:43:10Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37981797308/job/113993892404',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37981797308,
                            workflow: {
                              name: 'Code Scanning',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 113993699722,
                        name: 'lint',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-09T19:39:50Z',
                        completedAt: '2026-10-09T19:42:33Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37981739982/job/113993699722',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37981739982,
                            workflow: {
                              name: 'Lint',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 113993704295,
                        name: 'label-external / label_issues',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-09T19:39:50Z',
                        completedAt: '2026-10-09T19:39:52Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37981740660/job/113993704295',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37981740660,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4945,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
}

export const prAutoMerge = {
  list: {
    data: {
      repository: {
        mergeCommitAllowed: true,
        squashMergeAllowed: true,
        rebaseMergeAllowed: true,
        pullRequests: {
          nodes: [
            {
              id: 'PR_kwDODKw3uc8AAAABGVY_uA',
              number: 14580,
              state: 'OPEN',
              updatedAt: '2026-10-09T19:41:02Z',
              headRepositoryOwner: {
                login: 'cli',
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4948,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
  detail: {
    data: {
      node: {
        id: 'PR_kwDODKw3uc8AAAABGVY_uA',
        number: 14580,
        state: 'OPEN',
        title: '`gh issue artifact` stack 10/12: Add `edit --restore-version`',
        url: 'https://github.com/cli/cli/pull/14580',
        isDraft: false,
        headRefName: 'bagtoad/artifact-restore-version',
        headRefOid: '5f85ec828f6d2fe28d81ba71a61b8a2181edfb6a',
        baseRefName: 'bagtoad/artifact-skill-docs',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        reviewDecision: 'APPROVED',
        isInMergeQueue: false,
        isMergeQueueEnabled: false,
        mergeQueueEntry: null,
        autoMergeRequest: {
          mergeMethod: 'SQUASH',
          enabledAt: '2026-10-09T12:00:00Z',
        },
        viewerCanMergeAsAdmin: false,
        reviewRequests: {
          nodes: [
            {
              requestedReviewer: {
                __typename: 'Team',
                slug: 'platform',
                organization: {
                  login: 'cli',
                },
              },
            },
            {
              requestedReviewer: {
                __typename: 'Bot',
                login: 'copilot-pull-request-reviewer',
              },
            },
          ],
        },
        latestReviews: {
          nodes: [],
        },
        reviewThreads: {
          nodes: [],
        },
        comments: {
          totalCount: 1,
          nodes: [
            {
              author: {
                login: 'elopezgomez567-stack',
              },
              createdAt: '2026-10-09T19:28:16Z',
              url: 'https://github.com/cli/cli/pull/14580#issuecomment-6087801801',
            },
          ],
        },
        commits: {
          nodes: [
            {
              commit: {
                oid: '5f85ec828f6d2fe28d81ba71a61b8a2181edfb6a',
                statusCheckRollup: {
                  state: 'SUCCESS',
                  contexts: {
                    nodes: [
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975750353,
                        name: 'build (ubuntu-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:50Z',
                        completedAt: '2026-10-02T18:41:14Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048500399/job/110975750353',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048500399,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975750632,
                        name: 'build (windows-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:51Z',
                        completedAt: '2026-10-02T18:46:20Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048500399/job/110975750632',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048500399,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975750617,
                        name: 'build (macos-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:56Z',
                        completedAt: '2026-10-02T18:43:20Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048500399/job/110975750617',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048500399,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110976263673,
                        name: 'label-external',
                        status: 'COMPLETED',
                        conclusion: 'SKIPPED',
                        startedAt: '2026-10-02T18:37:12Z',
                        completedAt: '2026-10-02T18:37:02Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048637304/job/110976263673',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048637304,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 113994276447,
                        name: 'label-external',
                        status: 'COMPLETED',
                        conclusion: 'SKIPPED',
                        startedAt: '2026-10-09T19:41:16Z',
                        completedAt: '2026-10-09T19:41:07Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37981895366/job/113994276447',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37981895366,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975885942,
                        name: 'CodeQL-Build (go, manual, ./.github/codeql/codeql-config.yml)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:36:14Z',
                        completedAt: '2026-10-02T18:39:08Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048540763/job/110975885942',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048540763,
                            workflow: {
                              name: 'Code Scanning',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975749770,
                        name: 'lint',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:50Z',
                        completedAt: '2026-10-02T18:38:21Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048500199/job/110975749770',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048500199,
                            workflow: {
                              name: 'Lint',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975754383,
                        name: 'label-external / label_issues',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:51Z',
                        completedAt: '2026-10-02T18:35:53Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048501155/job/110975754383',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048501155,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4947,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
}

export const prRunning = {
  list: {
    data: {
      repository: {
        mergeCommitAllowed: true,
        squashMergeAllowed: true,
        rebaseMergeAllowed: true,
        pullRequests: {
          nodes: [
            {
              id: 'PR_kwDODKw3uc8AAAABGVY_uA',
              number: 14580,
              state: 'OPEN',
              updatedAt: '2026-10-09T19:41:02Z',
              headRepositoryOwner: {
                login: 'cli',
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4948,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
  detail: {
    data: {
      node: {
        id: 'PR_kwDODKw3uc8AAAABGVY_uA',
        number: 14580,
        state: 'OPEN',
        title: '`gh issue artifact` stack 10/12: Add `edit --restore-version`',
        url: 'https://github.com/cli/cli/pull/14580',
        isDraft: false,
        headRefName: 'bagtoad/artifact-restore-version',
        headRefOid: '5f85ec828f6d2fe28d81ba71a61b8a2181edfb6a',
        baseRefName: 'bagtoad/artifact-skill-docs',
        mergeable: 'UNKNOWN',
        mergeStateStatus: 'UNSTABLE',
        reviewDecision: null,
        isInMergeQueue: false,
        isMergeQueueEnabled: false,
        mergeQueueEntry: null,
        autoMergeRequest: null,
        viewerCanMergeAsAdmin: false,
        reviewRequests: {
          nodes: [
            {
              requestedReviewer: {
                __typename: 'User',
                login: 'babakks',
              },
            },
          ],
        },
        latestReviews: {
          nodes: [],
        },
        reviewThreads: {
          nodes: [],
        },
        comments: {
          totalCount: 3,
          nodes: [
            {
              author: null,
              createdAt: '2026-10-09T08:00:00Z',
              url: 'https://github.com/cli/cli/pull/14580#issuecomment-1',
            },
          ],
        },
        commits: {
          nodes: [
            {
              commit: {
                oid: '5f85ec828f6d2fe28d81ba71a61b8a2181edfb6a',
                statusCheckRollup: {
                  state: 'SUCCESS',
                  contexts: {
                    nodes: [
                      {
                        __typename: 'CheckRun',
                        databaseId: 1001,
                        name: 'build',
                        status: 'IN_PROGRESS',
                        conclusion: null,
                        startedAt: '2026-10-09T08:00:00Z',
                        completedAt: null,
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/500/job/1001',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 500,
                            workflow: {
                              name: 'Go',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 1002,
                        name: 'lint',
                        status: 'QUEUED',
                        conclusion: null,
                        startedAt: null,
                        completedAt: null,
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/500/job/1002',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 500,
                            workflow: {
                              name: 'Go',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 1003,
                        name: 'unit',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-09T08:00:00Z',
                        completedAt: '2026-10-09T08:02:00Z',
                        detailsUrl: null,
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 500,
                            workflow: {
                              name: 'Go',
                            },
                          },
                        },
                      },
                    ],
                    state: 'PENDING',
                  },
                },
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4947,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
}

export const prStatusContexts = {
  list: {
    data: {
      repository: {
        mergeCommitAllowed: true,
        squashMergeAllowed: true,
        rebaseMergeAllowed: true,
        pullRequests: {
          nodes: [
            {
              id: 'PR_kwDODKw3uc8AAAABGVY_uA',
              number: 14580,
              state: 'OPEN',
              updatedAt: '2026-10-09T19:41:02Z',
              headRepositoryOwner: {
                login: 'cli',
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4948,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
  detail: {
    data: {
      node: {
        id: 'PR_kwDODKw3uc8AAAABGVY_uA',
        number: 14580,
        state: 'OPEN',
        title: '`gh issue artifact` stack 10/12: Add `edit --restore-version`',
        url: 'https://github.com/cli/cli/pull/14580',
        isDraft: false,
        headRefName: 'bagtoad/artifact-restore-version',
        headRefOid: '5f85ec828f6d2fe28d81ba71a61b8a2181edfb6a',
        baseRefName: 'bagtoad/artifact-skill-docs',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        reviewDecision: 'APPROVED',
        isInMergeQueue: false,
        isMergeQueueEnabled: false,
        mergeQueueEntry: null,
        autoMergeRequest: null,
        viewerCanMergeAsAdmin: false,
        reviewRequests: {
          nodes: [
            {
              requestedReviewer: {
                __typename: 'User',
                login: 'babakks',
              },
            },
          ],
        },
        latestReviews: {
          nodes: [],
        },
        reviewThreads: {
          nodes: [],
        },
        comments: {
          totalCount: 1,
          nodes: [
            {
              author: {
                login: 'elopezgomez567-stack',
              },
              createdAt: '2026-10-09T19:28:16Z',
              url: 'https://github.com/cli/cli/pull/14580#issuecomment-6087801801',
            },
          ],
        },
        commits: {
          nodes: [
            {
              commit: {
                oid: '5f85ec828f6d2fe28d81ba71a61b8a2181edfb6a',
                statusCheckRollup: {
                  state: 'SUCCESS',
                  contexts: {
                    nodes: [
                      {
                        __typename: 'StatusContext',
                        context: 'ci/circleci: test',
                        state: 'SUCCESS',
                        targetUrl: 'https://circleci.example/1',
                        createdAt: '2026-10-09T08:00:00Z',
                        isRequired: true,
                      },
                      {
                        __typename: 'StatusContext',
                        context: 'ci/circleci: lint',
                        state: 'ERROR',
                        targetUrl: 'https://circleci.example/2',
                        createdAt: '2026-10-09T08:01:00Z',
                        isRequired: false,
                      },
                      {
                        __typename: 'StatusContext',
                        context: 'deploy/preview',
                        state: 'PENDING',
                        targetUrl: null,
                        createdAt: '2026-10-09T08:02:00Z',
                        isRequired: false,
                      },
                      {
                        __typename: 'StatusContext',
                        context: 'deploy/expected',
                        state: 'EXPECTED',
                        targetUrl: null,
                        createdAt: '2026-10-09T08:02:00Z',
                        isRequired: true,
                      },
                    ],
                    state: 'FAILURE',
                  },
                },
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4947,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
}

export const prNone = {
  list: {
    data: {
      repository: {
        mergeCommitAllowed: true,
        squashMergeAllowed: true,
        rebaseMergeAllowed: true,
        pullRequests: {
          nodes: [],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4948,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
  detail: null,
}

export const prSquashOnly = {
  list: {
    data: {
      repository: {
        mergeCommitAllowed: false,
        squashMergeAllowed: true,
        rebaseMergeAllowed: false,
        pullRequests: {
          nodes: [
            {
              id: 'PR_kwDODKw3uc8AAAABGVY_uA',
              number: 14580,
              state: 'OPEN',
              updatedAt: '2026-10-09T19:41:02Z',
              headRepositoryOwner: {
                login: 'cli',
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4948,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
  detail: {
    data: {
      node: {
        id: 'PR_kwDODKw3uc8AAAABGVY_uA',
        number: 14580,
        state: 'OPEN',
        title: '`gh issue artifact` stack 10/12: Add `edit --restore-version`',
        url: 'https://github.com/cli/cli/pull/14580',
        isDraft: false,
        headRefName: 'bagtoad/artifact-restore-version',
        headRefOid: '5f85ec828f6d2fe28d81ba71a61b8a2181edfb6a',
        baseRefName: 'bagtoad/artifact-skill-docs',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        reviewDecision: 'APPROVED',
        isInMergeQueue: false,
        isMergeQueueEnabled: false,
        mergeQueueEntry: null,
        autoMergeRequest: null,
        viewerCanMergeAsAdmin: false,
        reviewRequests: {
          nodes: [
            {
              requestedReviewer: {
                __typename: 'User',
                login: 'babakks',
              },
            },
          ],
        },
        latestReviews: {
          nodes: [],
        },
        reviewThreads: {
          nodes: [],
        },
        comments: {
          totalCount: 1,
          nodes: [
            {
              author: {
                login: 'elopezgomez567-stack',
              },
              createdAt: '2026-10-09T19:28:16Z',
              url: 'https://github.com/cli/cli/pull/14580#issuecomment-6087801801',
            },
          ],
        },
        commits: {
          nodes: [
            {
              commit: {
                oid: '5f85ec828f6d2fe28d81ba71a61b8a2181edfb6a',
                statusCheckRollup: {
                  state: 'SUCCESS',
                  contexts: {
                    nodes: [
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975750353,
                        name: 'build (ubuntu-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:50Z',
                        completedAt: '2026-10-02T18:41:14Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048500399/job/110975750353',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048500399,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975750632,
                        name: 'build (windows-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:51Z',
                        completedAt: '2026-10-02T18:46:20Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048500399/job/110975750632',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048500399,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975750617,
                        name: 'build (macos-latest)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:56Z',
                        completedAt: '2026-10-02T18:43:20Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048500399/job/110975750617',
                        isRequired: true,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048500399,
                            workflow: {
                              name: 'Unit and Integration Tests',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110976263673,
                        name: 'label-external',
                        status: 'COMPLETED',
                        conclusion: 'SKIPPED',
                        startedAt: '2026-10-02T18:37:12Z',
                        completedAt: '2026-10-02T18:37:02Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048637304/job/110976263673',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048637304,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 113994276447,
                        name: 'label-external',
                        status: 'COMPLETED',
                        conclusion: 'SKIPPED',
                        startedAt: '2026-10-09T19:41:16Z',
                        completedAt: '2026-10-09T19:41:07Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37981895366/job/113994276447',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37981895366,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975885942,
                        name: 'CodeQL-Build (go, manual, ./.github/codeql/codeql-config.yml)',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:36:14Z',
                        completedAt: '2026-10-02T18:39:08Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048540763/job/110975885942',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048540763,
                            workflow: {
                              name: 'Code Scanning',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975749770,
                        name: 'lint',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:50Z',
                        completedAt: '2026-10-02T18:38:21Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048500199/job/110975749770',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048500199,
                            workflow: {
                              name: 'Lint',
                            },
                          },
                        },
                      },
                      {
                        __typename: 'CheckRun',
                        databaseId: 110975754383,
                        name: 'label-external / label_issues',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        startedAt: '2026-10-02T18:35:51Z',
                        completedAt: '2026-10-02T18:35:53Z',
                        detailsUrl: 'https://github.com/cli/cli/actions/runs/37048501155/job/110975754383',
                        isRequired: false,
                        checkSuite: {
                          workflowRun: {
                            databaseId: 37048501155,
                            workflow: {
                              name: 'PR Triaging',
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      rateLimit: {
        cost: 1,
        remaining: 4947,
        resetAt: '2026-10-12T08:02:58Z',
      },
    },
  },
}

// prMergeQueue with the checks of the merge group commit the queue tests
// (MergeQueueEntry.headCommit.statusCheckRollup), edited by hand.
function withQueueChecks() {
  const copy = structuredClone(prMergeQueue)
  const run = (name: string, status: string, conclusion: string | null, extra: Record<string, unknown> = {}) => ({
    __typename: 'CheckRun',
    databaseId: 9000 + name.length,
    name,
    status,
    conclusion,
    startedAt: status === 'QUEUED' ? null : '2026-10-12T07:50:00Z',
    completedAt: status === 'COMPLETED' ? '2026-10-12T07:52:00Z' : null,
    detailsUrl: `https://github.com/cli/cli/actions/runs/777/job/${name}`,
    isRequired: false,
    checkSuite: { workflowRun: { databaseId: 777, workflow: { name: 'CI' } } },
    ...extra,
  })
  const node = copy.detail.data.node as unknown as { mergeQueueEntry: Record<string, unknown> }
  node.mergeQueueEntry.headCommit = {
    oid: '0123456789abcdef0123456789abcdef01234567',
    statusCheckRollup: {
      state: 'PENDING',
      contexts: {
        nodes: [
          run('lint', 'COMPLETED', 'SUCCESS', { isRequired: true }),
          run('unit', 'IN_PROGRESS', null, { isRequired: true }),
          run('e2e', 'QUEUED', null),
          run('docs', 'COMPLETED', 'SKIPPED'),
          { __typename: 'StatusContext', context: 'license/cla', state: 'SUCCESS', targetUrl: 'https://cla.example/1', createdAt: '2026-10-12T07:50:00Z', isRequired: false },
        ],
      },
    },
  }
  return copy
}

export const prMergeQueueChecks = withQueueChecks()
