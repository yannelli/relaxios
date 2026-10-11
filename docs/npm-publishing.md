# npm publishing

The **Release** workflow (`.github/workflows/release.yml`) publishes `relaxios` to npm after the
GitHub release step. It runs on every push to `main`, `beta` and `alpha`, first runs the CI
workflow as a reusable job, then releases.

## Workflow steps

1. **Checks.** `ci.yml` runs in full: typecheck, build, unit and differential tests in every
   runtime, the release script tests, size budgets, Playwright, the axios suite and the
   mock-adapter suite. A failure stops the release.
2. **Publish semantic release.** `scripts/release.mjs --publish` picks the next version from the
   commit types since the last tag, updates `package.json` and `package-lock.json`, commits
   `chore(release): <version>`, tags `v<version>` and creates the GitHub release.
3. **Publish npm package.** When npm does not have the version yet, the step runs
   `npm publish`, which builds through `prepublishOnly`. Betas go to the `beta` dist-tag and
   alphas to `alpha`, so `latest` only moves on `main`. If a publish fails, a rerun finishes it.
   GitHub releases are immutable once published, so no tarball is attached to them.

The job grants `id-token: write`, and npm exchanges the OIDC token for a short-lived publish
token (trusted publishing). The workflow reads no npm secret. npm generates provenance only for
public repositories, so while `yannelli/relaxios` is private the package has none.

## First publish

The first version goes through the workflow too. Only the npm side is set up by hand.

1. On npmjs.com, create the package `relaxios`. npm reserves the name with a `0.0.0-stage`
   placeholder version.
2. In the package **Settings**, under **Trusted publishing**, add a GitHub Actions publisher:

   | Field | Value |
   | --- | --- |
   | Organization or user | `yannelli` |
   | Repository | `relaxios` |
   | Workflow filename | `release.yml` |
   | Environment | empty |

   The CLI equivalent:

   ```sh
   npm trust github relaxios --repo yannelli/relaxios --file release.yml --allow-publish
   ```

3. Run the **Release** workflow within 2 days, or the trust entry expires. Its npm step
   publishes the current version through OIDC and validates the entry.

   ```sh
   gh workflow run release.yml -R yannelli/relaxios
   ```

4. In the package **Settings**, set **Publishing access** to require 2FA and disallow tokens.
   The workflow publishes without a token.

## Renaming the workflow

The trust entry names the workflow file. If `release.yml` is renamed, or the publish step moves
to another workflow, replace the entry:

```sh
npm trust list relaxios
```

```sh
npm trust revoke relaxios --id=<trust-id>
```

```sh
npm trust github relaxios --repo yannelli/relaxios --file <workflow>.yml --allow-publish
```
