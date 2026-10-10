# Releasing your own build from a fork

For a school or teacher who publishes their own build (e.g. with the GitHub / Classroom 50 feature) from a fork `<you>/opetaja-assistent2`.
Teachers download the zip from `https://github.com/<you>/opetaja-assistent2/releases`, as the
[teacher guide](github-classroom50-tahvel.md) describes. Replace `<you>` with your GitHub user or org below.

**Short version:** raise `version` in `package.json` → push to `main` on the fork → GitHub Actions builds and publishes the zip. Nothing is packed by hand.

## 0. One-time setup

1. **Enable Actions on the fork.** GitHub disables workflows on forks by default.
   Open https://github.com/<you>/opetaja-assistent2/actions → **I understand my workflows, go ahead and enable them**.
   Check: `gh api repos/<you>/opetaja-assistent2/actions/workflows --jq .total_count` prints `1` or more (it prints `0` while disabled).
2. **Browser libraries for the E2E tests** (AlmaLinux 9 / WSL). `bunx playwright install-deps` only supports Ubuntu/Debian, so use `dnf`:

   ```bash
   sudo dnf install -y nspr nss nss-util atk at-spi2-atk at-spi2-core cups-libs \
     libxcb libxkbcommon alsa-lib mesa-libgbm libX11 libXext libXcomposite \
     libXdamage libXfixes libXrandr cairo pango
   ldd ~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome | grep "not found"   # must print nothing
   ```

3. Remotes: `origin` = your fork, `upstream` = `kriit-eu/opetaja-assistent2`. Check with `git remote -v`.

## 1. Check before releasing

The `pre-push` hook runs all of these and blocks `git push` if one fails. Running them first saves a failed push:

```bash
bun run lint                          # must be clean: warnings also fail (--max-warnings 0)
bun test                              # unit tests
OA_E2E_WORKERS=2 bun run test:e2e     # ~5 min; the Kriit tests use a fake local Kriit, no account needed
```

## 2. Release

```bash
git checkout main
git merge --squash <feature-branch> && git commit      # message format: see CLAUDE.md
# raise "version" in package.json, e.g. 1.9.0 → 1.9.1 (the build copies it into manifest.json)
git commit -am "Release v1.9.1"
git push origin main
```

The workflow ([.github/workflows/release.yml](../.github/workflows/release.yml)) runs only when **all** of these are true:

- the push is to `main`;
- it changes `package.json`;
- no tag `v<version>` exists yet.

It builds `dist/`, zips it as `opetaja-assistent2-v<version>.zip` and creates release `v<version>`.
The Chrome Web Store step is skipped on the fork because the store secrets aren't set. That is expected.

## 3. Verify

```bash
gh run list -R <you>/opetaja-assistent2 --limit 3      # Release run should be ✓
gh release view v1.9.1 -R <you>/opetaja-assistent2     # zip listed under assets
```

Then install the zip yourself once: unzip → `chrome://extensions` → ↻ on the extension → F5 in Tahvel → open a journal → the **Classroom 50** button works.

## 4. Tell teachers

Teachers update by unzipping the new zip **into the same folder**, then ↻ in `chrome://extensions` and F5 in Tahvel.
Removing the extension deletes their saved tokens, so tell them not to.

## Rollback

A bad release: teachers unzip the **previous** release's zip into the same folder (↻, F5). Then remove the bad one:

```bash
gh release delete v1.9.1 -R <you>/opetaja-assistent2 --cleanup-tag --yes
```

Fix, raise the version again (never reuse a number teachers may already have), release.

## Keeping up with upstream

```bash
git fetch upstream
git checkout main && git rebase upstream/main
bun test && git push origin main --force-with-lease
```

Raise the version in the same push if teachers should get the upstream changes.

## When something fails

| Symptom | Cause / fix |
|---|---|
| Push blocked: "Linting failed" | `bun run lint:fix`, then fix the rest by hand |
| Push blocked: E2E, `libnspr4.so … not found` | Browser libraries missing: step 0.2 |
| Pushed, but no release appears | Actions not enabled (step 0.1), `package.json` unchanged, or tag already exists |
| Release run failed at "Verify build output" | Run `bun run build:prod` locally and read the error |
