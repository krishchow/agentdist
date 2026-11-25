# Changesets

A changeset records a release-worthy change: which bump it needs and the line it adds to `CHANGELOG.md`.
Add one in any PR that changes what users get from the package:

```sh
pnpm changeset
```

Merging to `main` makes the Release workflow open (or update) a "Version Packages" PR that bumps
`package.json` and writes the changelog. Merging that PR publishes to npm.

Changes to tests, CI or docs that are not shipped need no changeset.
