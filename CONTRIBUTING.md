# Contributing

You need Node.js 24 (see `.nvmrc`). The test commands and what they need are in
[docs/testing.md](docs/testing.md).

```sh
npm ci
npm run typecheck
npm run build
npm test
```

## Rules for `relaxios/axios`

- The port must match axios 1.20.0. A change in behavior needs a case in `test/diff/cases/`, and
  the differential suite must report 0 differences in every runtime.
- `test/axios` and `test/mock-adapter` hold upstream files verbatim. Do not edit them, and do not
  skip their tests.
- No runtime dependencies. Ask in an issue first if you think one is needed.

## Commit messages and pull request titles

We use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). Pull requests are
squash-merged, so the **pull request title** becomes the commit on `main`, and it decides whether
a release happens:

| Title starts with | Example | Release |
| --- | --- | --- |
| `fix:`, `perf:`, `revert:` | `fix(axios): keep the charset of text bodies` | Patch, `0.1.0` to `0.1.1` |
| `feat:` | `feat(progress): report the upload rate` | Minor, `0.1.0` to `0.2.0` |
| `!` after the type, or a `BREAKING CHANGE:` footer | `feat(core)!: return Headers as an object` | Major |
| `docs:`, `test:`, `chore:`, `ci:`, `refactor:`, `build:` | `docs: explain the stand-in` | No release |

Format: `<type>(<optional scope>): <summary>`. Write the summary in the imperative mood, start it
with a lowercase letter, leave out the final period, and keep the header at 72 characters or
fewer. Do not use `chore(release)`; the release workflow uses it.

## Releases

You do not change version numbers. When a release-triggering commit lands on `main`, GitHub
Actions runs every check, picks the next version from the commit types, updates `package.json`
and `package-lock.json`, tags the commit, and publishes the GitHub release and the npm package.

- **Beta.** Open the pull request against `beta`. A release-triggering commit there publishes the
  next version as a beta, such as `0.2.0-beta.0`, to the `beta` dist-tag and as a GitHub
  prerelease. Install it with `npm install relaxios@beta`. Merge `beta` into `main` to release
  the stable version.
- **Alpha.** The same flow on `alpha`, such as `0.2.0-alpha.0` on the `alpha` dist-tag. Merge
  `alpha` into `beta` when it is ready.

To preview the next release, run `npm run release:dry-run` on a clean `main`, `beta` or `alpha`
checkout with all tags fetched. The publishing setup is in
[docs/npm-publishing.md](docs/npm-publishing.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
