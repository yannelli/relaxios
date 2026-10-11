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
3. **Publish npm package.** When npm does not have the version yet, the step builds, packs the
   tarball, attaches it to the GitHub release and publishes it. Betas go to the `beta`
   dist-tag and alphas to `alpha`, so `latest` only moves on `main`. If a publish fails, a
   rerun finishes it.

The job grants `id-token: write`, and npm exchanges the OIDC token for a short-lived publish
token (trusted publishing). The workflow reads no npm secret. npm generates provenance only for
public repositories, so while `yannelli/relaxios` is private the package has none.

## First publish

npm trusted publishing needs an existing package, so `0.1.0` is published by hand. The first
workflow run tags `v0.1.0`, creates the GitHub release with `relaxios-0.1.0.tgz` attached, and
then fails at `npm publish`. This failure is expected.

1. Log in with an account that has 2FA (npm CLI 11.5.1 or newer):

   ```sh
   npm login
   npm whoami
   ```

2. Publish the tarball the workflow built:

   ```sh
   gh release download v0.1.0 -R yannelli/relaxios -p relaxios-0.1.0.tgz
   npm publish relaxios-0.1.0.tgz
   ```

3. Run the workflow again. The npm step finds 0.1.0 and passes.

   ```sh
   gh workflow run release.yml -R yannelli/relaxios
   ```

4. Trust the release workflow when a `feat:` or `fix:` commit is ready to merge. A new trust
   entry expires unless a publish through it succeeds within 2 days, and the release from that
   commit is the first publish through OIDC.

   ```sh
   npm trust github relaxios --repo yannelli/relaxios --file release.yml --allow-publish
   npm trust list relaxios
   ```

   If the entry expires, revoke it and run `npm trust github` again.

5. After that release appears on npm, open the package **Settings** on npmjs.com and set
   **Publishing access** to require 2FA and disallow tokens.

## Renaming the workflow

The trust entry names the workflow file. If `release.yml` is renamed, or the publish step moves
to another workflow, replace the entry:

```sh
npm trust list relaxios
npm trust revoke relaxios --id=<trust-id>
npm trust github relaxios --repo yannelli/relaxios --file <workflow>.yml --allow-publish
```
