# Railway frontend packaging check

Railway's Nixpacks 1.41.0 build generates app, landing and auth outputs, then
copies the uploaded source into `/app` again. Tracked `dist-landing` and
`dist-auth` files can overwrite freshly built HTML, icons and manifests at this
last copy. `.railwayignore` excludes both generated directories from the CLI
upload; the source and public inputs remain available to `build:all`.

After installing root and client dependencies, run with the supported Node 22:

```bash
npm --prefix client-react run build:all
node scripts/check-railway-frontend-packaging.mjs
```

The check requires `rg` (ripgrep), which uses the same Rust `ignore` engine as
Railway CLI's upload walker. It copies frontend inputs and exact tracked stale
artifacts into temporary directories. Removing the two new exclusions reproduces
the original final-copy overwrite. Applying the current exclusions must retain
build inputs and preserve every generated output byte, including all three HTML
entries, their local referenced assets, public icons, manifests and service workers.
Use `--report /absolute/path/report.json` to save hashes and the negative control.

This is a local upload/filter/copy simulation, not a Railway build or deployment
and not authenticated acceptance. External font/preconnect links are reported but
not fetched. The check itself never changes the checkout.
`build:all` changes tracked generated artifacts; preserve any user changes and
restore only those generated paths before committing the source repair.

References: [Railway CLI upload implementation](https://github.com/railwayapp/cli/blob/v5.28.1/src/controllers/upload.rs#L46)
and [Nixpacks final source copy](https://github.com/railwayapp/nixpacks/blob/v1.41.0/src/nixpacks/builder/docker/dockerfile_generation.rs#L334).
