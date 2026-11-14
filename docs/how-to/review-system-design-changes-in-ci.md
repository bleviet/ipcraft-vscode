# Reviewing System Design Changes in CI

The `system-design-diff` GitHub Action runs [`ipcraft diff`](../reference/command-line.md) on a
pull request and posts the report as one comment, so a reviewer sees what a change
did to a Vivado block design or a Platform Designer system without opening a vendor tool.

The action runs the IPCraft command line from a checkout of this repository that your workflow
builds. It does not download anything else, and it needs no vendor tool.

## Prerequisites

- A GitHub repository with the system design files (`.bd`, `.tcl`, `.qsys`) committed
- A tag or commit of `bleviet/ipcraft-vscode` that has the `diff` command, which is a release after 1.5.3. Use the same tag or commit for the checkout of the command line and for the action, so the two match
- A Linux or macOS runner. The action is tested there; it runs its scripts with bash

## Add the workflow

Create `.github/workflows/system-design-diff.yml`. Replace `<tag-or-sha>` with the tag or commit
you chose:

```yaml
name: System design diff

on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  diff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Check out IPCraft
        uses: actions/checkout@v4
        with:
          repository: bleviet/ipcraft-vscode
          ref: <tag-or-sha>
          submodules: true
          path: .ipcraft-cli

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Build the IPCraft command line
        working-directory: .ipcraft-cli
        run: |
          npm ci --ignore-scripts
          npx webpack --config config/webpack.config.js --config-name extension --config-name cli

      - uses: bleviet/ipcraft-vscode/actions/system-design-diff@<tag-or-sha>
        with:
          cli: .ipcraft-cli/dist/cli.js
          designs: |
            bd/system.bd
            qsys/soc.qsys
```

The build takes about half a minute. The `webpack` command builds the command line and copies the
resources it reads at run time (bus definitions, schemas, fonts, the layout engine) into
`.ipcraft-cli/dist`. `npm run compile` also works but builds the webviews too. `submodules: true`
fetches the `ipcraft-spec` schemas the build needs.

`fetch-depth: 0` on the first checkout makes the base revision of the pull request available to
git. Without it `ipcraft diff` cannot read the base file and the run fails.

The action compares each design at the base of the pull request with the checked-out
working tree, which is the merge result of the pull request. Pin the action and the command line
to a tag or a commit, not to a branch, so a change in this repository cannot alter what runs with
your token.

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `designs` | required | Paths of the designs to compare, one per line or separated by spaces. A path cannot contain a space |
| `cli` | required | Path to the built command line, `dist/cli.js` of the IPCraft checkout. The action fails with an error when the file does not exist |
| `base` | the base commit of the pull request | Git revision to compare with. Required when the workflow does not run on a pull request: the action stops with an error when it is empty |
| `head` | the working tree | Git revision to compare instead of the working tree |
| `fail-on` | not set | `changes` or `new-findings`: fail the job when the check fails, see [Fail the job](#fail-the-job) |
| `ignore-version-only` | `false` | Leave out blocks whose only change is the version of their IP |
| `comment` | `true` | Post the report as a pull request comment |
| `github-token` | `${{ github.token }}` | Token used to post the comment |

The action has two outputs: `failed` is `true` when a run failed its check or exited with an
error, and `report-dir` is the folder with the files of the run: `<n>.md` (the report),
`<n>.exit` (the exit code) and `<n>.err` (the error output) for the n-th design in `designs`.

## Fail the job

By default the job passes whether or not the designs differ. To make a pull request fail on
a change, set `fail-on`:

```yaml
      - uses: bleviet/ipcraft-vscode/actions/system-design-diff@<tag-or-sha>
        with:
          cli: .ipcraft-cli/dist/cli.js
          designs: bd/system.bd
          fail-on: new-findings
```

`changes` fails on any change, `new-findings` on at least one new finding, such as an
undriven pin. The meaning is the one of `--fail-on` in the
[command line reference](../reference/command-line.md). Every design is compared even when an
earlier one failed; the comment is posted, then the job fails.

## What the comment looks like

The comment holds the Markdown report of each design, one after the other, with the summary
line, the findings, the address map, the external ports and one table per hierarchy level that
changed. When a run failed its check, a line with the reason (for example
`Diff check failed: 3 changes (--fail-on changes)`) follows its report. A design whose run
wrote no report gets a heading and the last lines of its error output.

The action keeps one comment per pull request: each push updates it instead of adding a new one.
Two uses of the action in one job, or two workflows, share that comment, and the last one to run
replaces the content. Put all the designs of a pull request in one use of the action.

The comment is cut to fit the size limit of GitHub (65536 characters) with a note. The job summary
of the run always has the full reports.

## Pull requests from forks

The action posts the comment only on the `pull_request` event. On a pull request from a fork the
token of that event is read-only, so the comment cannot be posted: the action prints a warning and
the job goes on. The reports are still written to the job summary of the run, and `fail-on` still
decides whether the job passes.

Do not switch the workflow to `pull_request_target` to get a write token. That event runs in the
context of the base repository with a write token and access to secrets, and the workflow would
then check out and process the untrusted pull request with them. Posting the comment for fork pull requests from a separate
`workflow_run` workflow is not supported by this action.
