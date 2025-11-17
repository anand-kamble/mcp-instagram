# Publishing Guide

This guide explains how to publish `mcp-instagram` to npm using GitHub Actions.

## Prerequisites

1. **npm account**: Create one at https://www.npmjs.com/signup
2. **GitHub repository**: Your code should be on GitHub
3. **npm package name availability**: Check if `mcp-instagram` is available on npm

## Automated Publishing Setup

### Step 1: Create npm Access Token

1. Go to https://www.npmjs.com/settings/YOUR_USERNAME/tokens
2. Click "Generate New Token"
3. Select **"Automation"** token type (for CI/CD)
4. Copy the token (you won't see it again!)

### Step 2: Add Token to GitHub Secrets

1. Go to your repository: https://github.com/anand-kamble/mcp-instagram
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **"New repository secret"**
4. Name: `NPM_TOKEN`
5. Value: Paste your npm token
6. Click **"Add secret"**

### Step 3: Publish via GitHub Release

#### Method 1: Create Release via GitHub UI (Recommended)

1. Go to your repository → **Releases** → **"Create a new release"**
2. **Tag version**: `v1.0.0` (must start with `v`)
3. **Release title**: `v1.0.0` (or any descriptive title)
4. **Description**: Add release notes (optional)
5. Check **"Set as the latest release"**
6. Click **"Publish release"**
7. The GitHub Action will automatically:
   - Build the project
   - Run tests
   - Publish to npm

#### Method 2: Manual Workflow Dispatch

1. Go to **Actions** tab in your repository
2. Select **"Publish to npm"** workflow
3. Click **"Run workflow"**
4. Enter version (e.g., `1.0.0`)
5. Click **"Run workflow"**

### Step 4: Verify Publication

After the workflow completes:

1. Check the workflow run status (should be green ✅)
2. Visit https://www.npmjs.com/package/mcp-instagram
3. Test installation:
   ```bash
   npx mcp-instagram
   ```

## Manual Publishing (Alternative)

If you prefer to publish manually:

```bash
# 1. Login to npm
npm login

# 2. Update version (if needed)
npm version patch  # or minor, major

# 3. Build the project
npm run build

# 4. Run tests
npm test

# 5. Publish
npm publish --access public
```

## Version Management

The package version is managed in `package.json`. When creating a release:

- **Patch release** (1.0.0 → 1.0.1): Bug fixes
- **Minor release** (1.0.0 → 1.1.0): New features (backward compatible)
- **Major release** (1.0.0 → 2.0.0): Breaking changes

Update the version in `package.json` before creating a release, or use the manual workflow dispatch with the desired version.

## Troubleshooting

### Workflow Fails with "401 Unauthorized"

- Check that `NPM_TOKEN` secret is set correctly
- Verify the token hasn't expired
- Ensure the token has "Automation" type

### Workflow Fails with "Package name already exists"

- The package name `mcp-instagram` might be taken
- Change the name in `package.json` to something unique
- Or contact npm support if it's your package

### Tests Fail in CI

- Ensure all tests pass locally: `npm test`
- Check that test environment variables are set if needed
- Review test output in the Actions tab

### Build Fails

- Ensure TypeScript compiles: `npm run build`
- Check for type errors: `npx tsc --noEmit`
- Verify all dependencies are in `package.json`

## Post-Publication

After successful publication:

1. **Update README** with npm installation instructions
2. **Add badges** to README (npm version, downloads, etc.)
3. **Create release notes** on GitHub
4. **Share on social media** or relevant communities

## Package Contents

The `.npmignore` file controls what gets published. By default, it excludes:
- Source TypeScript files (`src/`)
- Test files
- Development configuration
- Build artifacts (but `build/` is included for runtime)

Only the necessary files for running the package are published.

