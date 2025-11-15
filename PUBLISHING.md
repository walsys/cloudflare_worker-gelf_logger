# Publishing to NPM

This guide walks you through publishing `@walsys/cloudflare_worker-gelf_logger` to NPM.

## Prerequisites

1. **NPM Account**: Create one at [npmjs.com](https://www.npmjs.com/)
2. **NPM CLI**: Installed with Node.js
3. **Git Repository**: Code should be in a Git repository

## Pre-Publishing Checklist

Before publishing, ensure:

- [ ] All tests pass
- [ ] README.md is complete and accurate
- [ ] LICENSE file is present
- [ ] package.json metadata is correct (name, version, author, repository)
- [ ] .npmignore is configured to exclude unnecessary files
- [ ] Version number follows [Semantic Versioning](https://semver.org/)

## First Time Setup

### 1. Login to NPM

```bash
npm login
```

Enter your NPM credentials when prompted.

### 2. Update package.json

Update the following fields in `package.json`:

```json
{
  "name": "@walsys/cloudflare_worker-gelf_logger",
  "version": "1.0.0",
  "author": "WAL Systems",
  "repository": {
    "type": "git",
    "url": "https://github.com/walsys/cloudflare_worker-gelf_logger.git"
  }
}
```

## Publishing Steps

### 1. Test Package Locally

Before publishing, test the package:

```bash
# See what files will be included
npm pack --dry-run

# Create a tarball to inspect
npm pack
```

### 2. Check Package Contents

```bash
tar -tzf walsys-cloudflare_worker-gelf_logger-1.0.0.tgz
```

Ensure only these files are included:
- `src/gelf-logger.js`
- `README.md`
- `LICENSE`
- `package.json`

### 3. Publish to NPM

```bash
# For first release
npm publish

# For scoped packages (if needed)
npm publish --access public
```

### 4. Verify Publication

Visit: `https://www.npmjs.com/package/@walsys/cloudflare_worker-gelf_logger`

## Updating the Package

### 1. Make Changes

Make your code changes and commit them.

### 2. Update Version

Follow [Semantic Versioning](https://semver.org/):

```bash
# Patch release (1.0.0 -> 1.0.1) - Bug fixes
npm version patch

# Minor release (1.0.0 -> 1.1.0) - New features (backward compatible)
npm version minor

# Major release (1.0.0 -> 2.0.0) - Breaking changes
npm version major
```

This automatically:
- Updates `package.json` version
- Creates a git commit
- Creates a git tag

### 3. Push Changes

```bash
git push && git push --tags
```

### 4. Publish Update

```bash
npm publish
```

## NPM Scripts

Useful commands defined in `package.json`:

```bash
# Start development server
npm run dev

# Deploy to Cloudflare Workers
npm run deploy

# Run tests
npm test
```

## Best Practices

1. **Always test before publishing**: Run `npm pack --dry-run` first
2. **Use semantic versioning**: Follow SemVer for version numbers
3. **Write clear release notes**: Document changes in each version
4. **Tag releases**: Use git tags for version tracking
5. **Deprecate carefully**: Use `npm deprecate` for outdated versions

## Deprecating a Version

If you need to deprecate a version:

```bash
npm deprecate @walsys/cloudflare_worker-gelf_logger@1.0.0 "Use version 1.1.0 or higher"
```

## Unpublishing (Use with Caution)

You can only unpublish within 72 hours of publishing:

```bash
npm unpublish @walsys/cloudflare_worker-gelf_logger@1.0.0
```

**Warning**: Unpublishing can break dependencies. Consider deprecation instead.

## Creating a Release on GitHub

After publishing to NPM:

1. Go to your GitHub repository
2. Click "Releases" → "Draft a new release"
3. Choose the version tag (e.g., `v1.0.0`)
4. Write release notes
5. Publish release

## Automation with GitHub Actions (Optional)

Create `.github/workflows/publish.yml`:

```yaml
name: Publish to NPM

on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Add `NPM_TOKEN` to GitHub repository secrets.

## Troubleshooting

### "Package name already exists"

The package name is taken. Choose a different name in `package.json`.

### "You must be logged in to publish"

Run `npm login` and authenticate.

### "Version already published"

You need to bump the version number. Run:

```bash
npm version patch  # or minor/major
npm publish
```

### "Package is marked as private"

Remove `"private": true` from `package.json`.

## Resources

- [NPM Documentation](https://docs.npmjs.com/)
- [Semantic Versioning](https://semver.org/)
- [NPM Package Publishing Best Practices](https://docs.npmjs.com/packages-and-modules/contributing-packages-to-the-registry)
